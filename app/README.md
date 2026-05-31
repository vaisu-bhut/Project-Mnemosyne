# Mnemosyne — Web Frontend (`app/`)

A TypeScript web UI for the Mnemosyne personal-memory API. It exercises the whole
backend: auth → connect sources → ingest → cited search/ask → the proactive agent
mesh (mind, briefings, people, open loops) → admin (consolidation, contradictions).

The backend contract lives in [`../BACKEND.md`](../BACKEND.md).

## Stack

- **Next.js 16 (App Router)** + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** + shadcn-style components (Radix + `cva` + `cn`)
- **TanStack Query** for server state; **Zod** for validation; **sonner** toasts
- **Vitest** for unit tests

## Prerequisites

- Node 20+ and pnpm (this repo uses `corepack pnpm` — pnpm isn't on PATH).
- The backend running (see `../services`): Postgres + Redis (`pnpm infra:up`),
  the API (`pnpm api`, port 3000), and the worker (`pnpm worker`) for
  ingestion/proactive features.

## Setup & run

```bash
corepack pnpm -C app install
copy app\.env.example app\.env.local   # Windows (or cp on *nix)
corepack pnpm -C app dev                # http://localhost:3001
```

In dev, the browser calls same-origin `/api/*`, which `next.config.ts` rewrites to
the backend (`BACKEND_ORIGIN`, default `http://localhost:3000`) — so **no CORS is
needed locally**. For production, point `NEXT_PUBLIC_API_BASE_URL` at the API
origin and set `WEB_ORIGIN` on the backend (it has `@fastify/cors`).

### Run everything (three terminals)

```bash
corepack pnpm -C services api        # backend API     :3000
corepack pnpm -C services worker     # ingest/agents worker
corepack pnpm -C app dev             # frontend         :3001
```

## Scripts

| Script | What |
|---|---|
| `dev` | Next dev server on :3001 |
| `build` / `start` | production build / serve |
| `lint` | ESLint |
| `typecheck` | `tsc --noEmit` |
| `test` / `test:watch` | Vitest |

## Environment

| Var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | Base URL the browser client calls |
| `BACKEND_ORIGIN` | `http://localhost:3000` | Dev-proxy target (server-side) |

## Architecture

- **`src/lib/api`** — `client.ts` (typed fetch: bearer auth + single-flight
  refresh-on-401 retry), `endpoints.ts` (typed per-resource calls),
  `types.ts`, `casing.ts` (snake→camel for raw-row endpoints).
- **`src/lib/auth`** — access token in memory + refresh token in `localStorage`;
  `AuthProvider` bootstraps via refresh → `/auth/me`.
- **`src/lib/mode`** — Guardian mode (`default`/`work`/`guest`) + sensitive
  toggle, applied to search/ask/conduct.
- **`src/app/(auth)`** — public login/register. **`src/app/(app)`** — auth-gated
  shell (sidebar, top bar, episode drawer) with the feature pages.
- **Citations** — every fact/episode/answer links to its source episode via the
  app-wide `EpisodeDrawer` ("verify on click").

## Known gaps (coordinate with backend)

- **Google web OAuth**: `/auth/google/callback` returns tokens as JSON
  (mobile-shaped). Until the backend redirects to a web callback with the token
  pair, the **filesystem** connector is the no-OAuth path.
- **No job-status endpoint**: ingestion shows an optimistic "Ingesting" badge,
  then results appear in Search (poll-free).
