export type { AiModerationProvider } from './ai-moderation.provider'
export {
  createCommentsModule,
  type CommentsModule,
  type CommentsModuleDeps,
} from './comments.module'
export {
  CommentsRepo,
  type CommentsRepository,
  type PersistCommentInput,
  type PersistModerationResultInput,
} from './comments.repository'
export { serialize, toCommentRecord } from './comments.mapper'
export { commentContentChecksum } from './comments.checksum'
export { commentsRouter } from './comments.routes'
export {
  commentIdParamSchema,
  commentRecordSchema,
  commentResponseSchema,
  createCommentBodySchema,
  type CommentDto,
  type CommentRecord,
} from './comments.schema'
export { CommentsService } from './comments.service'
export {
  Decision,
  type CreateCommentInput,
  type ModerationInput,
  type ModerationResult,
} from './comments.types'
export { MockAiModerationProvider } from './mock.provider'
