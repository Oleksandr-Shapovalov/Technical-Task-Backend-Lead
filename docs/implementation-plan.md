# v1 Implementation Plan — Comment Moderation API

Source of truth for generating the service. Written after reading the brief (`docs/offline-task-oleksandr-shapovalov.pdf`) and Ran Mizrahi’s answers (17 Sept 2026). Do not invent extra product behavior. A real LLM, pending-then-update, auth, queues, and a public deploy are out of scope for this slice.

---

## 1. Product contract

### Brief

A community product receives short user comments. v1 must:

1. Accept a comment (`POST`) with `idempotencyKey`, `text`, optional `userId`.
2. Moderate it through a replaceable `AiModerationProvider` that returns `{ decision, reason, suggestedReply }`. `decision` is `allow | flag | block`.
3. Persist the comment and the moderation result, including which provider/model produced it.
4. Fetch by id (`GET`).
5. Health check.
6. The same `idempotencyKey` must not call the provider again.
7. Tests: happy path, duplicate key, invalid input.

Default AI is a **deterministic mock**. Reviewer must run the service **without an API key**.

Synthetic text only. Max 2000 characters. No auth.

### Ran’s answers (17 Sept 2026) — treat as spec

**Moderation states**

| Decision | Meaning | `reason` | `suggestedReply` |
| --- | --- | --- | --- |
| `allow` | Comment can be shown | string, may be `""` | string, may be `""` |
| `flag` | Hold for human review; do not auto-publish | string, **must be non-empty** | string, may be `""` |
| `block` | Reject and do not show | string, **must be non-empty** | string, may be `""` |

Always return `reason` and `suggestedReply` as strings. Never `null`. Never omit the fields.

**Provider failure (v1)**

- Call the provider **first**. Persist **only if moderation succeeds**.
- If the provider fails: HTTP **503**, **do not save a row**, **do not consume** `idempotencyKey` so a retry may call the provider again.
- Pending-then-update is **v2**. Do not build it.

---

## 2. Non-goals (explicit)

Out of scope per brief: frontend, mobile, queues, Kafka, Saga, Kubernetes, authentication product, requiring a real OpenAI/Anthropic key, webhooks, blockchain, extra microservices.

Cut for the 90-minute budget:

- Public HTTPS deploy (Compose is the runnable artifact).
- Real LLM client (keep the same interface so v2 is a new class + env switch).
- Redis, jobs, human-review queue.
- Pending moderation row.
- Auth.

---

## 3. Stack

| Choice | Why |
| --- | --- |
| Node.js 20+ / TypeScript (strict) | Natural fit for the role; types on the provider boundary. |
| Express | I know Express. NestJS is too big for a 90-minute slice; I do not know Fastify. |
| `cors` + `express-rate-limit` | Express-level CORS and per-IP rate limit. No Redis, no reverse-proxy config. |
| Zod | Request validation + OpenAPI from the same schemas. |
| Prisma + PostgreSQL | Unique index on `idempotencyKey` as the second line of defense; migrations in repo. |
| Vitest + supertest | HTTP tests without a running database. |
| Docker Compose | Reviewer runs API + Postgres with one command. |
| Mock provider | No API key. Deterministic. |

Reject: NestJS (too big for this slice), Fastify (I do not know it).

---

## 4. Architecture

```
HTTP (cors + rate-limit + Express + Zod)
  → CommentsService
       1. lookup by idempotencyKey; compare SHA-256({ text, userId })
       2. AiModerationProvider.moderate(signal)  // one in-flight call per key+checksum
       3. persist comment + moderation result in one transaction
  → CommentsRepository
       Prisma (production) | in-memory (tests)
```

`AiModerationProvider` is an interface (`name`, `model`, `moderate`). v1 ships `MockAiModerationProvider`. A real LLM in v2 is a new class behind the same interface, selected by config — no rewrite of HTTP or persistence.

### Layers

```
src/
  app.ts                 composition: cors, rate-limit, json, routes, docs, error handler
  server.ts              process entry: listen, SIGTERM/SIGINT, prisma disconnect
  container.ts           wires Prisma repo + comments module + health check + HttpLimits from config
  config/index.ts        Zod env + `HttpLimits` / `defaultHttp`
  modules/comments/      bounded context
  shared/                errors, logger, middleware, health, db, openapi
```

Comments module files:

