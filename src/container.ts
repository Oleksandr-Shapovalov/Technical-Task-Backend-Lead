import type { AppContext } from './app'
import { config } from './config'
import { CommentsRepo, createCommentsModule } from './modules/comments'
import { PrismaClient } from './shared/db/prisma'
import { prismaHealthCheck } from './shared/health/health.check'

export type Infrastructure = {
  prisma: PrismaClient
}

export function createContainer(infra: Infrastructure): AppContext {
  return {
    comments: createCommentsModule({
      repo: new CommentsRepo(infra.prisma),
    }),
    healthCheck: prismaHealthCheck(infra.prisma),
    http: {
      corsOrigin: config.corsOrigin,
      rateLimitWindowMs: config.rateLimitWindowMs,
      rateLimitMax: config.rateLimitMax,
    },
  }
}
