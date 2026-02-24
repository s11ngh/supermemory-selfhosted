import pg from "pg";
import pgvector from "pgvector/pg";

const { Pool } = pg;

let pool: pg.Pool;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://supermemory:supermemory@localhost:5432/supermemory",
    });

    pool.on("connect", async (client) => {
      try {
        await pgvector.registerTypes(client);
      } catch {
        // vector extension may not exist yet during migrations
      }
    });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
