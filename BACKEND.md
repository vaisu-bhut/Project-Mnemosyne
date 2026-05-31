# Project Mnemosyne — Backend Reference

A complete reference for the backend, written so the **frontend (website)** can be
built against it without reading the server source. The product is a
**multi-tenant, proactive personal-memory system**: it ingests a user's data
(email, calendar, contacts, notes), distils it into a cited knowledge graph,
keeps it healthy (dedup / decay / forgetting), and proactively surfaces things
(nudges, relationship alerts, pre-meeting briefings).

> Organizing idea: **encode → consolidate → retrieve**, with a proactive agent
> mesh on top and a privacy Guardian gating what can be surfaced.

---

## 1. Monorepo layout

The backend is a **self-contained package** under `services/` (its own
`package.json`, `node_modules`, `.env`, `tsconfig`, tests, and `docker-compose`).
The frontend will be a sibling `app/` package with its own dependency tree. Root
holds only the two packages plus cross-cutting docs.

```
Project-Mnemosyne/
  services/            # ← the BACKEND package (cd here for all backend work)
    package.json       # backend deps + scripts (run from services/)
    node_modules/
    tsconfig.json
    vitest.config.ts
    docker-compose.yml # postgres (pgvector) + redis  (compose project: "mnemosyne")
    .env / .env.example
    config/            # env loading (Zod) + VECTOR_DIM
    auth/              # password (scrypt), JWT (jose), token crypto, Google OAuth
    db/                # schema.ts, Kysely types, client, repositories/
    storage/           # local-filesystem artifact store (S3-shaped API)
    embeddings/        # text -> vector (dev / Gemini / Qwen)
    llm/               # text generation (dev / Gemini)
    extract/           # entity/fact/open-loop extraction (dev heuristic / Gemini)
    ingest/            # connector contract + filesystem/gmail/gcal/gcontacts + pipeline
    memory/            # encode (embed-on-write) + retrieve (cited search / ask)
    consolidate/       # the "sleep" pass (dedup, alias-merge, contradiction, decay, retention, forget)
    semantic/          # embedding+LLM entity resolution, contradiction NLI, intent routing
    agents/            # People, Nudger, Briefer, Conductor
    guardian/          # privacy compartments (context-gated visibility)
    queue/             # BullMQ queue + job-type definitions
    api/               # Fastify server + routes  (entry: api/index.ts)
    worker/            # BullMQ workers           (entry: worker/index.ts)
    examples/journal/  # sample notes for the filesystem connector
    test/              # Vitest integration tests (real Postgres)
  app/                 # ← FRONTEND package goes here (to be created)
  BACKEND.md  README.md  LICENSE   # cross-cutting docs at root
```

All backend commands run from `services/` (e.g. `cd services` first, or
`pnpm -C services <script>`). Keep backend changes inside `services/`.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict, ESM), Node 20+ |
| HTTP API | **Fastify 5** |
| DB | **Postgres 16 + pgvector** (single DB for vectors, relational, graph-as-edges, partitioned episodic) |
| SQL | **Kysely** (typed query builder; raw `sql` for vector/CTE) |
| Queue | **BullMQ + Redis** |
| Validation | **Zod** |
| Auth | **jose** (JWT), Node `scrypt` (passwords), AES-256-GCM (token/at-rest crypto) |
| Embeddings | `dev` (deterministic, offline) / **Gemini `gemini-embedding-001` @ 1024-dim** (the embedding provider) |
| LLM | `dev` (offline heuristics) / **Qwen `qwen-plus` via DashScope** (the generative provider) / Gemini |
| Object storage | local filesystem (S3-shaped interface; swap later) |
| Tests | **Vitest** — 82 tests / 19 files, fully offline on `dev` providers |

**Provider pattern (important):** every AI capability has a deterministic `dev`
implementation (no network, no keys) used by tests and local dev, and a real
`gemini`/`qwen` implementation enabled by env. The whole test suite runs offline.

---

## 3. Running it

