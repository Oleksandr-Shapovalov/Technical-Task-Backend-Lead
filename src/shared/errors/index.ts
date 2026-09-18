export const HttpStatus = {
  Ok: 200,
  Created: 201,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  TooManyRequests: 429,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus]

export const ErrorCode = {
  InvalidInput: 'invalid_input',
  NotFound: 'not_found',
  IdempotencyConflict: 'idempotency_conflict',
  RateLimited: 'rate_limited',
  ModerationUnavailable: 'moderation_unavailable',
  InternalError: 'internal_error',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: HttpStatus,
    readonly code: ErrorCode,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, HttpStatus.NotFound, ErrorCode.NotFound)
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message = 'Upstream provider unavailable') {
    super(message, HttpStatus.ServiceUnavailable, ErrorCode.ModerationUnavailable)
  }
}

export class UniqueConflictError extends Error {
  constructor(message = 'Unique constraint violated') {
    super(message)
    this.name = 'UniqueConflictError'
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'idempotencyKey already used with different content') {
    super(message, HttpStatus.Conflict, ErrorCode.IdempotencyConflict)
  }
}
