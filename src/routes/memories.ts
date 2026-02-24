import { Hono } from "hono";
import { query } from "../db.js";

const memories = new Hono();

// DELETE /v4/memories - Forget memories
memories.delete("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { ids, containerTag } = body as { ids?: string[]; containerTag?: string };

  if (ids && Array.isArray(ids)) {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    const result = await query(
      `DELETE FROM documents WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    return c.json({ deleted: result.rowCount });
  }

  if (containerTag) {
    const result = await query(
      "DELETE FROM documents WHERE container_tag = $1 RETURNING id",
      [containerTag]
    );
    return c.json({ deleted: result.rowCount });
  }

  return c.json({ error: "Provide ids or containerTag" }, 400);
});

// PATCH /v4/memories - Update memory
memories.patch("/", async (c) => {
  const body = await c.req.json();
  const { id, content, metadata } = body;

  if (!id) {
    return c.json({ error: "id is required" }, 400);
  }

  if (content) {
    const { generateEmbedding } = await import("../embeddings.js");
    const pgvector = await import("pgvector");
    const embedding = await generateEmbedding(content);
    await query(
      `UPDATE documents SET content = $1, embedding = $2, updated_at = now() WHERE id = $3`,
      [content, pgvector.default.toSql(embedding), id]
    );
  }

  if (metadata) {
    await query(
      `UPDATE documents SET metadata = metadata || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(metadata), id]
    );
  }

  return c.json({ id, status: "updated" });
});

export default memories;
