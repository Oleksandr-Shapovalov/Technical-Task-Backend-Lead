import { AiModerationProvider } from './ai-moderation.provider'
import { Decision, ModerationInput, ModerationResult } from './comments.types'

export class MockAiModerationProvider implements AiModerationProvider {
  readonly name = 'mock'
  readonly model = 'keyword-v1'

  async moderate(input: ModerationInput): Promise<ModerationResult> {
    input.signal?.throwIfAborted()

    const text = input.text.toLowerCase()

    if (text.includes(Decision.block)) {
      return {
        decision: Decision.block,
        reason: 'Comment matches block keyword.',
        suggestedReply: '',
      }
    }

    if (text.includes(Decision.flag)) {
      return {
        decision: Decision.flag,
        reason: 'Comment matches flag keyword.',
        suggestedReply: '',
      }
    }

    return {
      decision: Decision.allow,
      reason: '',
      suggestedReply: '',
    }
  }
}