```powershell
cd services                   # the backend package root
copy .env.example .env        # defaults match docker-compose
pnpm install
pnpm infra:up                 # Postgres + Redis (waits healthy)
pnpm db:reset                 # drop + recreate schema (no migrations during build phase)
pnpm test                     # 82 tests, offline

pnpm api                      # Fastify on http://localhost:3000 (auto-loads .env)
pnpm worker                   # BullMQ workers: ingest, extract, consolidate, nudge, healthcheck
```

(From the repo root you can also use `pnpm -C services <script>`.)

The schema lives in `services/db/schema.ts` as one declarative file; `pnpm
db:reset` drops & recreates it (there are no incremental migrations yet — no data
to preserve). `pnpm typecheck` runs `tsc --noEmit`.

---

## 4. Configuration (env vars)

Defaults work for local dev. Secrets are only in `.env` (gitignored).

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://mnemosyne:mnemosyne@localhost:5432/mnemosyne` | Postgres |
| `TEST_DATABASE_URL` | `…/mnemosyne_test` | test DB (auto-created) |
| `VECTOR_DIM` | `1024` | embedding width (matches `vector(N)`); change only when DB empty |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ |
| `LOCAL_STORAGE_DIR` | `./.data/artifacts` | raw artifact store |
| `EMBEDDING_PROVIDER` | `dev` | `dev` / `gemini` / `qwen` |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | |
| `EMBEDDING_API_KEY` | – | Google AI Studio key (embeddings) |
| `EMBEDDING_TASK_TYPE` | `RETRIEVAL_DOCUMENT` | gemini task hint |
| `LLM_PROVIDER` | `dev` | `dev` / `qwen` / `gemini` (extraction + answers + semantic). **Use `qwen`.** |
| `QWEN_API_KEY` | – | DashScope key (generative LLM) |
| `QWEN_MODEL` | `qwen-plus` | Qwen chat model |
| `QWEN_BASE_URL` | `…dashscope-intl…/compatible-mode/v1` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `gemini-2.5-flash` | only when `LLM_PROVIDER=gemini` |
| `SEMANTIC_INTELLIGENCE` | `false` | enable embedding+LLM alias/contradiction/routing |
| `ENTITY_SIM_THRESHOLD` | `0.84` | candidate cosine sim for entity merge |
| `CONTRADICTION_SIM_THRESHOLD` | `0.8` | candidate cosine sim for contradiction NLI |
| `SEMANTIC_MAX_PAIRS` | `25` | LLM adjudication cap/pass |
| `DECAY_MAX_AGE_DAYS` | `90` | un-reinforced facts go `stale` |
| `RETENTION_COMPRESS_AFTER_DAYS` | `90` | drop raw episode bodies |
| `RETENTION_PURGE_AFTER_DAYS` | `365` | purge episodes entirely |
| `CONSOLIDATE_INTERVAL_MS` | `86400000` | scheduled consolidation (0 = off) |
| `RELATIONSHIP_STALE_DAYS` | `30` | "going cold" alert threshold |
| `NUDGER_INTERVAL_MS` | `0` | scheduled nudger+briefings (0 = off) |
| `JWT_SECRET` | dev default | **set in prod** |
| `ACCESS_TOKEN_TTL` | `15m` | access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | refresh-token lifetime |
| `TOKEN_ENC_KEY` | dev default | AES key for OAuth + sensitive-tier at rest (**set in prod**) |
| `APP_BASE_URL` | `http://localhost:3000` | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | OAuth client (Gmail/Calendar/Contacts) |
| `GOOGLE_REDIRECT_URI` | `…/auth/google/callback` | |
| `GMAIL_QUERY` / `GMAIL_MAX_MESSAGES` | `newer_than:30d` / `25` | Gmail backfill |
| `CALENDAR_DAYS_PAST/FUTURE` / `CALENDAR_MAX_EVENTS` | `7` / `30` / `50` | Calendar window |
| `CONTACTS_MAX_RESULTS` | `200` | Contacts cap |
| `BRIEFING_LOOKAHEAD_HOURS` | `24` | upcoming-briefings window |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `3000` | |

---

## 5. Data model (Postgres)

Every memory row carries `user_id` (FK → `users`, cascade). A user owns their
entire graph; nothing crosses the boundary.

