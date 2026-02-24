import { query, getPool } from "./db.js";

async function migrate() {
  console.log("Running migrations...");

  await query("CREATE EXTENSION IF NOT EXISTS vector");
  await query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  await query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      embedding vector(1536),
      container_tag TEXT DEFAULT 'default',
      status TEXT DEFAULT 'processed',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_embedding
    ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_container_tag
    ON documents (container_tag)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_documents_created_at
    ON documents (created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      data JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await query(`
    INSERT INTO settings (id, data) VALUES ('default', '{}')
    ON CONFLICT (id) DO NOTHING
  `);

  console.log("Migrations complete.");
  await getPool().end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
