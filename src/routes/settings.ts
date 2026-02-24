import { Hono } from "hono";
import { query } from "../db.js";

const settings = new Hono();

// GET /v3/settings
settings.get("/", async (c) => {
  const result = await query("SELECT data FROM settings WHERE id = 'default'");
  return c.json(result.rows[0]?.data ?? {});
});

// PATCH /v3/settings
settings.patch("/", async (c) => {
  const body = await c.req.json();

  await query(
    `UPDATE settings SET data = data || $1::jsonb, updated_at = now() WHERE id = 'default'`,
    [JSON.stringify(body)]
  );

  const result = await query("SELECT data FROM settings WHERE id = 'default'");
  return c.json(result.rows[0]?.data ?? {});
});

export default settings;
