import { Router } from 'express'
import { AiModerationProvider } from './ai-moderation.provider'
import { CommentsRepository } from './comments.repository'
import { commentsRouter } from './comments.routes'
import { CommentsService } from './comments.service'
import { MockAiModerationProvider } from './mock.provider'

export type CommentsModuleDeps = {
  repo: CommentsRepository
  provider?: AiModerationProvider
}

export type CommentsModule = {
  service: CommentsService
  router: Router
}

export function createCommentsModule(deps: CommentsModuleDeps): CommentsModule {
  const service = new CommentsService(deps.repo, deps.provider ?? new MockAiModerationProvider())

  return {
    service,
    router: commentsRouter(service),
  }
}
