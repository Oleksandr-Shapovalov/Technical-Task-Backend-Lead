import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const validEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/moderation',
}

describe('loadConfig', () => {
  it('applies defaults for optional env vars', () => {
    expect(loadConfig(validEnv)).toEqual({
      port: 3000,
      host: '0.0.0.0',
      databaseUrl: validEnv.DATABASE_URL,
      logLevel: 'info',
      corsOrigin: '*',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 100,
    })
  })

  it('parses explicit values', () => {
    expect(
      loadConfig({
        ...validEnv,
        PORT: '8080',
        HOST: '127.0.0.1',
        LOG_LEVEL: 'debug',
        CORS_ORIGIN: 'http://localhost:3000',
        RATE_LIMIT_WINDOW_MS: '15000',
        RATE_LIMIT_MAX: '20',
      }),
    ).toEqual({
      port: 8080,
      host: '127.0.0.1',
      databaseUrl: validEnv.DATABASE_URL,
      logLevel: 'debug',
      corsOrigin: 'http://localhost:3000',
      rateLimitWindowMs: 15_000,
      rateLimitMax: 20,
    })
  })

  it('rejects missing DATABASE_URL and invalid PORT', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/)
  })
})
