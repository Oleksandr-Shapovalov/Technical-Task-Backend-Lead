import { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { AppError, ErrorCode, HttpStatus } from '../errors'
import { logger } from '../logger'

const httpLogger = logger.child('http')

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(HttpStatus.BadRequest).json({
      error: ErrorCode.InvalidInput,
      details: err.flatten(),
    })
    return
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(HttpStatus.BadRequest).json({
      error: ErrorCode.InvalidInput,
      message: 'Invalid JSON',
    })
    return
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    })
    return
  }

  httpLogger.error('unhandled request error', err)
  res.status(HttpStatus.InternalServerError).json({ error: ErrorCode.InternalError })
}
