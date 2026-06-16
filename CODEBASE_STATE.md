# Codebase State

## Overview
**Project Mnemosyne** is a personal AI memory system: it ingests a user's
content (notes, Gmail, Calendar, Contacts), turns it into a queryable memory
graph (episodes + facts + entities + relationships), and surfaces it via grounded
Q&A, semantic search, relationship tracking, and proactive nudges/briefings. Its
guiding principle: "build the memory, not the notebook — discipline to forget,
humility to cite, courage to interrupt."

Two self-contained packages:
- **`services/`** — the backend (Node.js + TypeScript, strict ESM).
- **`app/`** — the frontend (Next.js 16 + React 19 + Tailwind 4; 3d-force-graph
  + three.js for the People graph viz).

**Backend stack:** Postgres 16 + pgvector (vectors, relational, graph edge
tables, and monthly-partitioned episodes — pgvector only, to map cleanly onto
AWS Aurora later), Kysely (typed SQL), Fastify (API), BullMQ + Redis (worker),
local filesystem for raw artifacts (S3-swappable), Zod (config), Vitest (tests).

**Multi-tenant:** every memory row carries `user_id`; all repos/agents/search/
consolidation are user-scoped. Every API route except `/health` and `/auth/*`
requires a JWT access token.

## Build / Run / Test
Backend (run from `services/`):
- `pnpm install`
- `pnpm infra:up` — start Postgres(pgvector) + Redis via docker-compose (`--wait` for healthy)
- `pnpm db:reset` — drop + recreate schema (`tsx db/reset.ts`; safe while no data)
- `pnpm test` / `pnpm test:watch` — Vitest integration suite (real Postgres, provisions a separate test DB; uses `dev` providers so no keys/network)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm api` — Fastify on http://localhost:3000 (`tsx watch api/index.ts`)
- `pnpm worker` — BullMQ workers (`tsx watch worker/index.ts`)
- `pnpm infra:down` / `pnpm infra:logs`

Frontend (run from `app/`):
- `pnpm dev` — Next dev on :3001
- `pnpm build` / `pnpm start` (:3001) / `pnpm lint` / `pnpm typecheck` / `pnpm test`

Prereqs: Docker Desktop, Node 20+, pnpm (or `corepack pnpm`).

## Structure
```
Project-Mnemosyne/
  README.md          # full product/usage walkthrough
  BACKEND.md         # API/data-model reference
  LICENSE
  services/          # backend package (own package.json/.env)
    docker-compose.yml         # postgres(pgvector) + redis, compose project "mnemosyne"
    config/index.ts            # Zod-validated env config
    auth/                      # crypto.ts, jwt.ts, password.ts (scrypt), index.ts (routes),
                               #   google.ts + microsoft.ts (per-provider OAuth + token resolvers),
                               #   scopes.ts (scope→services), handoff.ts (web-handoff URL)
    db/
      schema.ts                # single declarative SQL schema (all tables)
      client.ts                # Kysely/pg client
      types.ts                 # DB types
      vector.ts                # pgvector helpers
      reset.ts                 # drop+recreate runner
      repositories/            # blackboard, edges, entities, episodes, facts,
                               #   oauthAccounts, openLoops, search, sessions, sources, users
    storage/index.ts           # artifact store (local fs; S3-swappable)
    embeddings/index.ts        # embedding providers (dev/gemini/qwen)
    llm/index.ts               # LLM providers (dev heuristics / gemini)
    extract/index.ts           # memory extraction from episodes (entities, facts,
                               #   open loops, + person↔person relationships); uses the
                               #   LLM whenever a real generator is set (qwen/gemini), else heuristic
    asr/index.ts               # speech-to-text for voice notes + voice-driven Ask
                               #   (Qwen via DashScope OpenAI-compatible /audio/transcriptions,
                               #    QWEN_API_KEY + QWEN_ASR_MODEL; embeddings stay on Gemini)
    capture/index.ts           # voice-note capture: store audio, commit episode + extract
    ingest/                    # connector.ts, pipeline.ts, filesystem.ts, emailText.ts,
                               #   gmail.ts, gcal.ts, gcontacts.ts (Google),
                               #   outlookMail.ts, outlookCalendar.ts, outlookContacts.ts (MS Graph)
    memory/                    # encode.ts (write); retrieve.ts (read;
                               #   ask()/searchMemory take optional scope+history for chat;
                               #   ask() enforces a hard evidence guard → NO_EVIDENCE_ANSWER)
    consolidate/               # index.ts + entities(alias), dedup, contradictions,
                               #   decay, retention, summarize, util ("sleep" layer)
    semantic/                  # entityMatch, nli, intent, index (optional LLM upgrades)
    agents/                    # conductor, briefer, nudger, people, index (agent mesh)
    queue/index.ts             # BullMQ queue/job definitions
    api/                       # index.ts (entry), server.ts (Fastify routes)
    worker/index.ts            # BullMQ workers + schedulers
    examples/journal/          # sample notes for filesystem connector
    util/http.ts               # fetchWithRetry (429/503 backoff) + sleep
    test/                      # Vitest integration tests (29 files)
  app/                 # frontend package (Next.js App Router)
    public/          # PWA assets: manifest.webmanifest, icon.svg, sw.js
                     #   (service worker: install/activate + notificationclick + push-ready stub)
    src/app/(auth)/{login,register}        # auth pages
    src/app/auth/{google,microsoft}/callback  # OAuth web hand-off
    src/app/(app)/{,memory,sources,people,people/[id],open-loops,briefings,settings}
                     #   nav: Dashboard, Memory, Connections(/sources), People, Briefings, Open Loops, Settings
                     #   /sources page = Accounts | Sources sub-tabs
                     #   /memory = Episodes|Facts sub-tabs; no separate Search/Episodes/Facts routes
                     #   layout: fixed-left Sidebar, only <main> scrolls (h-svh + md:pl-60)
    src/components/  ui/ + feature dirs (auth, agents, people, sources, episodes, memory, openloops, chat, capture, pwa)
                     #   capture/VoiceCaptureDialog — record → transcribe → review → commit
                     #     (MediaRecorder; "Capture" button in Topbar; useCapture hooks)
                     #   capture/MicButton — push-to-talk record→transcribe→onTranscript;
                     #     used in chat/ChatPanel for voice-driven Ask (lib/audio shared helpers)
                     #   /memory tabs: Episodes | Facts | Conflicts
                     #   memory/EpisodesTab + FactsTab (inline edit/stale/delete per fact +
                     #     decay/freshness indicator) + ContradictionsTab (resolve a pair → mark
                     #     one side stale, useResolveContradiction)
                     #   people/MergePeopleDialog — merge two wrongly-split people (useMergePeople)
                     #   people/PersonCard + BriefingView show a TrendBadge (cadence)
                     #   /people = List | Graph; Graph = PeopleGraphPanel → PeopleGraph3D
                     #     (3D force graph via 3d-force-graph/three.js, client-only dynamic import;
                     #      nodes sized by closeness, colored by circle, links by co-occurrence)
                     #   sources/PermissionsEditor — static "Read-only by design" principle panel
                     #     (write/delete toggles removed; sources always sent DEFAULT_PERMISSIONS)
                     #   chat/ChatPanel + AskLauncher — right slide-over "ask your brain"
                     #     (launcher is app-wide: rendered once in ChatPanelProvider; pages call
                     #      useRegisterChatContext() to scope it; scoped retrieval via /ask)
                     #   episodes/EpisodeDrawer — citation chip → source episode + extraction
                     #     trace (facts derived + reinforcement history) via useEpisodeTrace
                     #   pwa/ServiceWorkerRegistrar (registers /sw.js, in Providers) +
                     #     pwa/ProactiveNotifier (in (app) shell: polls /mind + /briefings/
                     #     upcoming every 60s, fires browser notifications for new salient
                     #     nudges + briefings ~15 min pre-meeting; dedup persisted, lib/notify)
    src/hooks/       react-query hooks (useSources, usePeople, useBrowse[episodes/facts/update/delete], ...)
    src/lib/         api/(client,endpoints,types,casing), auth/, chat/ChatPanelProvider, citations, notify, format, utils
