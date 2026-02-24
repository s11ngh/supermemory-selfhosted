# supermemory-selfhosted

A self-hosted, supermemory-compatible API server you can run entirely in Docker behind Tailscale.

## Why this exists

[Supermemory](https://supermemory.ai) is a memory API for AI apps — you store documents, it embeds them, and you search by semantic similarity. Great product, but the backend is closed-source. The [public repo](https://github.com/supermemoryai/supermemory) only contains the frontend and client SDKs. Their official self-hosting option is enterprise-only and deploys to Cloudflare Workers.

This project is a from-scratch reimplementation of the supermemory API, reverse-engineered from their [TypeScript SDK](https://github.com/supermemoryai/sdk-ts) contract. It implements the same `/v3` and `/v4` endpoints so existing clients and integrations (including the official `supermemory` npm package) can point at your instance instead.

## Stack

| Component | What | Why |
|-----------|------|-----|
| [Hono](https://hono.dev) | API framework | Lightweight, fast, runs on Node.js |
| [Postgres 17](https://www.postgresql.org/) + [pgvector](https://github.com/pgvector/pgvector) | Storage + vector search | Single database for both documents and embeddings |
| [Novita AI](https://novita.ai) | Embedding generation | OpenAI-compatible API, runs `qwen/qwen3-embedding-8b` |
| [Tailscale](https://tailscale.com) | Network access | Container gets its own tailnet IP — nothing exposed to the internet |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose                                 │
│                                                 │
│  ┌───────────┐    shares network    ┌────────┐  │
│  │ tailscale │◄────────────────────►│  api   │  │
│  │           │    (port 8787)       │ :8787  │  │
│  └───────────┘                      └───┬────┘  │
│   100.x.x.x                            │       │
│   (tailnet only)                        │       │
│                                    ┌────▼────┐  │
│                                    │ postgres │  │
│                                    │ pgvector │  │
│                                    └─────────┘  │
└─────────────────────────────────────────────────┘
```

The API container uses `network_mode: service:tailscale`, so it shares the Tailscale container's network stack. Port 8787 is reachable **only** via the Tailscale IP — not on localhost, not on LAN. Postgres is internal to Docker's network and has no exposed ports.

## Quick start

### Prerequisites

- Docker and Docker Compose
- A [Tailscale](https://login.tailscale.com/admin/settings/keys) auth key (reusable recommended)
- A [Novita AI](https://novita.ai) API key (they have a free tier)

### 1. Clone and configure

```bash
git clone <this-repo> && cd supermemory
cp .env.example .env
```

Edit `.env`:

```env
TS_AUTHKEY=tskey-auth-XXXXX          # Tailscale auth key
NOVITA_API_KEY=sk_XXXXX              # Novita AI API key
SUPERMEMORY_API_KEY=                  # Optional: set to require Bearer token auth
```

### 2. Start

```bash
docker compose up -d
```

First run pulls images and builds the API (~1 min). Migrations run automatically on startup.

### 3. Find your Tailscale IP

```bash
docker compose exec tailscale tailscale ip -4
# e.g. 100.109.211.41
```

### 4. Verify

```bash
curl http://<TAILSCALE_IP>:8787/health
# {"status":"ok","version":"1.0.0"}
```

## API reference

All endpoints live under `/v3` and `/v4` to match the supermemory SDK contract.

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/documents` | Add a document |
| `POST` | `/v3/documents/batch` | Batch add documents |
| `POST` | `/v3/documents/list` | List documents (paginated) |
| `GET` | `/v3/documents/:id` | Get a document by ID |
| `PATCH` | `/v3/documents/:id` | Update content or metadata |
| `DELETE` | `/v3/documents/:id` | Delete a document |
| `DELETE` | `/v3/documents/bulk` | Bulk delete by IDs |
| `POST` | `/v3/documents/file` | Upload a file |
| `GET` | `/v3/documents/processing` | List documents still processing |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v3/search` | Semantic search across documents |
| `POST` | `/v4/search` | Search memories (alternate response shape) |

### Memories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `DELETE` | `/v4/memories` | Forget memories by IDs or container tag |
| `PATCH` | `/v4/memories` | Update a memory |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v3/settings` | Get settings |
| `PATCH` | `/v3/settings` | Update settings |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `POST` | `/v4/profile` | Profile endpoint |

## Usage examples

### Add a memory

```bash
curl -X POST http://<TAILSCALE_IP>:8787/v3/documents \
  -H "Content-Type: application/json" \
  -d '{"content": "The project uses Postgres with pgvector for embeddings"}'
```

Response:
```json
{"id": "e8920426-...", "status": "processed", "message": "Document added successfully"}
```

### Search

```bash
curl -X POST http://<TAILSCALE_IP>:8787/v3/search \
  -H "Content-Type: application/json" \
  -d '{"q": "what database do we use?", "limit": 5}'
```

Response:
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

### Use with the official supermemory SDK

```typescript
import Supermemory from "supermemory";

const client = new Supermemory({
  apiKey: "your-SUPERMEMORY_API_KEY-if-set",
  baseURL: "http://<TAILSCALE_IP>:8787",
});

await client.add({ content: "Remember this." });
const results = await client.search.documents({ q: "what should I remember?" });
```

## How it works

### Embeddings

When you add a document, the API sends its text to Novita AI's OpenAI-compatible endpoint using `qwen/qwen3-embedding-8b`. The model natively supports up to 4096 dimensions but we request 1536 via the `dimensions` parameter ([Matryoshka representation](https://huggingface.co/blog/matryoshka)) to keep storage efficient.

The resulting vector is stored in the `embedding` column alongside the document text.

### Search

A search query is embedded the same way. Postgres then uses the cosine distance operator (`<=>`) with an IVFFlat index to find the closest documents. Results are ranked by similarity score (0 to 1, higher is better).

### Database schema

Migrations run automatically on every container start (idempotent `CREATE IF NOT EXISTS`):

- **`documents`** — `id`, `content`, `metadata` (JSONB), `embedding` (vector 1536), `container_tag`, `status`, timestamps
- **`settings`** — key-value JSONB store
- **Indexes** — IVFFlat on embeddings for vector search, B-tree on `container_tag` and `created_at`

### Auth

If `SUPERMEMORY_API_KEY` is set in `.env`, all `/v3/*` and `/v4/*` endpoints require `Authorization: Bearer <key>`. The `/health` endpoint is always open. If the variable is empty, the API is unauthenticated — fine if your only access path is Tailscale.

## Swapping the embedding provider

The embedding logic is isolated in `src/embeddings.ts`. To use a different OpenAI-compatible provider (OpenAI, Together, Ollama, etc.), change the `baseURL`, `apiKey` env var, and model name:

```typescript
// src/embeddings.ts
const EMBEDDING_MODEL = "text-embedding-3-small";   // or any model
const EMBEDDING_DIMENSIONS = 1536;                   // must match DB schema

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,            // swap env var
      baseURL: "https://api.openai.com/v1",          // swap base URL
    });
  }
  return client;
}
```

If you change the dimension, drop and recreate the `documents` table (or alter the `embedding` column) since pgvector dimensions are fixed per column.

## Management

```bash
docker compose up -d                              # start all services
docker compose down                               # stop all services
docker compose logs -f                            # tail all logs
docker compose logs -f supermemory-api            # tail API logs only
docker compose up -d --build supermemory-api      # rebuild after code changes
docker compose exec tailscale tailscale status    # see tailnet peers
```

Data persists across restarts in Docker volumes:
- `pgdata` — Postgres data
- `tailscale-state` — Tailscale node identity

## Running without Tailscale

If you don't need Tailscale, remove the `tailscale` service, drop `network_mode: service:tailscale` from `supermemory-api`, and add a port mapping:

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

The API will then be available at `http://localhost:8787`.

## OpenClaw (Clawdbot) memory plugin

The `plugin/` directory contains an [OpenClaw](https://github.com/openclaw/openclaw) memory plugin that lets AI agents on your tailnet use this API for persistent memory.

**Features:**
- **Auto-recall** — before each agent turn, the plugin searches memory and injects relevant context
- **Auto-capture** — after each turn, facts ("I prefer…", "we use…", etc.) are stored automatically
- **Tools** — `memory_recall` and `memory_store` are available as agent tools
- **CLI** — `openclaw supermemory health|search|add` for direct interaction

### Install

```bash
# Copy (or symlink) the plugin into OpenClaw's extension directory
cp -r plugin/ ~/.openclaw/extensions/memory-supermemory/
```

### Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "memory-supermemory": {
      "apiUrl": "http://<TAILSCALE_IP>:8787",
      "apiKey": "",
      "autoRecall": true,
      "autoCapture": true,
      "recallLimit": 5,
      "minScore": 0.3
    },
    "slots": {
      "memory": "memory-supermemory"
    }
  }
}
```

### Enable

```bash
openclaw plugins enable memory-supermemory
```

### Verify

```bash
openclaw supermemory health        # → {"status":"ok","version":"1.0.0"}
openclaw supermemory add "test"    # → {"id":"...","status":"processed",...}
openclaw supermemory search "test" # → results with score
```

## Project structure

```
.
├── .env.example          # Template for secrets
├── docker-compose.yml    # Three services: tailscale, api, postgres
├── Dockerfile            # Multi-stage build: tsc → slim Node 22
├── package.json          # Dependencies
├── tsconfig.json
├── plugin/               # OpenClaw memory plugin
│   ├── openclaw.plugin.json
│   └── index.ts
└── src/
    ├── index.ts          # Hono server, routing, auth middleware
    ├── db.ts             # Postgres pool with pgvector type registration
    ├── migrate.ts        # Schema migrations (runs on startup)
    ├── embeddings.ts     # Novita AI / OpenAI-compatible embedding client
    └── routes/
        ├── documents.ts  # CRUD, batch, file upload
        ├── search.ts     # v3 + v4 semantic search
        ├── settings.ts   # Settings key-value store
        └── memories.ts   # Forget / update memories
```

## License

MIT
