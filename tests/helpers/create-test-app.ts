import { createApp } from '../../src/app'
import type { HttpLimits } from '../../src/config'
import {
  createCommentsModule,
  type AiModerationProvider,
  type CommentsRepository,
} from '../../src/modules/comments'
import { noopHealthCheck } from '../../src/shared/health/health.check'

export function createTestApp(deps: {
  repo: CommentsRepository
  provider?: AiModerationProvider
  http?: HttpLimits
}) {
  return createApp({
    comments: createCommentsModule(deps),
    healthCheck: noopHealthCheck,
    http: deps.http,
  })
}
