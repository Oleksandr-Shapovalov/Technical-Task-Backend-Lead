import { describe, expect, it } from 'vitest'
import { Decision, MockAiModerationProvider } from '../src/modules/comments'

const provider = new MockAiModerationProvider()

describe('MockAiModerationProvider', () => {
  it('allows text without keywords and returns empty strings', async () => {
    await expect(provider.moderate({ text: 'hello there' })).resolves.toEqual({
      decision: Decision.allow,
      reason: '',
      suggestedReply: '',
    })
  })

  it('flags and blocks with a non-empty reason', async () => {
    await expect(provider.moderate({ text: 'please flag me' })).resolves.toMatchObject({
      decision: Decision.flag,
      suggestedReply: '',
    })
    await expect(provider.moderate({ text: 'please block me' })).resolves.toMatchObject({
      decision: Decision.block,
      suggestedReply: '',
    })

    const flagged = await provider.moderate({ text: 'flag' })
    const blocked = await provider.moderate({ text: 'block' })
    expect(flagged.reason.length).toBeGreaterThan(0)
    expect(blocked.reason.length).toBeGreaterThan(0)
  })

  it('throws when the abort signal is already aborted', async () => {
    const signal = AbortSignal.abort()
    await expect(provider.moderate({ text: 'hello', signal })).rejects.toThrow()
  })
})
