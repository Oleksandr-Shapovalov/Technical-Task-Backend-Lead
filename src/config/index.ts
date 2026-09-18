import 'dotenv/config'
import { z } from 'zod'
import { DEFAULT_LOG_LEVEL, LOG_LEVELS, logger, type LogLevel } from '../shared/logger'

export type HttpLimits = {
  corsOrigin: string
  rateLimitWindowMs: number
  rateLimitMax: number
}

export const defaultHttp: HttpLimits = {
  corsOrigin: '*',
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default(DEFAULT_LOG_LEVEL),
  CORS_ORIGIN: z.string().min(1).default(defaultHttp.corsOrigin),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(defaultHttp.rateLimitWindowMs),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(defaultHttp.rateLimitMax),
})

export type Config = {
  port: number
  host: string
  databaseUrl: string
  logLevel: LogLevel
} & HttpLimits

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid environment: ${details}`)
  }

  return {
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    databaseUrl: parsed.data.DATABASE_URL,
    logLevel: parsed.data.LOG_LEVEL,
    corsOrigin: parsed.data.CORS_ORIGIN,
    rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  }
}

export const config = loadConfig()
logger.setMinLevel(config.logLevel)