| File | Responsibility |
| --- | --- |
| `comments.types.ts` | `Decision`, `ModerationInput`, `ModerationResult`, `CreateCommentInput` |
| `ai-moderation.provider.ts` | `AiModerationProvider` interface |
| `mock.provider.ts` | keyword mock |
| `comments.schema.ts` | Zod body/params/response + OpenAPI |
| `comments.checksum.ts` | SHA-256 of `{ text, userId }` for idempotency fingerprint |
| `comments.mapper.ts` | Prisma row → `CommentRecord`; serialize dates to ISO |
| `comments.repository.ts` | interface + Prisma implementation |
| `comments.service.ts` | idempotency + checksum + moderate + persist |
| `comments.routes.ts` | POST `/`, GET `/:id` |
| `comments.module.ts` | factory: service + router |
| `index.ts` | public exports |

Shared:

| File | Responsibility |
| --- | --- |
| `shared/errors/` | `HttpStatus`, `ErrorCode`, `AppError`, `NotFoundError`, `ProviderUnavailableError`, `UniqueConflictError`, `IdempotencyConflictError`, error OpenAPI schema |
| `shared/middleware/error-handler.ts` | Zod → 400, `AppError` → status, else 500 |
| `shared/health/` | `SELECT 1` check; `{ status, db }`; 503 if DB down |
| `shared/logger/` | JSON stdout/stderr, levels, `child(scope)` |
| `shared/db/` | Prisma client + pg adapter |
| `shared/openapi.ts` | register the 3 paths; document at `/openapi.json`; Swagger UI at `/docs` |

Tests inject `CommentsRepository` + `AiModerationProvider` via `createCommentsModule` / `createApp`. No Prisma in `npm test`.

---

## 5. Domain types

```ts
Decision = 'allow' | 'flag' | 'block'  // const object, not a TS enum at the boundary

ModerationInput = { text: string; userId?: string; signal?: AbortSignal }

ModerationResult = {
  decision: Decision
  reason: string
  suggestedReply: string
}

CreateCommentInput = {
  idempotencyKey: string
  text: string
  userId?: string
}

AiModerationProvider = {
  readonly name: string
  readonly model: string
  moderate(input: ModerationInput): Promise<ModerationResult>
}
```

API record (comment flattened with the **latest** moderation result):

```ts
CommentRecord = {
  id: uuid
  idempotencyKey: string
  text: string
  userId: string | null
  decision: Decision
  reason: string
  suggestedReply: string
  provider: string
  model: string
  createdAt: Date
}
```

HTTP JSON uses `createdAt` as ISO-8601 string.

---

## 6. Mock provider

`name = 'mock'`, `model = 'keyword-v1'`.

Case-insensitive substring on `text`:

1. contains `block` → `{ decision: 'block', reason: 'Comment matches block keyword.', suggestedReply: '' }`
2. else contains `flag` → `{ decision: 'flag', reason: 'Comment matches flag keyword.', suggestedReply: '' }`
3. else → `{ decision: 'allow', reason: '', suggestedReply: '' }`

Respect `input.signal?.throwIfAborted()` so the service timeout can cancel.

Service-side guard: if decision is `flag` or `block` and `reason.trim() === ''`, treat as provider failure (503, do not persist).

Moderation timeout: 10 seconds via `AbortController`. Any throw from `moderate` → `ProviderUnavailableError` (503).

Concurrent `create`s with the same `idempotencyKey` and content checksum share one in-flight `moderate` promise, so the provider is called once per key. Same key with a different checksum is `409`.

---

## 7. Data model

Postgres. Prisma schema at `prisma/schema.prisma`. One init migration.

### `comments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK, default uuid |
| `idempotencyKey` | string | **unique** |
| `text` | string | |
| `userId` | string? | optional |
| `createdAt` | datetime | default now |

### `comment_moderation_results`

1:N from comment. v1 writes one result in the same transaction. Latest-by-`createdAt` is what the API returns (ready for v2 re-moderation without rewriting GET).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `commentId` | UUID | FK → `comments.id`, onDelete Cascade, indexed |
| `decision` | enum `allow \| flag \| block` | |
| `reason` | string | never null |
| `suggestedReply` | string | never null |
| `provider` | string | e.g. `mock` |
| `model` | string | e.g. `keyword-v1` |
| `createdAt` | datetime | default now |

Prisma client generated to `src/generated/prisma` (gitignored). `prisma generate` on postinstall.

`CommentsRepo.create` runs in `$transaction`: insert comment, insert result. Map Prisma `P2002` → `UniqueConflictError`.

---

## 8. Service flow (`CommentsService.create`)

