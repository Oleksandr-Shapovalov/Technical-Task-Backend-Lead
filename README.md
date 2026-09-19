# Comment Moderation API

v1 backend for short community comments: accept, moderate with a replaceable AI provider, persist the result, fetch by id.

**Candidate:** Oleksandr Shapovalov
**Time spent:** 84 minutes (no public deploy)

Default AI is a deterministic mock. No API key is required.

Original brief: [`docs/offline-task-oleksandr-shapovalov.pdf`](docs/offline-task-oleksandr-shapovalov.pdf)
Implementation plan (source of truth for this slice): [`docs/implementation-plan.md`](docs/implementation-plan.md)

## Assumptions

From the brief plus Ran Mizrahi’s answers (17 Sept 2026):


| Decision | Meaning                                    | `reason`                      | `suggestedReply`    |
| -------- | ------------------------------------------ | ----------------------------- | ------------------- |
| `allow`  | Comment can be shown                       | string, may be `""`           | string, may be `""` |
| `flag`   | Hold for human review; do not auto-publish | string, **must be non-empty** | string, may be `""` |
| `block`  | Reject and do not show                     | string, **must be non-empty** | string, may be `""` |


- `reason` and `suggestedReply` are always strings, never `null`, never omitted.
- v1 calls the provider first and persists only if moderation succeeds. Provider failure → `503`, no row, idempotency key is **not** consumed.
- A pending-then-update flow is out of scope (planned for v2).
- Duplicate `idempotencyKey` with the same `{ text, userId }` checksum returns the original stored row (`200`) and does not call the provider again. Same key, different checksum → `409`.
- Text is synthetic, 1–2000 characters after trim. Whitespace-only `text` is `400`. No auth.



## Architecture

```
src/
  app.ts                composition: cors, rate-limit, json, routes, docs, error handler
  server.ts             process entry: listen, SIGTERM/SIGINT, prisma disconnect
  container.ts          wires Prisma repo + comments module + health check + HttpLimits
  config/               Zod env + HttpLimits / defaultHttp
  modules/comments/     bounded context: routes → service → repository + AI provider
  shared/               errors, logger, middleware, health, db, openapi
```

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

Stack: Node 20+ / TypeScript, Express, Zod, Prisma/Postgres, Vitest, Compose. Express because I know it — NestJS is too big for a 90-minute slice; I do not know Fastify.

Tests inject `CommentsRepository` + `AiModerationProvider` via `createCommentsModule` / `createApp`. No Prisma in `npm test`.

## API

Middleware order in `createApp`: cors → rate-limit → json → routes → error handler.


