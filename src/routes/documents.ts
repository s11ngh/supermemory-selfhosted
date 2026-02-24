import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { query } from "../db.js";
import { generateEmbedding, generateEmbeddings } from "../embeddings.js";
import pgvector from "pgvector";

const documents = new Hono();

// POST /v3/documents - Add a document
documents.post("/", async (c) => {
  const body = await c.req.json();
  const { content, metadata, containerTag } = body;

  if (!content) {
    return c.json({ error: "content is required" }, 400);
  }

  const id = uuidv4();
  const tag = containerTag ?? "default";

  // Generate embedding asynchronously - store doc first as "processing"
  const embedding = await generateEmbedding(content);

  await query(
    `INSERT INTO documents (id, content, metadata, embedding, container_tag, status)
     VALUES ($1, $2, $3, $4, $5, 'processed')`,
    [id, content, JSON.stringify(metadata ?? {}), pgvector.toSql(embedding), tag]
  );

  return c.json({
    id,
    status: "processed",
    message: "Document added successfully",
  });
});

// POST /v3/documents/batch - Batch add documents
documents.post("/batch", async (c) => {
  const body = await c.req.json();
  const { documents: docs } = body;

  if (!Array.isArray(docs) || docs.length === 0) {
    return c.json({ error: "documents array is required" }, 400);
  }

  const results = [];
  const contents = docs.map((d: { content: string }) => d.content);
  const embeddings = await generateEmbeddings(contents);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const id = uuidv4();
    const tag = doc.containerTag ?? "default";

    await query(
      `INSERT INTO documents (id, content, metadata, embedding, container_tag, status)
       VALUES ($1, $2, $3, $4, $5, 'processed')`,
      [
        id,
        doc.content,
        JSON.stringify(doc.metadata ?? {}),
        pgvector.toSql(embeddings[i]),
        tag,
      ]
    );

    results.push({ id, status: "processed" });
  }

  return c.json({ results });
});

// POST /v3/documents/list - List documents
documents.post("/list", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { containerTag, limit = 50, offset = 0 } = body as {
    containerTag?: string;
    limit?: number;
    offset?: number;
  };

  let sql = `SELECT id, content, metadata, container_tag, status, created_at, updated_at
             FROM documents`;
  const params: unknown[] = [];

  if (containerTag) {
    sql += ` WHERE container_tag = $1`;
    params.push(containerTag);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);

  // Get total count
  let countSql = "SELECT COUNT(*) as total FROM documents";
  const countParams: unknown[] = [];
  if (containerTag) {
    countSql += " WHERE container_tag = $1";
    countParams.push(containerTag);
  }
  const countResult = await query(countSql, countParams);

  return c.json({
    documents: result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      containerTag: row.container_tag,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total: parseInt(countResult.rows[0].total, 10),
  });
});

// GET /v3/documents/processing - List processing documents
documents.get("/processing", async (c) => {
  const result = await query(
    `SELECT id, content, status, created_at FROM documents WHERE status = 'processing' ORDER BY created_at DESC`
  );
  return c.json({ documents: result.rows });
});

// GET /v3/documents/:id - Get a document
documents.get("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await query(
    `SELECT id, content, metadata, container_tag, status, created_at, updated_at
     FROM documents WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return c.json({ error: "Document not found" }, 404);
  }

  const row = result.rows[0];
  return c.json({
    id: row.id,
    content: row.content,
    metadata: row.metadata,
    containerTag: row.container_tag,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// PATCH /v3/documents/:id - Update a document
documents.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { content, metadata } = body;

  const existing = await query("SELECT id FROM documents WHERE id = $1", [id]);
  if (existing.rows.length === 0) {
    return c.json({ error: "Document not found" }, 404);
  }

  if (content) {
    const embedding = await generateEmbedding(content);
    await query(
      `UPDATE documents SET content = $1, embedding = $2, updated_at = now() WHERE id = $3`,
      [content, pgvector.toSql(embedding), id]
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

// DELETE /v3/documents/:id - Delete a document
documents.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const result = await query("DELETE FROM documents WHERE id = $1 RETURNING id", [id]);

  if (result.rows.length === 0) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json({ id, status: "deleted" });
});

// DELETE /v3/documents/bulk - Bulk delete
documents.delete("/bulk", async (c) => {
  const body = await c.req.json();
  const { ids } = body;

  if (!Array.isArray(ids)) {
    return c.json({ error: "ids array is required" }, 400);
  }

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const result = await query(
    `DELETE FROM documents WHERE id IN (${placeholders}) RETURNING id`,
    ids
  );

  return c.json({
    deleted: result.rows.map((r) => r.id),
    count: result.rowCount,
  });
});

// POST /v3/documents/file - Upload file (simplified: extract text content)
documents.post("/file", async (c) => {
  // For now, accept a file upload and store its text content
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return c.json({ error: "file is required" }, 400);
  }

  const content = await file.text();
  const id = uuidv4();
  const embedding = await generateEmbedding(content);

  await query(
    `INSERT INTO documents (id, content, metadata, embedding, container_tag, status)
     VALUES ($1, $2, $3, $4, 'default', 'processed')`,
    [
      id,
      content,
      JSON.stringify({ filename: file.name, size: file.size, type: file.type }),
      pgvector.toSql(embedding),
    ]
  );

  return c.json({ id, status: "processed" });
});

export default documents;