```
checksum = SHA-256({ text, userId })

1. repo.findByIdempotencyKey(key)
   hit + same checksum     → return { comment, created: false }   // HTTP 200, skip provider
   hit + different checksum → IdempotencyConflictError            // HTTP 409, do not overwrite
2. provider.moderate({ text, userId, signal }) with 10s abort
   in-flight Map keyed by idempotencyKey, stores checksum
   same key + same checksum     → share the pending promise       // one provider call
   same key + different checksum → IdempotencyConflictError       // HTTP 409
   throw → ProviderUnavailableError                               // HTTP 503, no insert
3. assertModeration(result)                    // empty reason on flag/block → 503
4. repo.create(input, { ...result, provider, model })
   UniqueConflictError → re-fetch by key
     same checksum     → return { comment, created: false }
     different checksum → IdempotencyConflictError            // HTTP 409
   (concurrent duplicate: unique index is the second line of defense)
```

`getById`: find or `NotFoundError`.

In-process: two in-flight requests with the same key **and** checksum share one `moderate` call. Same key with different content is `409` (replay, in-flight, and unique-index race). Across processes the unique index still prevents duplicate rows. A pending row is intentionally not used.

---

## 9. HTTP API

Base: Express. Middleware order in `createApp`: cors → rate-limit → json → routes → error handler.

| Method | Path | Status |
| --- | --- | --- |
| POST | `/comments` | `201` created, `200` idempotent replay, `400` invalid, `409` same key / different content, `429` rate limited, `503` provider down |
| GET | `/comments/:id` | `200`, `400` invalid id (not a UUID), `404` |
| GET | `/health` | `200` `{ status: "ok", db: "up" }`, `503` `{ status: "degraded", db: "down" }` |
| GET | `/docs` | Swagger UI from Zod schemas (`GET /openapi.json`) |

### POST `/comments`

Body (Zod):

- `idempotencyKey`: string, min 1, max 128
- `text`: string, min 1, max 2000
- `userId`: optional string, min 1, max 128

Invalid body or invalid JSON → `400` `{ error: "invalid_input", ... }`. Do not call the provider.

Response (201/200):

```json
{
  "id": "<uuid>",
  "idempotencyKey": "cmt-001",
  "text": "Hello",
  "userId": "user-42",
  "decision": "allow",
  "reason": "",
  "suggestedReply": "",
  "provider": "mock",
  "model": "keyword-v1",
  "createdAt": "2026-09-18T00:00:00.000Z"
}
```

`userId` is `null` in JSON when omitted.

503 body: `{ error: "moderation_unavailable", message: "..." }`.

409 body: `{ error: "idempotency_conflict", message: "..." }`. Same `idempotencyKey` reused with a different `{ text, userId }` checksum.

429 body: `{ error: "rate_limited", message: "Too many requests" }`.

### GET `/comments/:id`

`id` must be UUID. Replay the same shape as POST.

### Error codes

`invalid_input` | `not_found` | `idempotency_conflict` | `rate_limited` | `moderation_unavailable` | `internal_error`

---

## 10. Config, logging, process

Env (Zod, `.env.example`):

```
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/moderation
LOG_LEVEL=info
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / POSTGRES_PORT   # compose only
```

Missing `DATABASE_URL` or invalid `PORT` → throw on boot.

`HttpLimits` and `defaultHttp` live in `src/config/index.ts` (not in `app.ts`):

```ts
HttpLimits = {
  corsOrigin: string
  rateLimitWindowMs: number
  rateLimitMax: number
}

defaultHttp = { corsOrigin: '*', rateLimitWindowMs: 60_000, rateLimitMax: 100 }
```

Env defaults for `CORS_ORIGIN` / `RATE_LIMIT_*` come from `defaultHttp`. `createApp` uses `ctx.http ?? defaultHttp`. `createContainer` passes `{ corsOrigin, rateLimitWindowMs, rateLimitMax }` from `config`.

CORS and rate limit are Express middleware in `createApp` (before `express.json()`):

- `cors({ origin })` — default `*`.
- `express-rate-limit`: `RATE_LIMIT_MAX` per IP per `RATE_LIMIT_WINDOW_MS` (default 100/min). In-memory, per process. Skip `/health` so Compose healthchecks are not counted. `429` `{ error: "rate_limited" }`.

Logger: JSON lines, scopes (`app`, `app.http`), `LOG_LEVEL` filter. Errors/warn → stderr.

`server.ts`: `app.listen`, log host/port/cors/rate-limit, SIGTERM/SIGINT close server then `prisma.$disconnect`.

