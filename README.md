# Project Mnemosyne — Foundation

The backend foundation for a personal memory system: infra skeleton + database
layer. This stage gives you something you can stand up locally, migrate, and run
integration tests against. Ingestion, agents, MCP, and the frontend come later.

> Build the memory, not the notebook — with the discipline to forget, the
> humility to cite, and the courage to interrupt.

## Stack

- **Node.js + TypeScript** (strict, ESM)
- **Postgres 16 + pgvector** — one database for everything: vectors, relational,
  the graph (plain edge tables), and episodes (monthly-partitioned). pgvector
  only, so this maps cleanly onto AWS Aurora later (no Apache AGE / TimescaleDB).
- **Kysely** for typed SQL + **node-pg-migrate** for migrations
- **Fastify** API, **BullMQ + Redis** worker
- **Local filesystem** for raw artifacts (swappable for S3 later)
- **Zod** for config validation, **Vitest** for tests

## Layout

The repo holds two self-contained packages: **`services/`** (this backend, with
its own `package.json`/`node_modules`/`.env`) and **`app/`** (the frontend, to
come). All backend work happens inside `services/`. See **[BACKEND.md](BACKEND.md)**
for the full API/data-model reference.

```
Project-Mnemosyne/
  services/                 # ← the backend package (cd here for everything below)
    package.json  node_modules  tsconfig.json  vitest.config.ts
    docker-compose.yml      # postgres (pgvector) + redis  (compose project: "mnemosyne")
    .env / .env.example
    config/  auth/  db/  storage/  embeddings/  llm/  extract/  ingest/
    memory/  consolidate/  semantic/  agents/  guardian/  queue/  api/  worker/
    examples/journal/       # sample notes for the filesystem connector
    test/                   # Vitest integration tests (real Postgres)
  app/                      # ← the frontend package (to be created)
  BACKEND.md  README.md  LICENSE
```

