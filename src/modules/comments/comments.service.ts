import {
  IdempotencyConflictError,
  NotFoundError,
  ProviderUnavailableError,
  UniqueConflictError,
} from '../../shared/errors'
import { AiModerationProvider } from './ai-moderation.provider'
import { commentContentChecksum } from './comments.checksum'
import { CommentsRepository } from './comments.repository'
import { CommentRecord } from './comments.schema'
import { CreateCommentInput, Decision, ModerationResult } from './comments.types'

const DEFAULT_MODERATION_TIMEOUT_MS = 10_000

type InFlightModeration = {
  checksum: string
  promise: Promise<ModerationResult>
}

export class CommentsService {
  private readonly inFlightModeration = new Map<string, InFlightModeration>()

  constructor(
    private readonly repo: CommentsRepository,
    private readonly provider: AiModerationProvider,
    private readonly moderationTimeoutMs = DEFAULT_MODERATION_TIMEOUT_MS,
  ) {}

  async create(input: CreateCommentInput): Promise<{ comment: CommentRecord; created: boolean }> {
    const checksum = commentContentChecksum(input)
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey)
    if (existing) {
      this.assertSameContent(existing, checksum)
      return { comment: existing, created: false }
    }

    const result = await this.moderate(input, checksum)
    this.assertModeration(result)

    try {
      const comment = await this.repo.create(input, {
        ...result,
        provider: this.provider.name,
        model: this.provider.model,
      })
      return { comment, created: true }
    } catch (err) {
      if (err instanceof UniqueConflictError) {
        const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey)
        if (raced) {
          this.assertSameContent(raced, checksum)
          return { comment: raced, created: false }
        }
      }
      throw err
    }
  }

  async getById(id: string): Promise<CommentRecord> {
    const comment = await this.repo.findById(id)
    if (!comment) {
      throw new NotFoundError('Comment not found')
    }
    return comment
  }

  private async moderate(input: CreateCommentInput, checksum: string): Promise<ModerationResult> {
    const pending = this.inFlightModeration.get(input.idempotencyKey)
    if (pending) {
      if (pending.checksum !== checksum) {
        throw new IdempotencyConflictError()
      }
      return pending.promise
    }

    const work = this.callProvider(input).finally(() => {
      this.inFlightModeration.delete(input.idempotencyKey)
    })
    this.inFlightModeration.set(input.idempotencyKey, { checksum, promise: work })
    return work
  }

  private async callProvider(input: CreateCommentInput): Promise<ModerationResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.moderationTimeoutMs)

    try {
      return await this.provider.moderate({
        text: input.text,
        userId: input.userId,
        signal: controller.signal,
      })
    } catch {
      throw new ProviderUnavailableError(
        `Moderation provider timed out ${this.moderationTimeoutMs}ms`,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private assertSameContent(comment: CommentRecord, checksum: string): void {
    if (commentContentChecksum(comment) !== checksum) {
      throw new IdempotencyConflictError()
    }
  }

  private assertModeration(result: ModerationResult): void {
    if (
      (result.decision === Decision.flag || result.decision === Decision.block) &&
      result.reason.trim() === ''
    ) {
      throw new ProviderUnavailableError('Moderation provider returned an invalid result')
    }
  }
}
