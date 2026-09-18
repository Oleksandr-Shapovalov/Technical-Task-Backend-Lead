import 'dotenv/config'
import { createApp } from './app'
import { config } from './config'
import { createContainer } from './container'
import { prisma } from './shared/db/client'
import { logger } from './shared/logger'

async function main() {
  const app = createApp(createContainer({ prisma }))

  const server = app.listen(config.port, config.host, () => {
    logger.info('listening', {
      host: config.host,
      port: config.port,
      corsOrigin: config.corsOrigin,
      rateLimitMax: config.rateLimitMax,
      rateLimitWindowMs: config.rateLimitWindowMs,
    })
  })

  const shutdown = (signal: string) => {
    logger.info('shutdown', { signal })
    server.close((closeErr) => {
      void prisma.$disconnect().finally(() => {
        process.exit(closeErr ? 1 : 0)
      })
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error('fatal', err)
  process.exit(1)
})
