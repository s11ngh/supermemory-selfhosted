import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import documents from "./routes/documents.js";
import { search, searchV4 } from "./routes/search.js";
import settings from "./routes/settings.js";
import memories from "./routes/memories.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// Simple API key auth middleware
const API_KEY = process.env.SUPERMEMORY_API_KEY;

app.use("/v3/*", async (c, next) => {
  if (API_KEY) {
    const auth = c.req.header("Authorization");
    const key = auth?.replace("Bearer ", "");
    if (key !== API_KEY) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

app.use("/v4/*", async (c, next) => {
  if (API_KEY) {
    const auth = c.req.header("Authorization");
    const key = auth?.replace("Bearer ", "");
    if (key !== API_KEY) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));

// V3 routes (supermemory compatible)
app.route("/v3/documents", documents);
app.route("/v3/search", search);
app.route("/v3/settings", settings);

// V4 routes
app.route("/v4/search", searchV4);
app.route("/v4/memories", memories);

// POST /v4/profile - simplified profile endpoint
app.post("/v4/profile", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ status: "ok", ...body });
});

const port = parseInt(process.env.PORT ?? "8787", 10);

console.log(`Supermemory API starting on port ${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Supermemory API running at http://0.0.0.0:${info.port}`);
});
