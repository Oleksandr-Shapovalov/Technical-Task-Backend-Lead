import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    db: z.enum(['up', 'down']),
  })
  .openapi('Health')
