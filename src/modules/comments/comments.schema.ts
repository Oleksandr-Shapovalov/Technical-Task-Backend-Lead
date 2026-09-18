import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { Decision } from './comments.types'

extendZodWithOpenApi(z)

export const createCommentBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(128).openapi({ example: 'cmt-001' }),
    text: z.string().min(1).max(2000).openapi({ example: 'Nice post' }),
    userId: z.string().min(1).max(128).optional().openapi({ example: 'user-42' }),
  })
  .openapi('CreateCommentBody')

export const commentIdParamSchema = z.object({
  id: z.string().uuid(),
})

const commentBaseSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string(),
  text: z.string(),
  userId: z.string().nullable(),
  decision: z.enum([Decision.allow, Decision.flag, Decision.block]),
  reason: z.string(),
  suggestedReply: z.string(),
  provider: z.string(),
  model: z.string(),
})

export const commentRecordSchema = commentBaseSchema.extend({
  createdAt: z.date(),
})

export const commentResponseSchema = commentBaseSchema
  .extend({
    createdAt: z.string().datetime(),
  })
  .openapi('Comment')

export const serializeCommentSchema = commentRecordSchema
  .transform((comment) => ({
    ...comment,
    createdAt: comment.createdAt.toISOString(),
  }))
  .pipe(commentResponseSchema)

export type CommentRecord = z.infer<typeof commentRecordSchema>
export type CommentDto = z.infer<typeof commentResponseSchema>
