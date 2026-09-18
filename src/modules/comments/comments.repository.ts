import { UniqueConflictError } from '../../shared/errors'
import { Prisma, PrismaClient } from '../../shared/db/prisma'
import { toCommentRecord } from './comments.mapper'
import { CommentRecord } from './comments.schema'
import { CreateCommentInput, ModerationResult } from './comments.types'

export type PersistCommentInput = CreateCommentInput

export type PersistModerationResultInput = ModerationResult & {
  provider: string
  model: string
}

const latestModerationInclude = {
  moderationResults: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.CommentInclude

export interface CommentsRepository {
  findById(id: string): Promise<CommentRecord | null>
  findByIdempotencyKey(idempotencyKey: string): Promise<CommentRecord | null>
  create(
    comment: PersistCommentInput,
    moderation: PersistModerationResultInput,
  ): Promise<CommentRecord>
}

export class CommentsRepo implements CommentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CommentRecord | null> {
    const row = await this.prisma.comment.findUnique({
      where: { id },
      include: latestModerationInclude,
    })
    return row ? toCommentRecord(row) : null
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CommentRecord | null> {
    const row = await this.prisma.comment.findUnique({
      where: { idempotencyKey },
      include: latestModerationInclude,
    })
    return row ? toCommentRecord(row) : null
  }

  async create(
    commentInput: PersistCommentInput,
    moderation: PersistModerationResultInput,
  ): Promise<CommentRecord> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const comment = await tx.comment.create({
          data: {
            idempotencyKey: commentInput.idempotencyKey,
            text: commentInput.text,
            userId: commentInput.userId,
          },
        })

        const moderationResult = await tx.commentModerationResult.create({
          data: {
            commentId: comment.id,
            decision: moderation.decision,
            reason: moderation.reason,
            suggestedReply: moderation.suggestedReply,
            provider: moderation.provider,
            model: moderation.model,
          },
        })

        return { ...comment, moderationResults: [moderationResult] }
      })

      return toCommentRecord(row)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new UniqueConflictError()
      }
      throw err
    }
  }
}