---

## 11. Tests (no database)

Vitest + supertest. In-memory `CommentsRepository` behind the same interface. `createTestApp({ repo, provider })`.

Required by brief:

1. **Happy path** — POST allow → 201, fields present, GET by id returns the same body, provider called once.
2. **Duplicate key** — second POST with same key **and** same content checksum → 200, same `id`/`text` as first, provider still called once. Same key, different checksum → 409 `idempotency_conflict`. Concurrent same-key+checksum creates share one in-flight `moderate` call.
3. **Invalid input** — missing `text` / empty key → 400, provider not called.

Required by Ran / this plan:

4. **Provider 503** — `moderate` rejects → 503 `moderation_unavailable`, no row for that key; retry with working provider → 201 (key was not consumed).
5. **flag / block reason** — text containing `flag` / `block` → non-empty `reason`, `suggestedReply` `""`.
6. GET invalid id → 400; unknown UUID → 404.
7. Health → `{ status: "ok", db: "up" }` with noop check.
8. Unit: mock provider allow/flag/block + aborted signal.
9. Unit: `loadConfig` defaults, explicit values, rejects missing `DATABASE_URL` / bad `PORT`.
10. CORS: `Access-Control-Allow-Origin` from `HttpLimits.corsOrigin`.
11. Rate limit: `RATE_LIMIT_MAX=1` → second POST `/comments` is `429` `rate_limited`; `GET /health` still `200` (skipped).

In-memory repo must throw `UniqueConflictError` on duplicate key (mirrors Prisma `P2002`).

Default `npm test` must not require Postgres. Prisma + unique index are exercised when the API runs via Compose.

---

## 12. Docker / run

`docker-compose.yml`:

- `postgres:16-alpine`, healthcheck `pg_isready`, volume `postgres_data`, bind `127.0.0.1:5432` only.
- `api` build from `Dockerfile`, depends on healthy postgres, `DATABASE_URL` on the compose network, publish `${PORT:-3000}:3000`, HTTP healthcheck against `/health`, `restart: unless-stopped`.

Dockerfile: Node 22 Alpine, openssl for Prisma, multi-stage (`deps` → `build` → `runner`). Entrypoint: `prisma migrate deploy` then `node dist/server.js`. Run as `node` user.

`.env.example` in repo. `.env` gitignored.

Reviewer path:

```bash
cp .env.example .env
docker compose up --build
```

API `http://localhost:3000`, health `/health`, docs `/docs`.

Local without Compose (Postgres already on localhost:5432): `npm install`, `npx prisma migrate deploy`, `npm run dev`.

---

## 13. Tooling (keep small)

- `package.json` scripts: `dev` (tsx watch), `build`/`start:prod`, `test`, `lint`, `format`, prisma generate/migrate, `postinstall: prisma generate`.
- ESLint (typescript-eslint) + Prettier.
- `tsconfig`: CommonJS, ES2022, strict, `rootDir: src`, `outDir: dist`.
- Gitignore: `node_modules`, `dist`, `.env`, `src/generated`, coverage.

---

## 14. v2 (do not build)

- `OpenAiModerationProvider` (or Anthropic) implementing `AiModerationProvider`, structured output, `AI_PROVIDER=mock|openai`.
- Optional pending row + update after moderation, retries, human-review queue for `flag`.
- Public HTTPS (Railway / Render from a GitHub branch).

---

## 15. Implementation order

Work from this plan in several steps. README is last, after the code exists and has been checked.

1. Scaffold (`package.json`, tsconfig, eslint/prettier, `.env.example`, gitignore).
2. Prisma schema + init migration + db client (`comments` + `comment_moderation_results`).
3. Domain types, provider interface, mock, checksum, service, Prisma repo, mapper.
4. Express app, routes, error handler, health, OpenAPI (`/openapi.json` + `/docs`), config (`HttpLimits` / `defaultHttp`), CORS, rate limit, logger, server, container.
5. In-memory repo + HTTP tests + mock/config unit tests.
6. Dockerfile, entrypoint, Compose.
7. Targeted fixes against the generated files, then `npm test` + Compose + manual `POST`/`GET`/`/health`.
8. Reviewer README last (assumptions, architecture, API, data model, idempotency, how to run/tests, trade-offs, minutes, AI usage log). Align it with this plan; do not copy the file-by-file tables.

Generate the code from this plan. If a choice is not listed, pick the smallest thing that satisfies the contract above.