- **users** — `id, email (unique), password_hash (nullable for OAuth-only), display_name, created_at`
- **oauth_accounts** — linked Google identity + **encrypted** access/refresh tokens, `expires_at, scope`
- **sessions** — refresh tokens (only the **SHA-256 hash** stored), `expires_at`
- **sources** — a connector: `id, user_id, kind, display_name, scope (default 'personal'), sensitive (bool), config (jsonb), created_at`
- **entities** — graph nodes: `id, user_id, type (person/place/org/project/topic), canonical_name, aliases (text[]), attrs (jsonb), closeness (real), embedding (vector), …`
- **episodes** — timestamped events, **monthly-partitioned by `occurred_at`**: `id, user_id, occurred_at, source_id, external_id, kind, title, body, valence, artifact_uri, embedding, meta (jsonb)`. PK `(id, occurred_at)`; dedup unique `(source_id, external_id, occurred_at)`.
- **facts** — semantic memory w/ **mandatory provenance**: `id, user_id, subject_id, statement, predicate, object_id, confidence, source_episode (uuid), source_id, learned_at, last_confirmed, reinforced, contradicts (self-FK, advisory), status (active|stale|retracted), embedding`
- **edges** — graph: `id, user_id, src_id, dst_id, rel, props (jsonb)`. People↔episode links use `rel='mentioned_in'`.
- **open_loops** — promises: `id, user_id, description, counterparty (entity), direction (i_owe|they_owe), due_at, source_episode, status (open|done|rotted)`
- **retention** — tiered forgetting: `episode_id (PK), user_id, tier (raw_forever|standard|ephemeral), compress_after, purge_after, vaulted`
- **blackboard** — shared **working memory** for agents: `id, user_id, kind, agent, title, body, entity_id, salience (real), payload (jsonb), status (active|dismissed|done), created_at, expires_at`

---

## 6. HTTP API reference

Base URL `http://localhost:3000`. JSON in/out. **All routes require
`Authorization: Bearer <accessToken>` except `GET /health` and `/auth/*`** (the
server replies `401 {error:"authentication required"}` otherwise).

> **Casing note:** endpoints that return raw DB rows use **snake_case**
> (`user_id`, `display_name`, `occurred_at`…). Computed endpoints (auth user,
> `/search`, `/ask`, agents) use **camelCase**. Each entry below states which.

### Auth (`/auth/*`, public)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password (≥8), displayName?}` | `201 {user:{id,email,displayName}, accessToken, refreshToken}`; `409` if email taken |
| POST | `/auth/login` | `{email, password}` | `200 {user, accessToken, refreshToken}`; `401` |
| POST | `/auth/refresh` | `{refreshToken}` | `{user, accessToken, refreshToken}` (rotates: old token invalidated); `401` |
| POST | `/auth/logout` | `{refreshToken}` | `204` |
| GET | `/auth/me` | – (Bearer) | `{user:{id,email,displayName}}`; `401` |
| GET | `/auth/google/url` | – | `{url}` — open in browser to start OAuth |
| GET | `/auth/google/callback` | `?code&state` | `{user, accessToken, refreshToken}` (also stores encrypted Gmail/Calendar tokens) |

**Token model (mobile/web):** access token is a short-lived JWT (`15m`) sent as
`Authorization: Bearer`. Refresh token is opaque (`30d`), only its hash stored;
**rotated** on every `/auth/refresh`. On a `401` from a protected route, call
`/auth/refresh`, then retry.

