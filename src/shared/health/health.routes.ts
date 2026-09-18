import { Router } from 'express'
import { HttpStatus } from '../errors'
import { HealthCheck } from './health.check'

export function healthRouter(check: HealthCheck): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      await check()
      res.json({ status: 'ok', db: 'up' })
    } catch {
      res.status(HttpStatus.ServiceUnavailable).json({ status: 'degraded', db: 'down' })
    }
  })

  return router
}