The database schema lives in `services/db/schema.ts` as one declarative file.
While there's no data to preserve, `pnpm db:reset` drops and recreates it — edit
the file, re-run. (Reintroduce a migration tool once there's real data.)

**Multi-tenant.** Every memory row carries `user_id`; a user owns their entire
graph and nothing crosses the boundary. All repositories, agents, search, and
consolidation are user-scoped, and every API route (except `/health` and
`/auth/*`) requires a valid access token.

## Prerequisites

- Docker Desktop (running)
- Node 20+ and pnpm. If pnpm isn't installed, use Corepack (bundled with Node):
  ```powershell
  corepack pnpm <command>   # e.g. corepack pnpm install
  ```
  The commands below assume `pnpm` is on your PATH; prefix with `corepack` if not.

## Run it

```powershell
cd services                   # the backend package root

# 1. Configure (defaults match docker-compose.yml)
copy .env.example .env

# 2. Install dependencies
pnpm install

# 3. Start Postgres + Redis (waits until healthy)
pnpm infra:up

# 4. Create the schema (drop + recreate; safe while there's no data)
pnpm db:reset

# 5. Run the integration tests (provisions a separate test database)
pnpm test
```

Then run the processes (each auto-loads `.env`):

```powershell
pnpm api      # Fastify on http://localhost:3000
pnpm worker   # BullMQ workers: ingest, extract, healthcheck
```

`GET /health` returns the reachability of Postgres, Redis, and the artifact
store, with HTTP 200 when all three are up and 503 otherwise.

## Authentication

Mobile-style auth: a short-lived **JWT access token** (sent as
`Authorization: Bearer <token>`) plus a **rotating refresh token** (opaque,
only its hash is stored; rotated on every `/auth/refresh`). Passwords are
hashed with scrypt.

```powershell
# Register (or POST /auth/login) -> { user, accessToken, refreshToken }
curl -X POST localhost:3000/auth/register -H "content-type: application/json" `
  -d '{"email":"me@example.com","password":"password123"}'

# Use the access token on every protected route.
curl localhost:3000/auth/me -H "authorization: Bearer <accessToken>"

# Rotate when the access token expires.
curl -X POST localhost:3000/auth/refresh -H "content-type: application/json" `
  -d '{"refreshToken":"<refreshToken>"}'
```

**Google sign-in + Gmail** (requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`):
`GET /auth/google/url` returns a consent URL; after the user approves,
`GET /auth/google/callback` upserts the account (encrypting the Gmail tokens at
rest) and returns the same `{ accessToken, refreshToken }` pair. The user can
then register a `gmail` source and ingest real mail:

```powershell
curl -X POST localhost:3000/sources -H "authorization: Bearer <t>" `
  -H "content-type: application/json" -d '{"kind":"gmail","displayName":"Gmail"}'
curl -X POST localhost:3000/sources/<id>/ingest -H "authorization: Bearer <t>" -d '{}'
```

The Gmail connector is **incremental and people-aware**: the first run backfills
(`GMAIL_QUERY`, up to `GMAIL_MAX_MESSAGES`) and records a History API cursor on
the source; later runs sync only what changed (falling back to backfill if the
cursor expires). Senders/recipients become **person entities** (email as a
strong identity alias) linked to each email, bodies are cleaned (HTML→text,
quoted replies/signatures stripped), and attachments are stored to the artifact
store. A revoked/expired token flags the source `needsReauth`.

A **Calendar** source (`kind: "gcal"`) and a **Contacts** source
(`kind: "gcontacts"`, People API — seeds the People graph identity layer with
email/phone aliases) reuse the same seam. Calendar events sync incrementally
(Calendar `syncToken`, 410 → window resync), and attendees become linked person
entities. That powers **time-triggered pre-meeting briefings** — the worker's proactive pass writes a briefing to the
blackboard for each attendee of an upcoming event, and `GET /briefings/upcoming`
returns them on demand:

```powershell
curl -X POST localhost:3000/sources -H "authorization: Bearer <t>" `
  -H "content-type: application/json" -d '{"kind":"gcal","displayName":"Calendar"}'
curl -X POST localhost:3000/sources/<id>/ingest -H "authorization: Bearer <t>" -d '{}'
curl "localhost:3000/briefings/upcoming?hours=24" -H "authorization: Bearer <t>"
```

## The memory pipeline (ingest → extract → retrieve)

With both `pnpm api` and `pnpm worker` running (all routes need `-H "authorization: Bearer <token>"`):

```powershell
# 1. Register a filesystem source pointing at a folder of notes.
#    (examples/journal has sample notes.)
curl -X POST localhost:3000/sources -H "content-type: application/json" `
  -H "authorization: Bearer <t>" `
  -d '{"kind":"filesystem","displayName":"Journal","config":{"dir":"C:/path/to/examples/journal"}}'

# 2. Ingest it (enqueues a job; the worker embeds episodes + extracts memory).
curl -X POST localhost:3000/sources/<id>/ingest -H "authorization: Bearer <t>" -d '{}'

# 3. Ask a grounded question — answer cites the source episode.
curl -X POST localhost:3000/ask -H "content-type: application/json" -H "authorization: Bearer <t>" `
  -d '{"question":"What is going on with Sara''s dad?"}'

# 4. Cited semantic search, and the open-loops dashboard.
curl -X POST localhost:3000/search -H "content-type: application/json" -H "authorization: Bearer <t>" -d '{"query":"iceland book"}'
curl localhost:3000/open-loops -H "authorization: Bearer <t>"
```

**Providers.** Extraction and answering use `LLM_PROVIDER` (`dev` = offline
heuristics, no key; `gemini` = real). Embeddings use `EMBEDDING_PROVIDER`
(`dev` / `gemini` / `qwen`). Tests run entirely on the `dev` providers, so no
network or keys are needed for `pnpm test`. Set both to `gemini` (with
`EMBEDDING_API_KEY`) in `.env` for real quality.

## Consolidation (the "sleep" layer)

Background maintenance that keeps memory healthy instead of hoarding. The worker
runs it on a schedule (`CONSOLIDATE_INTERVAL_MS`); you can also trigger it and
its parts via the API:

```powershell
curl -X POST localhost:3000/consolidate -H "content-type: application/json" -d '{}'
#   -> { entitiesMerged, factsRetracted, contradictionsLinked, factsStaled,
#        episodesCompressed, episodesPurged }

curl localhost:3000/contradictions                  # facts flagged as conflicting
curl -X POST localhost:3000/entities/<id>/summarize -d '{}' -H "content-type: application/json"
curl -X POST localhost:3000/retention -H "content-type: application/json" `
  -d '{"episodeId":"<id>","tier":"raw_forever"}'     # or vaulted / ephemeral
curl -X POST localhost:3000/episodes/<id>/forget -d '{}' -H "content-type: application/json"
```

What it does, deterministically (no LLM needed), in order:
1. **Alias resolution** — merge less-specific entities into specific ones
   (`Sara` → `Sara Lin`), repointing facts/edges/loops.
2. **Fact dedup + reinforcement** — collapse identical facts; the survivor's
   `reinforced` count grows (re-encountered facts gain trust).
3. **Contradiction flagging** — link genuinely-divergent facts on the same
   subject+predicate via `facts.contradicts` (soft flag, never auto-retracts).
4. **Decay** — un-reinforced facts older than `DECAY_MAX_AGE_DAYS` go `stale`.
5. **Retention** — compress aged episode bodies, purge very old ones; `forget`
   purges an episode across Postgres *and* the artifact store. `raw_forever` and
   `vaulted` episodes are spared.

> **Known limitation.** Alias resolution and contradiction detection are
> lexical heuristics — alias-merge can over-merge ambiguous first names, and
> contradiction flagging can misjudge edge cases. The intended upgrade is
> embedding/LLM-based semantic comparison. Contradiction links are advisory only.

## The agent mesh (proactive layer)

Agents read memory and write to a shared **blackboard** (working memory); they
never call each other directly. The **Conductor** routes a query to the right
agent or falls back to recall.

```powershell
# Conductor — one entry point that routes by intent (briefing / people / nudges / recall)
curl -X POST localhost:3000/conduct -H "content-type: application/json" `
  -d '{"query":"prep me for coffee with Sara Lin"}'

curl -X POST localhost:3000/agents/nudger/run -d '{}' -H "content-type: application/json"
curl localhost:3000/mind                       # what's on my mind (salient working memory)
curl localhost:3000/people/health              # relationship health across people
curl localhost:3000/people/<id>/brief          # pre-meeting briefing + suggested questions
curl -X POST localhost:3000/blackboard/<id>/dismiss -d '{}' -H "content-type: application/json"
```

- **People** — relationship health (last contact, frequency, open threads,
  closeness) and "going cold" alerts.
- **Nudger** — proactively writes salient open-loops and relationship alerts to
  the blackboard (also runs on `NUDGER_INTERVAL_MS`).
- **Briefer** — pre-meeting briefings: identity, recent interactions, open
  threads, recent facts, and suggested questions.
- **Conductor** — routes by intent. Lexical keyword routing by default; with
  `SEMANTIC_INTELLIGENCE=true` an LLM classifies intent (and extracts the target
  person) even without trigger words, falling back to keywords on failure.
  Agents coordinate only via the Conductor and the blackboard, so the flow stays
  observable and stoppable.

### Semantic intelligence (optional, `SEMANTIC_INTELLIGENCE=true`)

By default the three "judgement" subsystems are **lexical** — fast, free, and
deterministic. Flip `SEMANTIC_INTELLIGENCE=true` (with `LLM_PROVIDER=gemini`) to
upgrade them to **embedding candidate-generation + LLM adjudication**:

- **Alias resolution** — pgvector finds near-duplicate entities by embedding; an
  LLM confirms each pair. Catches `Mike` = `Michael Chen` (no shared tokens) that
  the lexical pass can't. The lexical pass still runs first (high-precision,
  free); semantic is additive.
- **Contradiction detection** — pgvector finds related fact pairs per subject; an
  LLM classifies each as contradicts / duplicate / unrelated (NLI across
  different phrasing and predicates). Links stay **advisory** (never auto-retract).
- **Conductor routing** — LLM intent classifier (see above).

All three fall back to the lexical path on any LLM error, so consolidation never
breaks. Candidate generation is capped (`SEMANTIC_MAX_PAIRS`) for cost control.

## Privacy compartments (the Guardian)

Sources carry a `sensitive` flag and a `scope` (e.g. `personal`, `work`,
`health`). The **Guardian** decides which sources' content may be surfaced in a
given context, enforced at retrieval (facts + episodes, which carry `source_id`):

- **guest** — hides every sensitive source (a visitor sees only safe context).
- **work** — firewalls everything not scoped `work` (no personal/health leakage).
- **external** — the consent layer: denies everything except sources the user
  explicitly scoped `shareable` (third-party content never leaves by default).
- **default** — shows all, unless `includeSensitive: false`.

Gating applies to facts, episodes, **and entities** (a person known *only* from a
hidden source disappears in that context). The **sensitive tier is encrypted at
rest** (AES-256-GCM): bodies and raw payloads of `sensitive` sources are
ciphertext in Postgres/object-storage and decrypted only on authorized read.
(Field-level encryption of facts and device-held keys remain future work.)

```powershell
curl localhost:3000/sources -H "authorization: Bearer <t>"          # list + classify
curl -X PATCH localhost:3000/sources/<id> -H "authorization: Bearer <t>" `
  -H "content-type: application/json" -d '{"sensitive":true,"scope":"health"}'

# search/ask/conduct take an optional mode
curl -X POST localhost:3000/ask -H "authorization: Bearer <t>" `
  -H "content-type: application/json" -d '{"question":"...","mode":"guest"}'
```

Contradiction links are advisory (never auto-retract); likewise the Guardian
currently gates *reads* — action-level vetoes arrive with the Drafter, and
entity-level masking + the consent layer (third-party data) are the next steps.

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm infra:up` / `pnpm infra:down` | Start / stop the containers |
| `pnpm db:reset` | Drop and recreate the schema |
| `pnpm test` / `pnpm test:watch` | Run the Vitest suite |
| `pnpm typecheck` | `tsc --noEmit` over the whole tree |
| `pnpm api` / `pnpm worker` | Run the API / worker in watch mode |

## Design notes

- **Provenance is mandatory.** `facts` cannot be inserted without a
  `source_episode` and `source_id` — enforced both in `insertFact` and by NOT
  NULL columns. No floating assertions.
- **Episodes are monthly-partitioned** by `occurred_at`. Native partitioning
  requires the partition key in every unique constraint, so the dedup key is
  `(source_id, external_id, occurred_at)` and the PK is `(id, occurred_at)`.
  `create_episodes_partition(date)` rolls partitions forward; a `DEFAULT`
  partition catches anything out of range.
- **The graph is plain edge tables.** `getNeighbors` does multi-hop traversal
  (depth 1–3) with a recursive CTE and a cycle guard.
- **Embedding dimension** is a single value: `VECTOR_DIM` in `.env` (default
  1024, Qwen text-embedding-v3), read by both the app and the schema. Change it
  only while the database is empty.
