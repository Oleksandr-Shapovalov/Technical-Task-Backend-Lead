import { ModerationInput, ModerationResult } from './comments.types'

export interface AiModerationProvider {
  readonly name: string
  readonly model: string
  moderate(input: ModerationInput): Promise<ModerationResult>
}
