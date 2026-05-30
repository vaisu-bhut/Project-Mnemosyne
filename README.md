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

A single package. Code lives under `services/`; deployables that genuinely run
on their own (MCP servers, scheduled jobs) will get their own packages later.

```
Project-Mnemosyne/
  docker-compose.yml        # postgres (pgvector) + redis
  .env.example
  services/
    config/                 # env loading (Zod) + the VECTOR_DIM constant
    storage/                # local-filesystem artifact store (S3-shaped API)
    embeddings/             # text -> vector (dev / Gemini / Qwen)
    llm/                    # text generation (dev / Gemini) for extract + answers
    db/                     # schema.ts, Kysely types, client, repositories
    extract/                # entities / facts / open-loops extraction (dev / Gemini)
    ingest/                 # connector contract + filesystem connector + pipeline
    memory/                 # encode (embed-on-write) + retrieve (cited search / ask)
    consolidate/            # the "sleep" pass: dedup, alias-merge, decay, retention, forget
    queue/                  # BullMQ queue + job-type definitions
    api/                    # Fastify server + routes
    worker/                 # BullMQ workers: ingest, extract, consolidate, healthcheck
  examples/journal/         # sample notes for the filesystem connector
  test/                     # Vitest integration tests (real Postgres)
```

The database schema lives in `services/db/schema.ts` as one declarative file.
While there's no data to preserve, `pnpm db:reset` drops and recreates it — edit
the file, re-run. (Reintroduce a migration tool once there's real data.)

## Prerequisites

- Docker Desktop (running)
- Node 20+ and pnpm. If pnpm isn't installed, use Corepack (bundled with Node):
  ```powershell
  corepack pnpm <command>   # e.g. corepack pnpm install
  ```
  The commands below assume `pnpm` is on your PATH; prefix with `corepack` if not.

## Run it

```powershell
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

## The memory pipeline (ingest → extract → retrieve)

With both `pnpm api` and `pnpm worker` running:

```powershell
# 1. Register a filesystem source pointing at a folder of notes.
#    (examples/journal has sample notes.)
curl -X POST localhost:3000/sources -H "content-type: application/json" `
  -d '{"kind":"filesystem","displayName":"Journal","config":{"dir":"C:/path/to/examples/journal"}}'

# 2. Ingest it (enqueues a job; the worker embeds episodes + extracts memory).
curl -X POST localhost:3000/sources/<id>/ingest -H "content-type: application/json" -d '{}'

# 3. Ask a grounded question — answer cites the source episode.
curl -X POST localhost:3000/ask -H "content-type: application/json" `
  -d '{"question":"What is going on with Sara''s dad?"}'

# 4. Cited semantic search, and the open-loops dashboard.
curl -X POST localhost:3000/search -H "content-type: application/json" -d '{"query":"iceland book"}'
curl localhost:3000/open-loops
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
