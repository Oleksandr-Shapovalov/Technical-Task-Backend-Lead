import { describe, expect, it } from 'vitest'
import { commentContentChecksum } from '../src/modules/comments'

describe('commentContentChecksum', () => {
  it('is stable for the same text and userId', () => {
    expect(commentContentChecksum({ text: 'hello', userId: 'u1' })).toBe(
      commentContentChecksum({ text: 'hello', userId: 'u1' }),
    )
  })

  it('treats missing and null userId as the same payload', () => {
    expect(commentContentChecksum({ text: 'hello' })).toBe(
      commentContentChecksum({ text: 'hello', userId: null }),
    )
  })

  it('changes when text or userId changes', () => {
    const base = commentContentChecksum({ text: 'hello', userId: 'u1' })
    expect(commentContentChecksum({ text: 'HELLO', userId: 'u1' })).not.toBe(base)
    expect(commentContentChecksum({ text: 'hello', userId: 'u2' })).not.toBe(base)
  })
})
