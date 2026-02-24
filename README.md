# supermemory (self-hosted)

A self-hosted, API-compatible reimplementation of [Supermemory](https://supermemory.ai) — a memory layer for AI applications. Store documents, embed them automatically, and search by semantic similarity. Runs entirely in Docker, optionally behind Tailscale so nothing is exposed to the public internet.

## Why self-host?

Supermemory is a great product, but the backend is closed-source. The [public repo](https://github.com/supermemoryai/supermemory) only ships the frontend and client SDKs, and their official self-hosting option is enterprise-only (Cloudflare Workers).

This project reimplements the `/v3` and `/v4` API endpoints from scratch, reverse-engineered from the [TypeScript SDK](https://github.com/supermemoryai/sdk-ts) contract. Existing clients — including the official `supermemory` npm package — can point at your instance with no code changes.

## Stack

| Component | Role |
|-----------|------|
| [Hono](https://hono.dev) | HTTP framework (Node.js) |
| [Postgres 17](https://www.postgresql.org/) + [pgvector](https://github.com/pgvector/pgvector) | Document storage and vector search |
| [Novita AI](https://novita.ai) | Embedding generation (`qwen/qwen3-embedding-8b`, swappable) |
| [Tailscale](https://tailscale.com) | Optional private networking (tailnet-only access) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Docker Compose                                     │
│                                                     │
│  ┌───────────┐    shared network    ┌────────────┐  │
│  │ tailscale │◄────────────────────►│    api     │  │
│  │ (optional)│     (port 8787)      │   :8787    │  │
│  └───────────┘                      └─────┬──────┘  │
│   100.x.x.x                              │         │
│   (tailnet only)                          │         │
│                                      ┌────▼──────┐  │
│                                      │  postgres  │  │
│                                      │  pgvector  │  │
│                                      └───────────┘  │
│                                       (internal)    │
└─────────────────────────────────────────────────────┘
```

With Tailscale enabled, the API container shares the Tailscale container's network stack (`network_mode: service:tailscale`). Port 8787 is reachable **only** via the Tailscale IP — not on localhost, not on LAN. Postgres is internal to the Docker network with no exposed ports.

Without Tailscale, you can expose port 8787 directly (see [Running without Tailscale](#running-without-tailscale)).

---

## Getting started

### Prerequisites

- Docker and Docker Compose
- A [Tailscale auth key](https://login.tailscale.com/admin/settings/keys) (reusable recommended) — skip if not using Tailscale
- A [Novita AI](https://novita.ai) API key (free tier available), or any OpenAI-compatible embedding provider

### 1. Clone and configure

```bash
git clone https://github.com/s11ngh/supermemory-selfhosted.git
cd supermemory-selfhosted
cp .env.example .env
```

Edit `.env` with your keys:

```env
TS_AUTHKEY=tskey-auth-XXXXX          # Tailscale auth key
NOVITA_API_KEY=sk_XXXXX              # Novita AI API key
SUPERMEMORY_API_KEY=                  # Optional: require Bearer token auth
```

### 2. Start

```bash
docker compose up -d
```

First run pulls images and builds the API container (~1 min). Database migrations run automatically on every startup and are idempotent.

### 3. Find your API URL

**With Tailscale:**

```bash
docker compose exec tailscale tailscale ip -4
# → 100.x.x.x
```

Your API is at `http://100.x.x.x:8787`.

**Without Tailscale:** `http://localhost:8787` (see [Running without Tailscale](#running-without-tailscale)).

### 4. Verify

```bash
curl http://<YOUR_API_URL>:8787/health
# → {"status":"ok","version":"1.0.0"}
```

---

## Usage

### Store a document

```bash
curl -X POST http://<API_URL>:8787/v3/documents \
  -H "Content-Type: application/json" \
  -d '{"content": "The project uses Postgres with pgvector for embeddings"}'
```

```json
{"id": "e8920426-...", "status": "processed", "message": "Document added successfully"}
```

### Search by meaning

```bash
curl -X POST http://<API_URL>:8787/v3/search \
  -H "Content-Type: application/json" \
  -d '{"q": "what database do we use?", "limit": 5}'
```

```json
{
  "results": [
    {
      "id": "e8920426-...",
      "content": "The project uses Postgres with pgvector for embeddings",
      "score": 0.757,
      "containerTag": "default",
      "createdAt": "2026-02-23T23:57:11.810Z"
    }
  ],
  "count": 1
}
```

### Use the official Supermemory SDK

Since this implements the same API contract, the official SDK works out of the box:

```typescript
import Supermemory from "supermemory";

const client = new Supermemory({
  apiKey: "your-SUPERMEMORY_API_KEY-if-set",
  baseURL: "http://<API_URL>:8787",
});

await client.add({ content: "Remember this." });
const results = await client.search.documents({ q: "what should I remember?" });
```

---

## API reference

All endpoints match the supermemory SDK contract. If `SUPERMEMORY_API_KEY` is set, all `/v3/*` and `/v4/*` routes require `Authorization: Bearer <key>`. The `/health` endpoint is always open.

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/documents` | Add a document (auto-embeds) |
| `POST` | `/v3/documents/batch` | Batch add documents |
| `POST` | `/v3/documents/list` | List documents (paginated) |
| `GET` | `/v3/documents/:id` | Get a document by ID |
| `PATCH` | `/v3/documents/:id` | Update content (re-embeds) or metadata |
| `DELETE` | `/v3/documents/:id` | Delete a document |
| `DELETE` | `/v3/documents/bulk` | Bulk delete by IDs |
| `POST` | `/v3/documents/file` | Upload and embed a file |
| `GET` | `/v3/documents/processing` | List documents still processing |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/search` | Semantic search (v3 response shape) |
| `POST` | `/v4/search` | Semantic search (v4 response shape) |

### Memories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `DELETE` | `/v4/memories` | Delete by IDs or container tag |
| `PATCH` | `/v4/memories` | Update content or metadata |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v3/settings` | Get all settings |
| `PATCH` | `/v3/settings` | Merge new settings |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/v4/profile` | Profile endpoint |

---

## How it works

### Embeddings

When you add a document, the API sends its text to an OpenAI-compatible embedding endpoint (Novita AI by default, using `qwen/qwen3-embedding-8b`). The model supports up to 4096 dimensions but we request **1536** via the `dimensions` parameter ([Matryoshka representation](https://huggingface.co/blog/matryoshka)) to balance quality and storage.

The resulting vector is stored alongside the document text in Postgres.

### Search

A search query is embedded the same way. Postgres uses the cosine distance operator (`<=>`) with an IVFFlat index to find the closest documents. Results are ranked by similarity score (0 to 1, higher = more relevant).

### Database schema

Migrations run on every container start (idempotent `CREATE IF NOT EXISTS`):

- **`documents`** — `id` (UUID), `content`, `metadata` (JSONB), `embedding` (vector 1536), `container_tag`, `status`, timestamps
- **`settings`** — key-value JSONB store
- **Indexes** — IVFFlat on embeddings (cosine), B-tree on `container_tag` and `created_at`

### Authentication

If `SUPERMEMORY_API_KEY` is set in `.env`, all `/v3/*` and `/v4/*` endpoints require `Authorization: Bearer <key>`. The `/health` endpoint is always open. If the variable is empty, the API runs unauthenticated — fine when access is restricted to your Tailscale network.

---

## Swapping the embedding provider

Embedding logic lives in `src/embeddings.ts`. To use a different OpenAI-compatible provider (OpenAI, Together, Ollama, etc.), change three things:

```typescript
// src/embeddings.ts
const EMBEDDING_MODEL = "text-embedding-3-small";   // model name
const EMBEDDING_DIMENSIONS = 1536;                   // must match DB column

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,            // env var name
      baseURL: "https://api.openai.com/v1",          // provider URL
    });
  }
  return client;
}
```

If you change the dimension count, you'll need to drop and recreate the `documents` table (or alter the `embedding` column), since pgvector dimensions are fixed per column.

---

## Running without Tailscale

Remove the `tailscale` service from `docker-compose.yml`, drop `network_mode: service:tailscale` from `supermemory-api`, and add a port mapping:

```yaml
supermemory-api:
  build: .
  depends_on:
    db:
      condition: service_healthy
  ports:
    - "8787:8787"
  environment:
    - DATABASE_URL=postgresql://supermemory:supermemory@db:5432/supermemory
    - NOVITA_API_KEY=${NOVITA_API_KEY}
    - SUPERMEMORY_API_KEY=${SUPERMEMORY_API_KEY:-}
    - PORT=8787
```

The API will be available at `http://localhost:8787`. Set `SUPERMEMORY_API_KEY` if exposing beyond localhost.

---

## Docker management

```bash
docker compose up -d                              # start
docker compose down                               # stop
docker compose logs -f                            # tail all logs
docker compose logs -f supermemory-api            # tail API logs only
docker compose up -d --build supermemory-api      # rebuild after code changes
docker compose exec tailscale tailscale status    # check tailnet peers
```

Data persists across restarts in Docker volumes:
- `pgdata` — Postgres data directory
- `tailscale-state` — Tailscale node identity

---

## OpenClaw (Clawdbot) plugin

The `plugin/` directory contains an [OpenClaw](https://github.com/openclaw/openclaw) memory plugin that gives AI agents persistent memory backed by this API.

### What it does

- **Auto-recall** — Before each agent turn, searches memory for context relevant to the user's message and injects it
- **Auto-capture** — After each turn, detects factual statements ("I prefer...", "we use...", "remember that...") and stores them
- **Agent tools** — Exposes `memory_recall` and `memory_store` as tools the agent can call directly
- **CLI commands** — `openclaw supermemory health|search|add` for manual interaction

### Install

```bash
cp -r plugin/ ~/.openclaw/extensions/memory-supermemory/
```

### Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "memory-supermemory": {
      "apiUrl": "http://<YOUR_API_URL>:8787",
      "apiKey": "",
      "autoRecall": true,
      "autoCapture": true,
      "recallLimit": 3,
      "minScore": 0.55
    },
    "slots": {
      "memory": "memory-supermemory"
    }
  }
}
```

### Enable and verify

```bash
openclaw plugins enable memory-supermemory
openclaw supermemory health        # → {"status":"ok","version":"1.0.0"}
openclaw supermemory add "test"    # → {"id":"...","status":"processed",...}
openclaw supermemory search "test" # → results with score
```

### Plugin configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | string | *required* | Base URL of the supermemory API |
| `apiKey` | string | `""` | Bearer token (leave blank if API has no auth) |
| `autoRecall` | boolean | `true` | Search memory before each agent turn |
| `autoCapture` | boolean | `true` | Store detected facts after each turn |
| `recallLimit` | number | `3` | Max memories to retrieve per query |
| `minScore` | number | `0.55` | Minimum similarity score (0-1) to include |

---

## Project structure

```
.
├── .env.example            # Template for secrets
├── docker-compose.yml      # Three services: tailscale, api, postgres
├── Dockerfile              # Multi-stage build (tsc → Node 22 slim)
├── package.json
├── tsconfig.json
├── plugin/                 # OpenClaw memory plugin
│   ├── openclaw.plugin.json
│   └── index.ts
└── src/
    ├── index.ts            # Hono server, routing, auth middleware
    ├── db.ts               # Postgres pool + pgvector type registration
    ├── migrate.ts          # Schema migrations (idempotent, runs on startup)
    ├── embeddings.ts       # Embedding client (OpenAI-compatible)
    └── routes/
        ├── documents.ts    # Document CRUD, batch, file upload
        ├── search.ts       # v3 + v4 semantic search
        ├── settings.ts     # Settings key-value store
        └── memories.ts     # Memory delete + update
```

## License

MIT
