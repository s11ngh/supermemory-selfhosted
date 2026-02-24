// Supermemory memory plugin for OpenClaw (Clawdbot)
// Provides persistent memory via a self-hosted supermemory-compatible API.

interface PluginConfig {
  apiUrl: string;
  apiKey?: string;
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  minScore: number;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;
  containerTag?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Helper: thin fetch wrapper for the supermemory API
// ---------------------------------------------------------------------------

async function supermemoryFetch(
  cfg: PluginConfig,
  path: string,
  opts: RequestInit = {},
): Promise<any> {
  const url = `${cfg.apiUrl.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`supermemory ${opts.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Auto-capture heuristic
// ---------------------------------------------------------------------------

const CAPTURE_PATTERNS = [
  /\bI (?:prefer|like|use|want|need|always|never|hate)\b/i,
  /\bI (?:work|worked|am working) (?:at|on|for|with)\b/i,
  /\bI(?:'m| am) (?:a |an )?(?:\w+ )*(?:developer|engineer|designer|manager|student)\b/i,
  /\bI decided\b/i,
  /\bmy [\w\s]+ (?:is|are)\b/i,
  /\bremember (?:that|this)\b/i,
  /\bdon'?t forget\b/i,
  /\bour (?:stack|tech|project|team|company|org)\b/i,
  /\bwe (?:use|chose|picked|switched to|migrated to)\b/i,
];

function shouldCapture(text: string): boolean {
  return CAPTURE_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Format recalled memories for injection
// ---------------------------------------------------------------------------

function formatMemories(results: SearchResult[]): string {
  const lines = results.map(
    (r) => `- ${r.content}`,
  );
  return [
    "<relevant-memories>",
    "The following are background memories that MAY be relevant. Only reference them if they are directly related to what the user is asking. Do not lead with or summarize these memories — focus on answering the user's actual question first.",
    "",
    ...lines,
    "</relevant-memories>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plugin default export
// ---------------------------------------------------------------------------

export default {
  id: "memory-supermemory",
  kind: "memory" as const,

  register(api: any) {
    const cfg: PluginConfig = {
      apiUrl: api.pluginConfig.apiUrl ?? "http://localhost:8787",
      apiKey: api.pluginConfig.apiKey,
      autoRecall: api.pluginConfig.autoRecall ?? true,
      autoCapture: api.pluginConfig.autoCapture ?? true,
      recallLimit: api.pluginConfig.recallLimit ?? 3,
      minScore: api.pluginConfig.minScore ?? 0.55,
    };

    // -----------------------------------------------------------------------
    // Hook: before_agent_start — auto-recall
    // -----------------------------------------------------------------------

    api.on("before_agent_start", async (event: any) => {
      if (!cfg.autoRecall) return;

      const userMsg = event.messages
        ?.slice()
        .reverse()
        .find((m: any) => m.role === "user");
      if (!userMsg) return;

      const query =
        typeof userMsg.content === "string"
          ? userMsg.content
          : Array.isArray(userMsg.content)
            ? userMsg.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join(" ")
            : "";
      if (!query.trim()) return;

      try {
        const data = await supermemoryFetch(cfg, "/v3/search", {
          method: "POST",
          body: JSON.stringify({ q: query, limit: cfg.recallLimit, threshold: cfg.minScore }),
        });

        const hits: SearchResult[] = data.results ?? [];

        if (hits.length > 0) {
          event.messages.push({
            role: "system",
            content: formatMemories(hits),
          });
        }
      } catch (err: any) {
        api.log?.warn?.(`memory-supermemory recall failed: ${err.message}`);
      }
    });

    // -----------------------------------------------------------------------
    // Hook: agent_end — auto-capture
    // -----------------------------------------------------------------------

    api.on("agent_end", async (event: any) => {
      if (!cfg.autoCapture) return;

      const userMsg = event.messages
        ?.slice()
        .reverse()
        .find((m: any) => m.role === "user");
      if (!userMsg) return;

      const text =
        typeof userMsg.content === "string"
          ? userMsg.content
          : Array.isArray(userMsg.content)
            ? userMsg.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join(" ")
            : "";

      if (!shouldCapture(text)) return;

      try {
        await supermemoryFetch(cfg, "/v3/documents", {
          method: "POST",
          body: JSON.stringify({ content: text }),
        });
        api.log?.debug?.(`memory-supermemory captured fact`);
      } catch (err: any) {
        api.log?.warn?.(`memory-supermemory capture failed: ${err.message}`);
      }
    });

    // -----------------------------------------------------------------------
    // Tool: memory_recall
    // -----------------------------------------------------------------------

    api.registerTool({
      name: "memory_recall",
      description:
        "Search your persistent memory for relevant information. Returns the most similar past memories.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          limit: {
            type: "number",
            description: "Max results to return (default 5)",
          },
        },
        required: ["query"],
      },
      async run({ query, limit }: { query: string; limit?: number }) {
        const data = await supermemoryFetch(cfg, "/v3/search", {
          method: "POST",
          body: JSON.stringify({ q: query, limit: limit ?? cfg.recallLimit, threshold: cfg.minScore }),
        });

        const hits: SearchResult[] = data.results ?? [];

        if (hits.length === 0) return "No relevant memories found.";

        return hits
          .map(
            (r) =>
              `[${r.score.toFixed(3)}] ${r.content} (id: ${r.id})`,
          )
          .join("\n");
      },
    });

    // -----------------------------------------------------------------------
    // Tool: memory_store
    // -----------------------------------------------------------------------

    api.registerTool({
      name: "memory_store",
      description: "Store a new fact or piece of information in persistent memory.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The fact or information to remember",
          },
        },
        required: ["content"],
      },
      async run({ content }: { content: string }) {
        const data = await supermemoryFetch(cfg, "/v3/documents", {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        return `Stored (id: ${data.id}).`;
      },
    });

    // -----------------------------------------------------------------------
    // CLI commands under "supermemory"
    // -----------------------------------------------------------------------

    api.registerCli("supermemory", {
      description: "Interact with the supermemory API directly",
      subcommands: {
        health: {
          description: "Check if the supermemory API is reachable",
          async run() {
            const data = await supermemoryFetch(cfg, "/health");
            return JSON.stringify(data, null, 2);
          },
        },
        search: {
          description: "Search memories",
          args: [{ name: "query", required: true }],
          async run({ query }: { query: string }) {
            const data = await supermemoryFetch(cfg, "/v3/search", {
              method: "POST",
              body: JSON.stringify({ q: query, limit: cfg.recallLimit }),
            });
            return JSON.stringify(data, null, 2);
          },
        },
        add: {
          description: "Add a document to memory",
          args: [{ name: "content", required: true }],
          async run({ content }: { content: string }) {
            const data = await supermemoryFetch(cfg, "/v3/documents", {
              method: "POST",
              body: JSON.stringify({ content }),
            });
            return JSON.stringify(data, null, 2);
          },
        },
      },
    });
  },
};
