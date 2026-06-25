# Project Mnemosyne — Backend Services (`services/`)

The backend services for the Project Mnemosyne personal memory system, providing the Fastify API server, BullMQ workers, and Kysely database layer.

## Technology Stack

- **Runtime**: Node.js + TypeScript (strict ESM).
- **Database**: PostgreSQL 16 + pgvector (for relational, vector embeddings, and graph edge tables).
- **Query Builder**: Kysely (strongly typed SQL builder).
- **API Server**: Fastify.
- **Task Queue**: BullMQ + Redis (handles background ingestion, extraction, and memory consolidation).
- **Embeddings & LLM**: Gemini API and Qwen model wrappers.
- **Storage**: Local filesystem artifact store (swappable for AWS S3).
- **Validation & Test**: Zod (for configuration schema) and Vitest (integration testing suite).

## Layout

```
services/
  docker-compose.yml   # PostgreSQL (pgvector) + Redis
  .env.example         # Template configuration env file
  config/              # Zod environment schema and parsing
  auth/                # OAuth (Google/Microsoft), JWT, and encryption helpers
  db/                  # Database schema, client, repositories, and reset helpers
  storage/             # Local filesystem / S3 swappable storage module
  embeddings/          # Semantic embedding providers (Gemini, Qwen, Dev)
  llm/                 # Generative LLM providers (Gemini, Qwen, Heuristics)
  extract/             # Graph entity and fact extraction logic
  asr/                 # Audio Speech Recognition (ASR) for voice notes
  capture/             # Voice-note audio storage and ingestion pipeline
  ingest/              # Third-party data ingestion pipeline (Gmail, GCal, Outlook)
  memory/              # Grounded retrieval and QA search query engine
  consolidate/         # Background consolidation (alias resolution, deduplication, decay)
  agents/              # Agent layer (Briefer, Nudger, Conductor, PeopleGraph)
  queue/               # Queue definition and BullMQ wrappers
  api/                 # Fastify router endpoints and server configuration
  worker/              # Worker processors executing BullMQ tasks
  test/                # Integration test suites
```

## Setup & Running Locally

1. **Configure Environment**:
   ```bash
   cd services
   cp .env.example .env
   ```
2. **Install Dependencies**:
   ```bash
   pnpm install
   ```
3. **Start Infrastructure (Docker)**:
   ```bash
   pnpm infra:up
   ```
4. **Initialize Database Schema**:
   ```bash
   pnpm db:reset
   ```
5. **Run Integration Tests**:
   ```bash
   pnpm test
   ```
6. **Start Backend Servers**:
   ```bash
   # Run the Fastify API (on http://localhost:3000)
   pnpm api

   # Run the background Queue Workers
   pnpm worker
   ```