| Method | Path            | Status                                                                                                                             |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/comments`     | `201` created, `200` idempotent replay, `400` invalid, `409` same key / different content, `429` rate limited, `503` provider down |
| GET    | `/comments/:id` | `200`, `400` invalid id (not a UUID), `404`                                                                                        |
| GET    | `/health`       | `200` `{ status: "ok", db: "up" }`, `503` `{ status: "degraded", db: "down" }`                                                     |
| GET    | `/docs`         | Swagger UI from Zod schemas (`GET /openapi.json`)                                                                                  |


**POST** `/comments`

Body (Zod): `idempotencyKey` 1–128 chars, `text` 1–2000 chars after trim (whitespace-only is invalid), optional `userId` 1–128 chars. Invalid body or invalid JSON → `400` `{ error: "invalid_input", ... }`. Do not call the provider.

```json
{
  "idempotencyKey": "cmt-001",
  "text": "Hello",
  "userId": "user-42"
}
```

**Response** (201/200)

```json
{
  "id": "…",
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

**GET** `/comments/:id` — three cases:

1. Existing comment → `200`, same shape as POST.
2. Invalid id (not a UUID) → `400` `{ error: "invalid_input", ... }`.
3. Unknown UUID → `404` `{ error: "not_found", ... }`.

Error bodies:


| Status | `error`                  | When                                                         |
| ------ | ------------------------ | ------------------------------------------------------------ |
| `400`  | `invalid_input`          | Invalid JSON, body, or `:id` (not a UUID)                    |
| `404`  | `not_found`              | Unknown UUID                                                 |
| `409`  | `idempotency_conflict`   | Same `idempotencyKey`, different `{ text, userId }` checksum |
| `429`  | `rate_limited`           | Per-IP limit exceeded                                        |
| `503`  | `moderation_unavailable` | Provider throw / timeout / empty `reason` on flag/block      |
| `500`  | `internal_error`         | Unexpected                                                   |




### Mock provider

`name = 'mock'`, `model = 'keyword-v1'`. Case-insensitive substring on `text`:

1. contains `block` → `{ decision: "block", reason: "Comment matches block keyword.", suggestedReply: "" }`
2. else contains `flag` → `{ decision: "flag", reason: "Comment matches flag keyword.", suggestedReply: "" }`
3. else → `{ decision: "allow", reason: "", suggestedReply: "" }`

Respects `AbortSignal`. Service timeout is 10 seconds. Empty `reason` on `flag`/`block` is treated as provider failure (`503`, do not persist).

## Data model

Postgres. Prisma schema at `prisma/schema.prisma`. One init migration. Client generated to `src/generated/prisma` (gitignored).

Table `comments`:


| Column           | Type     | Notes    |
| ---------------- | -------- | -------- |
| `id`             | UUID     | PK       |
| `idempotencyKey` | string   | unique   |
| `text`           | string   |          |
| `userId`         | string?  | optional |
| `createdAt`      | datetime |          |


Table `comment_moderation_results` (1:N, latest-by-`createdAt` is what the API returns — ready for v2 re-moderation without rewriting GET):


| Column           | Type     | Notes                                         |
| ---------------- | -------- | --------------------------------------------- |
| `id`             | UUID     | PK                                            |
| `commentId`      | UUID     | FK → `comments.id`, onDelete Cascade, indexed |
| `decision`       | enum     | `allow` \| `flag` \| `block`                  |
| `reason`         | string   | never null                                    |
| `suggestedReply` | string   | never null                                    |
| `provider`       | string   | e.g. `mock`                                   |
| `model`          | string   | e.g. `keyword-v1`                             |
| `createdAt`      | datetime |                                               |


v1 writes both rows in one transaction after the provider succeeds. Prisma `P2002` maps to `UniqueConflictError`.

## Idempotency

```
checksum = SHA-256({ text, userId })

1. repo.findByIdempotencyKey(key)
   hit + same checksum     → return stored row (HTTP 200, skip provider)
   hit + different checksum → 409, do not overwrite
2. provider.moderate({ text, userId, signal }) with 10s abort
   in-flight Map keyed by idempotencyKey, stores checksum
   same key + same checksum     → share the pending promise (one provider call)
   same key + different checksum → 409
   throw / timeout / empty reason on flag|block → 503, no insert, key remains free
3. Insert comment + result in one transaction.
   Unique index is the second line of defense: P2002 → re-fetch, same checksum → 200, else 409.
```

A pending row is intentionally not used. Coalescing is per process; multi-instance duplicates still rely on the unique index.

## How to run

```bash
cp .env.example .env
docker compose up --build
```

- API: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/health](http://localhost:3000/health)
- Swagger: [http://localhost:3000/docs](http://localhost:3000/docs)

Env (Zod, see `.env.example`): `PORT`, `HOST`, `DATABASE_URL`, `LOG_LEVEL`, `CORS_ORIGIN` (default `*`), `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` (default 100/min). Missing `DATABASE_URL` or invalid `PORT` → throw on boot.

CORS and rate limit are Express middleware. `/health` is not counted toward the limit. In-memory, per process. `429` `{ error: "rate_limited" }`.

Postgres is bound to `127.0.0.1:5432` only. Data is a named Docker volume (`postgres_data`). It survives `docker compose down` / rebuilds / host reboot. Wipe it only with `docker compose down -v`.

Local (Postgres already running on `localhost:5432`):

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev
```

`server.ts` listens, logs host/port/cors/rate-limit, and on SIGTERM/SIGINT closes the server then disconnects Prisma.

### Tests

No database required. HTTP tests use an in-memory repository behind the same `CommentsRepository` interface as Prisma. The in-memory repo throws `UniqueConflictError` on duplicate key (mirrors Prisma `P2002`).

```bash
npm test
```

Coverage of the brief + plan:

- Happy path: POST allow → 201, fields present, provider called once
- Duplicate key + same checksum → 200, provider still called once; same key, different checksum → `409`
- Concurrent same-key+checksum creates share one in-flight `moderate` call
- Invalid input → `400`, provider not called (including whitespace-only `text`)
- Provider `503` (`moderation_unavailable`): no row, key not consumed; retry → 201
- `flag` / `block` → non-empty `reason`, `suggestedReply` `""`
- GET existing comment → `200`, same body as POST
- GET invalid id → `400` `invalid_input`
- GET unknown UUID → `404` `not_found`
- Health `{ status: "ok", db: "up" }`
- CORS `Access-Control-Allow-Origin` from `HttpLimits`
- Rate limit: `RATE_LIMIT_MAX=1` → second POST is `429`; `GET /health` still `200`
- Unit: mock allow/flag/block + aborted signal; `loadConfig` defaults / rejects missing `DATABASE_URL` / bad `PORT`

Postgres + unique index are exercised when you run the API via Compose.

## Trade-offs / what was cut

- No public HTTPS deploy — Compose is the runnable artifact. Deploy options were identified (Railway, Render) but skipped so the slice stays inside 90 minutes.
- No real LLM in v1 (same interface, ready to plug in).
- No Redis, queues, auth, or pending moderation state. CORS and rate limit sit on Express (in-memory, per process).
- Concurrent duplicate keys in one process share one in-flight `moderate` call. Across processes the unique index still prevents duplicate rows.
- Default `npm test` uses an in-memory repo so reviewers can run tests without Postgres. Prisma + unique index run in Compose.



## Time spent


| Step                                                                             | Minutes |
| -------------------------------------------------------------------------------- | ------- |
| Read the brief, form assumptions, email clarifying questions, read Ran’s answers | 15      |
| Research + write `docs/implementation-plan.md`                                   | 30      |
| Implement from the plan in several steps (code, tests, Compose) + targeted fixes | 27      |
| Reviewer README last (after manual + tests + post-impl check)                    | 10      |
| Last-minute: reject whitespace-only `text` (see Updated)                         | 2       |
| **Total**                                                                        | **84**  |
| Public HTTPS deploy                                                              | skipped |


Going past 90 minutes would have been a negative signal. A working Compose slice beats an unfinished deploy.

## What I would do next

Public HTTPS was the remaining 15-20 minutes in the suggested split. I already had two free options and would have used one of them after pushing the repo:

1. **Railway** — 30 days of free credits, enough for reviewers to hit a health check and `POST`/`GET`. Connect the GitHub repo, pick this branch, deploy.
2. **Render** — free tier with limited CPU/RAM; enough for this service. Same flow: GitHub repo → this branch → web service + managed Postgres (or the Compose Postgres on a small instance).

Either way the deploy is “push the branch and attach it to the platform”, not a custom Kubernetes setup. After HTTPS: `OpenAiModerationProvider` behind the existing interface (`AI_PROVIDER=mock|openai`), then the v2 pending-then-update flow Ran described.

## AI usage log

The service was written with AI. Sequence: research the brief and write the plan, generate from that plan in several steps, targeted fixes, manual + tests, then a post-implementation check and this README last.


| Step | Tool | What I asked AI to do | What I kept | What I changed/rejected | Why |
| --- | --- | --- | --- | --- | --- |
| Research / plan | Claude Code | Turn the brief + Ran’s answers into a v1 plan: stack, layers, schema, idempotency, tests, Compose | `docs/implementation-plan.md` as the source of truth | NestJS, Fastify, TypeORM, pending-then-update, real LLM, extra services | NestJS is too big for a 90-min slice; I do not know Fastify; Ran forbids pending flow for v1 |
| Implementation | Cursor | Generate the service from that plan, in several steps | Scaffold; Prisma `comments` + `comment_moderation_results`; comments module (mock provider, checksum, service, repo); Express (Zod, OpenAPI, health, CORS, rate-limit, config); Vitest in-memory tests; Compose | Redis, queues, auth, OpenAI client, pending rows | Out of scope; not in the plan |
| Targeted fixes | Cursor | Correct drift after reading the generated files, then check again | Same architecture | Anything that persisted on provider failure or omitted `reason`/`suggestedReply` | Small generation mistakes; plan + Ran’s answers are the contract |
| Manual + tests | — | None — I ran the suite and the live slice myself | `npm test`; `docker compose up --build`; manual `POST` / `GET` / `/health` | Did not add a pending row or a real LLM | Confirm it matches the picture I already had before writing README |
| Post-impl check + README | Cursor | Diff the brief, Ran’s answers, and the plan against the code; write the reviewer README last and keep it aligned with the plan | Persist-only-on-success, reason rules, unique-index race, mock keywords; reviewer-facing README (assumptions, API, run, trade-offs, minutes) | Pending-row suggestions; copying the full plan (file-by-file tables, domain types dump) | Pending is v2; README is for a reviewer, not a second implementation spec |
| Last-minute whitespace check | Cursor | Reject `text` that is only spaces (`trim` then `min(1)`), add a test, mark this as Updated in the README | Schema + invalid-input test + this note | Did not start trimming `idempotencyKey` / `userId` or reopen the 90-minute scope | `min(1)` counts characters, not meaning — `"   "` was still a “valid” comment |


**Parts written without AI:** the clarifying questions to Ran; product decisions from his reply (allow/flag/block field rules, persist-only-on-success, do not consume the key on 503); choosing Express (NestJS too big, Fastify unknown); skipping public deploy to stay under 90 minutes; the manual + test pass above.

**How I verified AI output:** I already had a picture of the target design (provider interface, persist only after moderation, 503 does not consume the key, `reason`/`suggestedReply` always strings). I read the generated files against that picture and against `docs/implementation-plan.md` — not as a rubber stamp. After targeted fixes: `npm test`, `docker compose up --build`, and manual `POST` / `GET` / `/health`. Last, a second agent compared the brief, the plan, and the implementation, and I synced this README with the plan, because an agent sometimes catches a mismatch a tired human pass misses.

## Updated

Overslept. I was ready to submit — laptop open, “ship it” energy — and then it just got in my mind: oof, yeah, I think I forgot something. Decided to check. And yeah, I actually forgot.

`text: z.string().min(1)` happily accepts `"   "`. Spaces are characters. An empty-looking comment is not an empty string. Two extra minutes: `trim()` first, then `min(1).max(2000)`, plus a test so whitespace-only `text` is `400` and never reaches the provider. Still 84 / 90. Now I can actually submit.
