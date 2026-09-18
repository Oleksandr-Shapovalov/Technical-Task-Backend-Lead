import { randomUUID } from 'node:crypto'
import {
  CommentRecord,
  CommentsRepository,
  PersistCommentInput,
  PersistModerationResultInput,
} from '../../src/modules/comments'
import { UniqueConflictError } from '../../src/shared/errors'

type StoredComment = {
  id: string
  idempotencyKey: string
  text: string
  userId: string | null
  createdAt: Date
}

type StoredModerationResult = PersistModerationResultInput & {
  id: string
  commentId: string
  createdAt: Date
}

export class InMemoryCommentsRepo implements CommentsRepository {
  private readonly commentsById = new Map<string, StoredComment>()
  private readonly commentIdByKey = new Map<string, string>()
  private readonly resultsByCommentId = new Map<string, StoredModerationResult[]>()

  async findById(id: string): Promise<CommentRecord | null> {
    const comment = this.commentsById.get(id)
    return comment ? this.toRecord(comment) : null
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CommentRecord | null> {
    const id = this.commentIdByKey.get(idempotencyKey)
    return id ? this.findById(id) : null
  }

  async create(
    commentInput: PersistCommentInput,
    moderation: PersistModerationResultInput,
  ): Promise<CommentRecord> {
    if (this.commentIdByKey.has(commentInput.idempotencyKey)) {
      throw new UniqueConflictError()
    }

    const comment: StoredComment = {
      id: randomUUID(),
      idempotencyKey: commentInput.idempotencyKey,
      text: commentInput.text,
      userId: commentInput.userId ?? null,
      createdAt: new Date(),
    }
    const result: StoredModerationResult = {
      id: randomUUID(),
      commentId: comment.id,
      ...moderation,
      createdAt: new Date(),
    }

    this.commentsById.set(comment.id, comment)
    this.commentIdByKey.set(comment.idempotencyKey, comment.id)
    this.resultsByCommentId.set(comment.id, [result])
    return this.toRecord(comment)
  }

  clear(): void {
    this.commentsById.clear()
    this.commentIdByKey.clear()
    this.resultsByCommentId.clear()
  }

  private toRecord(comment: StoredComment): CommentRecord {
    const result = this.resultsByCommentId.get(comment.id)?.[0]
    if (!result) {
      throw new Error(`Comment ${comment.id} has no moderation result`)
    }

    return {
      id: comment.id,
      idempotencyKey: comment.idempotencyKey,
      text: comment.text,
      userId: comment.userId,
      decision: result.decision,
      reason: result.reason,
      suggestedReply: result.suggestedReply,
      provider: result.provider,
      model: result.model,
      createdAt: comment.createdAt,
    }
  }
}
