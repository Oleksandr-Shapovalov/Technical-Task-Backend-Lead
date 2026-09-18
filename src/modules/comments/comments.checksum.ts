import { createHash } from 'node:crypto'

export type CommentContent = {
  text: string
  userId?: string | null
}

export function commentContentChecksum(content: CommentContent): string {
  return createHash('sha256')
    .update(JSON.stringify({ text: content.text, userId: content.userId ?? null }))
    .digest('hex')
}
