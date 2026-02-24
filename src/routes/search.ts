import { Hono } from "hono";
import { query } from "../db.js";
import { generateEmbedding } from "../embeddings.js";
import pgvector from "pgvector";

const search = new Hono();

// POST /v3/search - Search documents
search.post("/", async (c) => {
  const body = await c.req.json();
  const { q, containerTag, limit = 10, threshold = 0.3 } = body;

  if (!q) {
    return c.json({ error: "q (query) is required" }, 400);
  }

  const embedding = await generateEmbedding(q);
  const embeddingSql = pgvector.toSql(embedding);

  let sql = `
    SELECT
      id, content, metadata, container_tag, status, created_at, updated_at,
      1 - (embedding <=> $1::vector) AS score
    FROM documents
    WHERE embedding IS NOT NULL
  `;
  const params: unknown[] = [embeddingSql];
  let paramIdx = 2;

  if (containerTag) {
    sql += ` AND container_tag = $${paramIdx}`;
    params.push(containerTag);
    paramIdx++;
  }

  sql += ` AND 1 - (embedding <=> $1::vector) > $${paramIdx}`;
  params.push(threshold);
  paramIdx++;

  sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIdx}`;
  params.push(limit);

  const result = await query(sql, params);

  return c.json({
    results: result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      containerTag: row.container_tag,
      score: parseFloat(row.score),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    count: result.rows.length,
  });
});

// POST /v4/search - Search memories (alias with different response shape)
const searchV4 = new Hono();

searchV4.post("/", async (c) => {
  const body = await c.req.json();
  const { q, limit = 10 } = body;

  if (!q) {
    return c.json({ error: "q (query) is required" }, 400);
  }

  const embedding = await generateEmbedding(q);
  const embeddingSql = pgvector.toSql(embedding);

  const result = await query(
    `SELECT
      id, content, metadata, container_tag, created_at,
      1 - (embedding <=> $1::vector) AS score
    FROM documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2`,
    [embeddingSql, limit]
  );

  return c.json({
    memories: result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      score: parseFloat(row.score),
      createdAt: row.created_at,
    })),
  });
});

export { search, searchV4 };
