# CLAUDE.md

This file provides context for AI assistants (Claude Code, Clawdbot, etc.) working in this repository.

## What this project is

A self-hosted reimplementation of the [Supermemory](https://supermemory.ai) API. It provides a semantic memory layer for AI applications: store documents, auto-embed them, and search by meaning. The API contract matches the official Supermemory TypeScript SDK so existing clients work without modification.

## Tech stack

- **Runtime:** Node.js 22, TypeScript (ES2022 target)
- **Framework:** Hono (lightweight HTTP framework)
- **Database:** Postgres 17 with pgvector extension
- **Embeddings:** Novita AI (`qwen/qwen3-embedding-8b`, 1536 dimensions) via OpenAI-compatible SDK
- **Networking:** Tailscale (optional, for private access)
- **Deployment:** Docker Compose (three services: tailscale, api, postgres)

## Project layout

```
src/
  index.ts          → Hono server setup, CORS, auth middleware, route mounting
  db.ts             → Postgres connection pool, pgvector type registration
  migrate.ts        → Idempotent schema migrations (runs on container start)
  embeddings.ts     → Embedding generation (OpenAI-compatible client)
  routes/
    documents.ts    → Document CRUD, batch operations, file upload
    search.ts       → Semantic search (v3 and v4 endpoints)
    settings.ts     → Key-value settings store
    memories.ts     → Memory deletion and updates

plugin/
  openclaw.plugin.json  → Plugin manifest and config schema for OpenClaw
  index.ts              → Plugin implementation (hooks, tools, CLI commands)
```

## Key architecture decisions

- **Single database:** Both document text and vector embeddings live in Postgres (no separate vector DB). pgvector handles similarity search with IVFFlat indexing.
- **1536-dimension embeddings:** Qwen3-embedding-8b supports up to 4096 dims but we use 1536 via Matryoshka representation for storage efficiency. This dimension is baked into the DB schema — changing it requires recreating the `documents` table.
- **Cosine distance:** Search uses the `<=>` operator (cosine distance) for similarity ranking. Scores range 0-1, higher = more similar.
- **Idempotent migrations:** `src/migrate.ts` runs on every startup using `CREATE IF NOT EXISTS`. No migration framework — just raw SQL.
- **Auth is optional:** If `SUPERMEMORY_API_KEY` env var is set, all `/v3/*` and `/v4/*` routes require `Authorization: Bearer <key>`. The `/health` endpoint is always open.

## How to run locally

```bash
# Start all services (builds on first run)
docker compose up -d

# Find Tailscale IP (if using Tailscale)
docker compose exec tailscale tailscale ip -4

# Health check
curl http://<API_URL>:8787/health

# Rebuild after code changes
docker compose up -d --build supermemory-api

# View logs
docker compose logs -f supermemory-api
```

For development without Docker:
```bash
npm install
# Ensure DATABASE_URL and NOVITA_API_KEY are set in environment
npm run migrate    # run schema migrations
npm run dev        # start with tsx watch (auto-reload)
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (set automatically by docker-compose) | Postgres connection string |
| `NOVITA_API_KEY` | Yes | API key for embedding generation |
| `SUPERMEMORY_API_KEY` | No | Bearer token for API auth (empty = no auth) |
| `TS_AUTHKEY` | Only with Tailscale | Tailscale auth key |
| `PORT` | No (default: 8787) | HTTP server port |

## Database schema

Two tables, created by `src/migrate.ts`:

**`documents`** — Core storage
- `id` TEXT (UUID, primary key)
- `content` TEXT
- `metadata` JSONB
- `embedding` vector(1536) — pgvector column
- `container_tag` TEXT (default: "default") — for multi-tenant grouping
- `status` TEXT (default: "processed")
- `created_at`, `updated_at` TIMESTAMPTZ

**`settings`** — Key-value config
- `id` TEXT (always "default")
- `data` JSONB
- `updated_at` TIMESTAMPTZ

**Indexes:**
- IVFFlat on `embedding` (cosine distance, lists=100)
- B-tree on `container_tag`
- B-tree on `created_at DESC`

## API endpoints

All endpoints live under `/v3` and `/v4` to match the Supermemory SDK contract.

**Documents:** `POST /v3/documents`, `POST /v3/documents/batch`, `POST /v3/documents/list`, `GET /v3/documents/:id`, `PATCH /v3/documents/:id`, `DELETE /v3/documents/:id`, `DELETE /v3/documents/bulk`, `POST /v3/documents/file`, `GET /v3/documents/processing`

**Search:** `POST /v3/search`, `POST /v4/search`

**Memories:** `DELETE /v4/memories`, `PATCH /v4/memories`

**Settings:** `GET /v3/settings`, `PATCH /v3/settings`

**Other:** `GET /health` (no auth), `POST /v4/profile`

## Embedding provider

The embedding client in `src/embeddings.ts` is a thin wrapper around the OpenAI SDK. To swap providers, change three values in that file: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, and the `baseURL`/`apiKey` in `getClient()`. Any OpenAI-compatible provider works (OpenAI, Together, Ollama, etc.). If you change dimensions, the DB column must be recreated.

## OpenClaw plugin (`plugin/`)

The plugin integrates this API with OpenClaw (Clawdbot) agents:
- **`api.on("before_agent_start")`** — Searches memory for context relevant to the user's message, injects matching results as a system message
- **`api.on("agent_end")`** — Scans user messages for factual patterns (regex-based) and auto-stores them
- **`api.registerTool()`** — Exposes `memory_recall` and `memory_store` as agent-callable tools
- **`api.registerCli()`** — Adds `openclaw supermemory health|search|add` CLI commands

Plugin config is read from `api.pluginConfig` (not `api.config`). Hooks use `api.on()` (not `api.hook()`).

## Common tasks

**Add a new API endpoint:**
1. Create or edit the route file in `src/routes/`
2. Mount it in `src/index.ts` using `app.route()` or individual method handlers
3. Follow the existing pattern: parse request body, call `db.query()`, return JSON via `c.json()`

**Change the embedding model:**
1. Edit `src/embeddings.ts` — update `EMBEDDING_MODEL` and `baseURL`
2. If dimensions change, update `EMBEDDING_DIMENSIONS` and recreate the `documents` table

**Add a new DB table:**
1. Add `CREATE TABLE IF NOT EXISTS` SQL to `src/migrate.ts`
2. Restart the container (migrations run on startup)

**Modify the OpenClaw plugin:**
1. Edit `plugin/index.ts`
2. Copy the updated plugin to `~/.openclaw/extensions/memory-supermemory/`
3. Verify with `openclaw supermemory health`
