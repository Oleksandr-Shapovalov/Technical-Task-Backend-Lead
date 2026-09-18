import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AiModerationProvider,
  CommentsService,
  Decision,
  MockAiModerationProvider,
} from '../src/modules/comments'
import { ErrorCode, HttpStatus } from '../src/shared/errors'
import { createTestApp } from './helpers/create-test-app'
import { InMemoryCommentsRepo } from './helpers/in-memory.comments.repo'

const repo = new InMemoryCommentsRepo()
const provider = new MockAiModerationProvider()
const moderateSpy = vi.spyOn(provider, 'moderate')
const app = createTestApp({ repo, provider })

beforeEach(() => {
  repo.clear()
  moderateSpy.mockClear()
})

describe('POST /comments', () => {
  it('moderates and stores an allowed comment', async () => {
    const res = await request(app).post('/comments').send({
      idempotencyKey: 'happy-1',
      text: 'Hello, this is a nice comment',
      userId: 'user-1',
    })

    expect(res.status).toBe(HttpStatus.Created)
    expect(res.body).toMatchObject({
      idempotencyKey: 'happy-1',
      text: 'Hello, this is a nice comment',
      userId: 'user-1',
      decision: Decision.allow,
      reason: '',
      suggestedReply: '',
      provider: 'mock',
      model: 'keyword-v1',
    })
    expect(res.body.id).toBeDefined()
    expect(res.body.createdAt).toBeDefined()
    expect(moderateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello, this is a nice comment',
        userId: 'user-1',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('replays the same row and does not call the provider again', async () => {
    const first = await request(app).post('/comments').send({
      idempotencyKey: 'dup-1',
      text: 'Same key twice',
    })
    expect(first.status).toBe(HttpStatus.Created)
    expect(moderateSpy).toHaveBeenCalledTimes(1)

    const second = await request(app).post('/comments').send({
      idempotencyKey: 'dup-1',
      text: 'Same key twice',
    })

    expect(second.status).toBe(HttpStatus.Ok)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.text).toBe('Same key twice')
    expect(moderateSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a reused key when the comment content checksum differs', async () => {
    const first = await request(app).post('/comments').send({
      idempotencyKey: 'dup-mismatch-1',
      text: 'Original comment',
      userId: 'user-1',
    })
    expect(first.status).toBe(HttpStatus.Created)

    const second = await request(app).post('/comments').send({
      idempotencyKey: 'dup-mismatch-1',
      text: 'Different comment',
      userId: 'user-1',
    })

    expect(second.status).toBe(HttpStatus.Conflict)
    expect(second.body.error).toBe(ErrorCode.IdempotencyConflict)
    expect(moderateSpy).toHaveBeenCalledTimes(1)

    const stored = await repo.findByIdempotencyKey('dup-mismatch-1')
    expect(stored?.text).toBe('Original comment')
  })

  it('rejects invalid input without calling the provider', async () => {
    const missingText = await request(app).post('/comments').send({
      idempotencyKey: 'bad-1',
    })
    expect(missingText.status).toBe(HttpStatus.BadRequest)
    expect(missingText.body.error).toBe(ErrorCode.InvalidInput)

    const emptyKey = await request(app).post('/comments').send({
      idempotencyKey: '',
      text: 'hello',
    })
    expect(emptyKey.status).toBe(HttpStatus.BadRequest)

    expect(moderateSpy).not.toHaveBeenCalled()
  })

  it('returns 503 on provider failure and does not consume the idempotency key', async () => {
    const failing: AiModerationProvider = {
      name: 'mock',
      model: 'keyword-v1',
      moderate: vi.fn().mockRejectedValue(new Error('provider down')),
    }
    const failingApp = createTestApp({ repo, provider: failing })

    const failed = await request(failingApp).post('/comments').send({
      idempotencyKey: 'retry-1',
      text: 'please persist me later',
    })

    expect(failed.status).toBe(HttpStatus.ServiceUnavailable)
    expect(failed.body.error).toBe(ErrorCode.ModerationUnavailable)
    expect(failing.moderate).toHaveBeenCalledTimes(1)
    expect(await repo.findByIdempotencyKey('retry-1')).toBeNull()

    const recovered = await request(app).post('/comments').send({
      idempotencyKey: 'retry-1',
      text: 'please persist me later',
    })

    expect(recovered.status).toBe(HttpStatus.Created)
    expect(recovered.body.decision).toBe(Decision.allow)
  })

  it('returns a non-empty reason for flag and block', async () => {
    const flagged = await request(app).post('/comments').send({
      idempotencyKey: 'flag-1',
      text: 'please flag this comment',
    })
    expect(flagged.status).toBe(HttpStatus.Created)
    expect(flagged.body.decision).toBe(Decision.flag)
    expect(flagged.body.reason.length).toBeGreaterThan(0)
    expect(flagged.body.suggestedReply).toBe('')

    const blocked = await request(app).post('/comments').send({
      idempotencyKey: 'block-1',
      text: 'please block this comment',
    })
    expect(blocked.status).toBe(HttpStatus.Created)
    expect(blocked.body.decision).toBe(Decision.block)
    expect(blocked.body.reason.length).toBeGreaterThan(0)
    expect(blocked.body.suggestedReply).toBe('')
  })
})

describe('CommentsService.create', () => {
  it('runs one moderate call for concurrent creates with the same key', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: AiModerationProvider = {
      name: 'mock',
      model: 'keyword-v1',
      moderate: vi.fn(async () => {
        await gate
        return { decision: Decision.allow, reason: '', suggestedReply: '' }
      }),
    }
    const service = new CommentsService(repo, slow)
    const input = { idempotencyKey: 'inflight-1', text: 'hello from two callers' }

    const first = service.create(input)
    await vi.waitFor(() => {
      expect(slow.moderate).toHaveBeenCalledTimes(1)
    })

    const second = service.create(input)
    release()

    const [leader, waiter] = await Promise.all([first, second])
    expect(leader.created).toBe(true)
    expect(waiter.created).toBe(false)
    expect(waiter.comment.id).toBe(leader.comment.id)
    expect(slow.moderate).toHaveBeenCalledTimes(1)
  })

  it('rejects an in-flight reuse when the content checksum differs', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: AiModerationProvider = {
      name: 'mock',
      model: 'keyword-v1',
      moderate: vi.fn(async () => {
        await gate
        return { decision: Decision.allow, reason: '', suggestedReply: '' }
      }),
    }
    const service = new CommentsService(repo, slow)

    const first = service.create({ idempotencyKey: 'inflight-2', text: 'first payload' })
    await vi.waitFor(() => {
      expect(slow.moderate).toHaveBeenCalledTimes(1)
    })

    await expect(
      service.create({ idempotencyKey: 'inflight-2', text: 'second payload' }),
    ).rejects.toMatchObject({
      statusCode: HttpStatus.Conflict,
      code: ErrorCode.IdempotencyConflict,
    })

    release()
    const leader = await first
    expect(leader.created).toBe(true)
    expect(leader.comment.text).toBe('first payload')
    expect(slow.moderate).toHaveBeenCalledTimes(1)
  })
})

describe('GET /comments/:id', () => {
  it('returns the stored comment', async () => {
    const created = await request(app).post('/comments').send({
      idempotencyKey: 'get-1',
      text: 'Hello, this is a nice comment',
      userId: 'user-1',
    })
    expect(created.status).toBe(HttpStatus.Created)

    const fetched = await request(app).get(`/comments/${created.body.id}`)
    expect(fetched.status).toBe(HttpStatus.Ok)
    expect(fetched.body).toEqual(created.body)
  })

  it('returns 400 for an invalid id', async () => {
    const invalid = await request(app).get('/comments/not-a-uuid')
    expect(invalid.status).toBe(HttpStatus.BadRequest)
    expect(invalid.body.error).toBe(ErrorCode.InvalidInput)
  })

  it('returns 404 for a missing comment', async () => {
    const missing = await request(app).get('/comments/00000000-0000-4000-8000-000000000000')
    expect(missing.status).toBe(HttpStatus.NotFound)
    expect(missing.body.error).toBe(ErrorCode.NotFound)
  })
})

describe('GET /health', () => {
  it('reports api and database status', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(HttpStatus.Ok)
    expect(res.body).toEqual({ status: 'ok', db: 'up' })
  })
})
