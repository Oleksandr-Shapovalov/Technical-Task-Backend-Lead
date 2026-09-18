import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { commentResponseSchema, createCommentBodySchema } from '../modules/comments'
import { errorResponseSchema } from './errors/error.schema'
import { HttpStatus } from './errors'
import { healthResponseSchema } from './health/health.schema'

const registry = new OpenAPIRegistry()

registry.register('Comment', commentResponseSchema)
registry.register('Error', errorResponseSchema)

// Paths live here while the API is small (3 endpoints) so the contract is
// reviewable in one place. If a second domain appears, move each registerPath
// into the module as register*OpenApi(registry) and keep this file as the
// composition root (shared components + generateDocument).
registry.registerPath({
  method: 'post',
  path: '/comments',
  summary: 'Submit a comment for moderation',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createCommentBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    [HttpStatus.Created]: {
      description: 'Comment moderated and stored',
      content: { 'application/json': { schema: commentResponseSchema } },
    },
    [HttpStatus.Ok]: {
      description: 'Idempotent replay of an existing comment',
      content: { 'application/json': { schema: commentResponseSchema } },
    },
    [HttpStatus.BadRequest]: {
      description: 'Invalid input',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    [HttpStatus.Conflict]: {
      description: 'idempotencyKey already used with different comment content',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    [HttpStatus.TooManyRequests]: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    [HttpStatus.ServiceUnavailable]: {
      description: 'Moderation provider unavailable; idempotency key is not consumed',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/comments/{id}',
  summary: 'Get a moderated comment by id',
  request: {
    params: commentResponseSchema.pick({ id: true }),
  },
  responses: {
    [HttpStatus.Ok]: {
      description: 'Comment found',
      content: { 'application/json': { schema: commentResponseSchema } },
    },
    [HttpStatus.BadRequest]: {
      description: 'Invalid id',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    [HttpStatus.NotFound]: {
      description: 'Not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Health check',
  responses: {
    [HttpStatus.Ok]: {
      description: 'API and database are up',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
    [HttpStatus.ServiceUnavailable]: {
      description: 'Database is down',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
})

const generator = new OpenApiGeneratorV31(registry.definitions)

export const openApiDocument = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Comment Moderation API',
    version: '1.0.0',
    description:
      'v1 comment moderation. Default AI provider is a deterministic mock. No API key required.',
  },
  servers: [{ url: '/' }],
})

// Swagger UI "Try it out" needs an absolute http(s) server. A relative "/" in an
// inlined spec is joined into "//comments", which the browser rejects as a CORS
// request with no scheme.
export function openApiDocumentForHost(protocol: string, host: string | undefined) {
  return {
    ...openApiDocument,
    servers: [{ url: host ? `${protocol}://${host}` : '/' }],
  }
}
