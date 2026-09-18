export const Decision = {
  allow: 'allow',
  flag: 'flag',
  block: 'block',
} as const

export type Decision = (typeof Decision)[keyof typeof Decision]

export type ModerationInput = {
  text: string
  userId?: string
  signal?: AbortSignal
}

export type ModerationResult = {
  decision: Decision
  reason: string
  suggestedReply: string
}

export type CreateCommentInput = {
  idempotencyKey: string
  text: string
  userId?: string
}