### Sources & ingestion

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/sources` | `{kind, displayName, scope?, sensitive?, config?}` | `201` Source row (snake_case) |
| GET | `/sources` | – | `Source[]` |
| PATCH | `/sources/:id` | `{sensitive?, scope?}` | Source row; `404` |
| POST | `/sources/:id/ingest` | `{}` | `202 {jobId, sourceId}` — async; the **worker** does the work |

`kind` ∈ `filesystem` (config `{dir}`), `gmail`, `gcal`, `gcontacts`. Google
kinds require the user to have completed `/auth/google/*`. Ingestion is
asynchronous: poll `/search` or `/sources` after a few seconds (no job-status
endpoint yet — see §11).

### Memory (retrieval)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/search` | `{query, k?≤50, mode?, includeSensitive?}` | `{facts[], episodes[], entities[]}` (camelCase, each w/ `distance`; facts/episodes carry `citation:{episodeId, sourceId}`) |
| POST | `/ask` | `{question, k?, mode?, includeSensitive?}` | `{answer, citations:[{episodeId,sourceId}], used:{facts,episodes}}` — answer is grounded + cites `[episode:<id>]` |
| GET | `/open-loops` | `?status=open|done|rotted` | `OpenLoop[]` (snake_case) |
| POST | `/episodes/:id/forget` | `{}` | `{episode, facts, edges, openLoops, artifactDeleted}` — irreversible purge across all stores |
| POST | `/retention` | `{episodeId, tier?, compressAfter?, purgeAfter?, vaulted?}` | `204` |
| GET | `/contradictions` | – | `[{id, statement, episode, contradictsId, contradictsStatement}]` |
| POST | `/consolidate` | `{}` | `ConsolidationReport {entitiesMerged, factsRetracted, contradictionsLinked, factsStaled, episodesCompressed, episodesPurged}` |
| POST | `/entities/:id/summarize` | `{}` | `{id, summary}` |

`mode` ∈ `default` | `work` | `guest` (see §8). A search hit:
`{id, statement, confidence, distance, citation}`; episode hit
`{id, title, snippet, occurredAt, distance, citation}`; entity hit
`{id, canonicalName, type, distance}`.

### Agent mesh

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/conduct` | `{query, mode?}` | `{intent, via, result}` — routes to recall/briefing/people/nudges |
| GET | `/mind` | `?k=10` | `BlackboardEntry[]` (snake_case) — most salient working memory |
| POST | `/agents/nudger/run` | `{}` | `{openLoopNudges, relationshipAlerts, total}` |
| GET | `/people/health` | – | `RelationshipHealth[]` (camelCase) |
| GET | `/people/:id/brief` | – | `Briefing` |
| GET | `/briefings/upcoming` | `?hours=24` | `UpcomingBriefing[]` |
| POST | `/blackboard/:id/dismiss` | `{}` | `204` |

`RelationshipHealth = {entityId, name, closeness, interactions, lastContactAt,
daysSinceContact, openThreads:[{id,description,direction}]}`.

`Briefing = {entityId, name, aliases, summary, closeness, lastContactAt,
daysSinceContact, interactions, recentInteractions:[{episodeId,title,occurredAt,snippet}],
openThreads, recentFacts:[{statement,episodeId}], suggestedQuestions:string[]}`.

`UpcomingBriefing = {eventId, eventTitle, eventStart, briefing}`.

`/conduct` result shape depends on `intent`: `recall` → an `ask` Answer;
`briefing` → a `Briefing`; `people` → `RelationshipAlert[]`; `nudges` →
`BlackboardEntry[]`.

### Health (public)

`GET /health` → `{status:"ok"|"degraded", checks:{database, redis, storage}}`,
`200` when all up else `503`.

### Error conventions

`400 {error:"invalid request", issues:[...]}` (Zod) · `401 {error}` · `404
{error}` · `409 {error}` (duplicate email) · `503` (health). Other failures →
status from the error or `500 {error}`.

---

## 7. Ingestion pipeline (how data becomes memory)

1. **Create a source** (`POST /sources`) → **trigger ingest** (`POST /sources/:id/ingest`) enqueues a BullMQ `ingest` job.
2. **Worker `ingest`**: builds the connector, `pull({cursor})` → items; stores raw payload to the artifact store; creates an **embedded episode** per item (idempotent on `(source_id, external_id, occurred_at)`); links **participants** (email/calendar attendees → person entities with email/phone as identity aliases); persists the incremental **cursor** on the source; enqueues an `extract` job per episode.
3. **Worker `extract`**: runs the extractor (`dev` heuristic or Gemini) → entities, facts (with mandatory provenance), open-loops, `mentioned_in` edges — all embedded.
4. **Retrieval** then answers with citations back to the source episode.

**Connectors** (all share one `pull({cursor}) → {items, cursor}` contract):
- `filesystem` — a folder of `.md`/`.txt` notes (config `{dir}`).
- `gmail` — incremental via History API (backfill fallback), HTML→text + quote/signature stripping, attachments, sender/recipients → people.
- `gcal` — incremental via Calendar `syncToken`; attendees → people; powers time-triggered briefings.
- `gcontacts` — People API; each contact → a stable-dated `contact` episode seeding a person entity (name/email/phone/org).

Google connectors use the user's stored OAuth tokens (auto-refreshed); a
revoked token flags the source `config.needsReauth`.

---

## 8. Guardian (privacy compartments)

Sources carry `sensitive` (bool) and `scope` (e.g. `personal`/`work`/`health`/`shareable`).
The Guardian decides which sources' content is surfaceable per request `mode`,
enforced at **retrieval** (facts + episodes, which carry `source_id`, and
entities by provenance):

- **default** — everything (unless `includeSensitive:false`).
- **guest** — hides all `sensitive` sources.
- **work** — only `scope='work'` (firewalls personal/health).
- **external** — the **consent layer**: deny-all except `scope='shareable'` (third-party content never leaves by default).

**Sensitive-tier encryption at rest:** for `sensitive` sources, episode bodies +
raw artifacts are AES-256-GCM encrypted (embeddings computed from plaintext at
ingest; decrypted on authorized read). Facts stay plaintext-but-gated.
*Not* yet local-first device keys.

Trust stance: **contradiction links and the Guardian only gate/flag — they never
silently retract or delete.**

---

## 9. Consolidation (the "sleep" pass)

`POST /consolidate` (and a scheduled worker job) runs, per user, in order:
1. **resolve entities** — lexical alias-merge (`Sara`⊂`Sara Lin`, shared email/phone) + (if `SEMANTIC_INTELLIGENCE`) embedding-candidate + LLM adjudication (`Mike`=`Michael Chen`).
2. **dedup facts** — identical statements collapse; survivor's `reinforced` grows (trust via repetition).
3. **detect contradictions** — same-subject conflicting facts linked via `facts.contradicts` (advisory); lexical or semantic NLI.
4. **decay** — old, un-reinforced facts → `stale`.
5. **enforce retention** — compress aged episode bodies; purge very old ones; spare `raw_forever`/`vaulted`.

---

## 10. Background jobs (worker)

BullMQ queues: `ingest`, `extract`, `consolidate`, `nudge`, `healthcheck`.
Schedulers (when interval > 0): `consolidate` every `CONSOLIDATE_INTERVAL_MS`;
`nudge` every `NUDGER_INTERVAL_MS` (runs the Nudger + writes upcoming briefings
to the blackboard, per user). The API process is the **producer**; the worker
process is the **consumer**. Both must run for ingestion/proactive features.

---

## 11. Notes & gaps the frontend should know

- **CORS is not configured yet.** A browser app on a different origin will be
  blocked. Add `@fastify/cors` in `services/api/server.ts` (allow the web
  origin, `Authorization` header) before wiring the website. **Action item.**
- **No job-status endpoint.** `POST /sources/:id/ingest` returns `202 {jobId}`
  but there's no `GET /jobs/:id`; the UI should poll `/search`/`/sources` or show
  optimistic state. (Candidate to add.)
- **List endpoints are unpaginated** (`/sources`, `/open-loops`, `/people/health`,
  `/mind`, `/contradictions`). Fine at personal scale; add pagination later.
- **Live Google ingestion** needs a real `GOOGLE_CLIENT_ID/SECRET` + a browser
  consent; without them, `gmail`/`gcal`/`gcontacts` sources can't fetch.
- **Semantic intelligence** and proactive **schedulers** are off by default
  (`SEMANTIC_INTELLIGENCE=false`, `NUDGER_INTERVAL_MS=0`); the manual endpoints
  (`/consolidate`, `/agents/nudger/run`) always work.
- **Mixed field casing** (snake_case DB rows vs camelCase computed) — see §6;
  a small client-side normalizer is worth adding.
- **Verify-on-click**: facts/episodes always include a `citation` to the source
  episode — the UI should make every surfaced claim click-through to its source.

---

## 12. Suggested first frontend slice

Auth (register/login + token storage + refresh-on-401) → connect a source
(filesystem dir or Google) → trigger ingest → a **search/ask** surface with
click-through citations → the **/mind** ambient panel and **/people/health** +
**briefings**. That exercises the whole backend end-to-end.
