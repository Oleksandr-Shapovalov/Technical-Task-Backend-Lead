import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import swaggerUi from 'swagger-ui-express'
import { defaultHttp, type HttpLimits } from './config'
import type { CommentsModule } from './modules/comments'
import { ErrorCode, HttpStatus } from './shared/errors'
import { errorHandler } from './shared/middleware/error-handler'
import type { HealthCheck } from './shared/health/health.check'
import { healthRouter } from './shared/health/health.routes'
import { openApiDocumentForHost } from './shared/openapi'

export type AppContext = {
  comments: CommentsModule
  healthCheck: HealthCheck
  http?: HttpLimits
}

export function createApp(ctx: AppContext) {
  const http = ctx.http ?? defaultHttp
  const app = express()

  app.use(cors({ origin: http.corsOrigin }))
  app.use(
    rateLimit({
      windowMs: http.rateLimitWindowMs,
      limit: http.rateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ipv6Subnet: 56,
      skip: (req) => req.path.startsWith('/health'),
      handler: (_req, res) => {
        res.status(HttpStatus.TooManyRequests).json({
          error: ErrorCode.RateLimited,
          message: 'Too many requests',
        })
      },
    }),
  )
  app.use(express.json())
  app.use('/health', healthRouter(ctx.healthCheck))
  app.use('/comments', ctx.comments.router)
  app.get('/openapi.json', (req, res) => {
    res.json(openApiDocumentForHost(req.protocol, req.get('host')))
  })
  // Relative swagger-ui assets resolve only under /docs/. README links /docs.
  // Express treats /docs and /docs/ as the same route unless we check originalUrl.
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.originalUrl.split('?')[0] === '/docs') {
      res.redirect('/docs/')
      return
    }
    next()
  })
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, {
      swaggerUrl: '/openapi.json',
      swaggerOptions: { validatorUrl: null },
    }),
  )
  app.use(errorHandler)

  return app
}
