import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { MockAiModerationProvider } from '../src/modules/comments'
import { ErrorCode, HttpStatus } from '../src/shared/errors'
import { createTestApp } from './helpers/create-test-app'
import { InMemoryCommentsRepo } from './helpers/in-memory.comments.repo'

const repo = new InMemoryCommentsRepo()
const provider = new MockAiModerationProvider()

describe('CORS and rate limit', () => {
  it('sets Access-Control-Allow-Origin from config', async () => {
    const app = createTestApp({
      repo,
      provider,
      http: {
        corsOrigin: '*',
        rateLimitWindowMs: 60_000,
        rateLimitMax: 100,
      },
    })

    const res = await request(app).get('/health').set('Origin', 'http://example.com')
    expect(res.status).toBe(HttpStatus.Ok)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('returns 429 after the per-IP limit and does not count /health', async () => {
    const app = createTestApp({
      repo,
      provider,
      http: {
        corsOrigin: '*',
        rateLimitWindowMs: 60_000,
        rateLimitMax: 1,
      },
    })

    const first = await request(app).post('/comments').send({
      idempotencyKey: 'rl-1',
      text: 'hello',
    })
    expect(first.status).toBe(HttpStatus.Created)

    const limited = await request(app).post('/comments').send({
      idempotencyKey: 'rl-2',
      text: 'hello again',
    })
    expect(limited.status).toBe(HttpStatus.TooManyRequests)
    expect(limited.body.error).toBe(ErrorCode.RateLimited)

    const health = await request(app).get('/health')
    expect(health.status).toBe(HttpStatus.Ok)
  })
})

describe('OpenAPI / Swagger UI', () => {
  it('serves the spec with an absolute http(s) server URL', async () => {
    const app = createTestApp({ repo, provider })

    const res = await request(app).get('/openapi.json').set('Host', 'localhost:3000')

    expect(res.status).toBe(HttpStatus.Ok)
    expect(res.body.servers).toEqual([{ url: 'http://localhost:3000' }])
    expect(res.body.paths['/comments']).toBeDefined()
    expect(res.body.paths['/comments/{id}']).toBeDefined()
    expect(res.body.paths['/health']).toBeDefined()
  })

  it('redirects /docs to /docs/ and serves Swagger UI', async () => {
    const app = createTestApp({ repo, provider })

    const redirect = await request(app).get('/docs')
    expect(redirect.status).toBe(302)
    expect(redirect.headers.location).toBe('/docs/')

    const ui = await request(app).get('/docs/')
    expect(ui.status).toBe(HttpStatus.Ok)
    expect(ui.text).toContain('swagger-ui')
  })
})
