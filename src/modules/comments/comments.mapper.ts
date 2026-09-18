import { type Comment, type CommentModerationResult } from '../../shared/db/prisma'
import {
  CommentDto,
  CommentRecord,
  commentRecordSchema,
  serializeCommentSchema,
} from './comments.schema'

export type CommentWithModerationResults = Comment & {
  moderationResults: CommentModerationResult[]
}

export function toCommentRecord(row: CommentWithModerationResults): CommentRecord {
  const result = row.moderationResults[0]
  if (!result) {
    throw new Error(`Comment ${row.id} has no moderation result`)
  }

  return commentRecordSchema.parse({
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    text: row.text,
    userId: row.userId,
    decision: result.decision,
    reason: result.reason,
    suggestedReply: result.suggestedReply,
    provider: result.provider,
    model: result.model,
    createdAt: row.createdAt,
  })
}

export function serialize(comment: CommentRecord): CommentDto {
  return serializeCommentSchema.parse(comment)
}
