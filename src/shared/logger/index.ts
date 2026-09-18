export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export const DEFAULT_LOG_LEVEL: LogLevel = 'info'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export type LogFields = Record<string, unknown>

type LoggerOptions = {
  scope?: string
  minLevel?: LogLevel
  parent?: Logger
}

function toErrorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, errStack: err.stack }
  }
  return { err: String(err) }
}

export class Logger {
  private readonly scope: string
  private minLevel: LogLevel
  private readonly parent?: Logger

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope ?? 'app'
    this.minLevel = options.minLevel ?? DEFAULT_LOG_LEVEL
    this.parent = options.parent
  }

  child(scope: string): Logger {
    return new Logger({
      scope: `${this.scope}.${scope}`,
      parent: this,
    })
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields)
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields)
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields)
  }

  error(message: string, errOrFields?: unknown, fields?: LogFields): void {
    if (errOrFields === undefined) {
      this.write('error', message, fields)
      return
    }

    if (errOrFields instanceof Error) {
      this.write('error', message, { ...toErrorFields(errOrFields), ...fields })
      return
    }

    if (typeof errOrFields === 'object' && errOrFields !== null && fields === undefined) {
      this.write('error', message, errOrFields as LogFields)
      return
    }

    this.write('error', message, { ...toErrorFields(errOrFields), ...fields })
  }

  private effectiveMinLevel(): LogLevel {
    return this.parent?.effectiveMinLevel() ?? this.minLevel
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVELS[level] < LEVELS[this.effectiveMinLevel()]) {
      return
    }

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      msg: message,
      ...fields,
    })

    const sink = level === 'error' || level === 'warn' ? process.stderr : process.stdout
    sink.write(`${line}\n`)
  }
}

export const logger = new Logger({ scope: 'app' })
