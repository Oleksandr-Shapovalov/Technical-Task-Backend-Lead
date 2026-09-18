import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { ErrorCode } from '../errors'

extendZodWithOpenApi(z)

export const errorResponseSchema = z
  .object({
    error: z.enum([
      ErrorCode.InvalidInput,
      ErrorCode.NotFound,
      ErrorCode.IdempotencyConflict,
      ErrorCode.RateLimited,
      ErrorCode.ModerationUnavailable,
      ErrorCode.InternalError,
    ]),
    message: z.string().optional(),
    details: z.unknown().optional(),
  })
  .openapi('Error')