```

## Key Files
- `services/api/server.ts` — all Fastify routes; auth middleware (Bearer JWT) on
  everything except `/health` and `/auth/*`. Routes include: `/health`,
  `/auth/*` (register/login/refresh/me/google/microsoft), `/sources` (CRUD + classify +
  ingest; create validates optional `oauthAccountId`; create/classify carry per-app
  `permissions` {read/write/delete/mode} — only `read` enforced, rest are definitions
  for the future write layer; `/sources/:id/ingest-status` = latest ingest_run),
  `/accounts` (GET connected accounts with computed `services[]`/`needsReauth`,
  never tokens; DELETE :id disconnect), `/episodes` + `/facts` (paginated
  browse lists), `PATCH`/`DELETE /facts/:id` (edit/retract or delete a
  derived fact — episodes are never touched; GET `/facts` also returns a computed
  `decay` 0..1 + `protectedFromDecay` + `decaysInDays` so forgetting is visible),
  `/entities/merge` (POST {survivorId, dupeId} — user-owned-only entity merge via
  consolidate `mergeEntities`), `/search`, `/ask` (accepts `scope`
  {entityId/sourceId/kind} + `history` for the page-context chat; hard evidence
  guard — refuses with a fixed answer when nothing retrieved is within the
  relevance threshold, no generator call), `GET /episodes/:id/trace` (extraction
  trace: source episode + facts derived from it with reinforcement/decay history),
  `/consolidate`,
  `/retention`, `/contradictions`, `/entities/:id/summarize`,
  `/episodes/:id/forget`, `/open-loops`, `/conduct`, `/agents/nudger/run`,
  `/capture/transcribe` (store audio + transcribe + extraction preview) +
  `/capture/commit` (create voice_note episode + extract into the graph) +
  `/transcribe` (transcribe-only for voice-driven Ask; no storage/extraction),
  `/mind`, `/people/health` (incl. cadence trend), `/people/:id/brief`,
  `/graph` (people network: nodes {closeness, circle, interactions} + weighted
  co_occurs links, capped to most-connected N),
  `/briefings/upcoming` (per-meeting: each entry has attendees[]),
  `/blackboard/:id/dismiss`, `/blackboard/:id/snooze` (hide now + suppress
  regeneration until later via the entry's payload.key → nudge_snoozes).
- `services/worker/index.ts` — 5 BullMQ workers: ingest → (enqueues) extract,
  consolidate, nudge, healthcheck. The ingest worker updates the job's
  `ingest_runs` row (running → progress sample → done/error) via `runIngest`'s
  `onProgress` callback, powering the live feed. **Ingestion is rate-limit-paced**:
  the ingest worker runs with `concurrency: INGEST_CONCURRENCY` (+ optional
  per-minute `limiter` via `INGEST_MAX_PER_MIN`), `runIngest` sleeps
  `INGEST_ITEM_DELAY_MS` between items, and connectors retry 429/503 with backoff
  (`util/http.ts` `fetchWithRetry`). Consolidation runs on `CONSOLIDATE_INTERVAL_MS`,
  Nudger on `NUDGER_INTERVAL_MS` (0 disables; default now 300000 = every 5 min).
  The nudge job runs both `runNudger` and `upcomingBriefings({post:true})`, so
  nudges + pre-meeting briefings are posted to the blackboard on a schedule.
  Graceful shutdown on signals.
- `services/util/http.ts` — `fetchWithRetry` (429/503 backoff honoring Retry-After)
  + `sleep`; used by all connectors (and the embedder backs off similarly).
- `services/db/schema.ts` — tables: users, oauth_accounts, sessions, sources,
  entities, episodes (monthly-partitioned by occurred_at; PK (id, occurred_at),
  dedup key (source_id, external_id, occurred_at); default partition),
  facts (require source_episode + source_id — provenance mandatory), edges
  (plain edge tables, graph: `mentioned_in` person→episode, `co_occurs`
  person↔person built by consolidation, and `relationship` person→person with
  props {role, detail} from extraction), open_loops, retention, blackboard,
  nudge_snoozes (user_id + nudge_key → snoozed_until; source-keyed nudge
  suppression so snoozes survive the Nudger's regenerate-each-run model),
  ingest_runs (live ingestion status: status/ingested/total/items sample/error/started/finished).
- `services/ingest/pipeline.ts` + connectors — pull source content into episodes;
  Gmail connector is incremental + people-aware (History API cursor, person
  entities from senders/recipients, HTML→text cleaning, attachments to store).
  gcal syncs incrementally (syncToken); attendees → person entities → briefings.
- `services/consolidate/*` — deterministic "sleep" maintenance: alias resolution,
  fact dedup+reinforcement, contradiction flagging, decay→stale, retention
  (compress/purge/forget), then `peopleGraph.ts` `buildPeopleGraph` (materializes
  person↔person `co_occurs` edges weighted by shared episodes + derives each
  person's `circle` from modal source scope → entities.attrs.circle). Lexical by default.
- `services/semantic/*` — optional `SEMANTIC_INTELLIGENCE=true` upgrades: pgvector
  candidate-gen + LLM adjudication for alias match, NLI contradiction, intent
  routing. Always falls back to lexical on LLM error.
- `services/agents/*` — agent mesh writing to shared blackboard (no direct calls):
  People (relationship health + a deterministic cadence trend [warming/steady/
  cooling from recent-30d vs prior-30–90d interaction rates] + cold-connection
  alerts), Briefer (per-meeting briefings: one entry per event grouping all
  attendees; surfaces facts where the person is subject OR object, so context
  others mentioned about them shows up), Nudger (four nudge
  types: open-loops, approaching commitments [due-dated loops, kind=commitment],
  contradictions worth resolving [kind=contradiction], relationship alerts — all
  snooze-aware via nudge_snoozes), Briefer (pre-meeting briefings), Conductor
  (routes query by intent → agent or recall fallback).
- `app/src/lib/api/client.ts` + `endpoints.ts` — typed fetch client to the backend;
  `casing.ts` maps snake_case ↔ camelCase. Auth tokens in `lib/auth/tokenStore.ts`.

## Data / Config / Env
- **Postgres + Redis** via `services/docker-compose.yml` (project "mnemosyne").
- **Config** validated by Zod in `services/config/index.ts`; `.env` from `.env.example`.
- Key env vars: `VECTOR_DIM` (default 1024, Qwen v3 — change only while DB empty),
  `LLM_PROVIDER` (`dev`|`gemini`), `EMBEDDING_PROVIDER` (`dev`|`gemini`|`qwen`),
  `EMBEDDING_API_KEY`, `SEMANTIC_INTELLIGENCE`, `CONSOLIDATE_INTERVAL_MS`,
  `NUDGER_INTERVAL_MS`, `DECAY_MAX_AGE_DAYS`, `SEMANTIC_MAX_PAIRS`,
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GMAIL_QUERY`, `GMAIL_MAX_MESSAGES`,
  `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`,
  `MICROSOFT_REDIRECT_URI`, `OUTLOOK_MAX_MESSAGES`.
- **Auth:** short-lived JWT access token + rotating opaque refresh token (hash
  stored, rotated each refresh); scrypt passwords; Google OAuth tokens encrypted
  at rest. Frontend `.env` points at the backend base URL.
- **Multi-account, multi-provider (Google + Microsoft):** one user may connect
  many accounts across providers. The OAuth `state` carries `intent`
  (`signin` | `link`): `/auth/{google,microsoft}/url?intent=link` (Bearer-authed)
  attaches an account to the current user via `linkOauthAccountForUser` (refuses
  to steal an account owned by another user); `signin` keeps create-or-login.
  Both providers go through shared `oauthUrl`/`oauthCallback` handlers in
  `auth/index.ts` driven by a per-provider adapter (google.ts / microsoft.ts).
  `oauth_accounts` stores `provider`, `email`/`display_name`, granted `scope`;
  `auth/scopes.ts` `servicesFromScope` maps Google + MS Graph scopes → services.
  Each `sources` row binds to one account via `oauth_account_id` (ON DELETE SET
  NULL); the pipeline resolves the token for that specific account
  (`getValidGoogle/MicrosoftAccessTokenForAccount`, falling back to the user's
  first account of the right provider). Source kinds: google `gmail`/`gcal`/
  `gcontacts`, microsoft `msmail`/`mscal`/`mscontacts`; `OAUTH_KIND_PROVIDER` in
  server.ts validates kind↔account provider on create. Frontend: Settings →
  `ConnectedAccountsCard` (per-provider connect + "Add services"), `useAccounts`,
  `accountsApi`, provider-aware account picker in `CreateSourceDialog`,
  Google/Microsoft connect cards on Sources, shared `OAuthCallbackHandler` for
  `/auth/{google,microsoft}/callback`.
- **Artifact store:** local filesystem, swappable for S3.

## Notes / Constraints
- Provenance is mandatory: facts cannot be inserted without source_episode + source_id.
- Episodes are natively partitioned monthly; partition key must be in every unique constraint.
- Graph is plain edge tables; `getNeighbors` does depth 1–3 recursive-CTE traversal with cycle guard.
- `VECTOR_DIM` is one value shared by app code and schema — change only on empty DB.
- Schema is one declarative file (no migration tool yet — `db:reset` drops/recreates).
- Consolidation alias-merge + contradiction detection are lexical heuristics (can
  over-merge ambiguous first names); contradiction links are advisory, never auto-retract.
- Read-only by design: no write/delete to connected accounts. No Guardian /
  privacy-mode / sensitive-tier gating — all of a user's own memory is fully
  visible to them (multi-tenancy still isolates by user_id).
- Tests run on `dev` providers — no keys or network needed.
