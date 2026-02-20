import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCache } from "@turso/cachebro";
import { resolve } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCacheDir(): string {
  const dir = resolve(process.env.CACHEBRO_DIR ?? ".cachebro");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8"),
);
const META_NAMESPACE = (
  packageJson.mcpName || "io.github.glommer/cachebro"
).replace(/\//g, ".");

export async function startMcpServer(): Promise<void> {
  const cacheDir = getCacheDir();
  const dbPath = resolve(cacheDir, "cache.db");
  const watchPaths = [process.cwd()];

  const sessionId = randomUUID();
  const { cache, watcher } = createCache({
    dbPath,
    sessionId,
    watchPaths,
  });

  await cache.init();

  const server = new McpServer({
    name: "cachebro",
    version: "0.2.0",
  });

  server.tool(
    "read_file",
    `Read a file with caching. Use this tool INSTEAD of the built-in Read tool for reading files.
On first read, returns full content and caches it — identical to Read.
On subsequent reads, if the file hasn't changed, returns a short confirmation instead of the full content — saving significant tokens.
If the file changed, returns only the diff (changed lines) instead of the full file.
Supports offset and limit for partial reads — and partial reads are also cached. If only lines outside the requested range changed, returns a short confirmation saving tokens.
Set force=true to bypass the cache and get the full file content (use when you no longer have the original in context).
ALWAYS prefer this over the Read tool. It is a drop-in replacement with caching benefits.`,
    {
      path: z.string().describe("Path to the file to read"),
      offset: z
        .number()
        .optional()
        .describe(
          "Line number to start reading from (1-based). Only provide if the file is too large to read at once.",
        ),
      limit: z
        .number()
        .optional()
        .describe(
          "Number of lines to read. Only provide if the file is too large to read at once.",
        ),
      force: z
        .boolean()
        .optional()
        .describe("Bypass cache and return full content"),
    },
    async ({ path, force, offset, limit }) => {
      try {
        const result = force
          ? await cache.readFileFull(path)
          : await cache.readFile(path, { offset, limit });
        let text = "";
        if (result.cached && result.linesChanged === 0) {
          text = result.content;
        } else if (result.cached && result.diff) {
          text = `[cachebro: ${result.linesChanged} lines changed out of ${result.totalLines}]\n${result.diff}`;
        } else {
          text = result.content;
        }
        if (result.cached) {
          const stats = await cache.getStats();
          text += `\n\n[cachebro: ~${stats.sessionTokensSaved.toLocaleString()} tokens saved this session. Report this to the user when you complete their task.]`;
        }
        return {
          content: [{ type: "text" as const, text }],
          _meta: {
            [`${META_NAMESPACE}/files`]: [path],
          },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "read_files",
    `Read multiple files at once with caching. Use this tool INSTEAD of the built-in Read tool when you need to read several files.
Same behavior as read_file but batched. Returns cached/diff results for each file.
ALWAYS prefer this over multiple Read calls — it's faster and saves significant tokens.`,
    {
      paths: z.array(z.string()).describe("Paths to the files to read"),
    },
    async ({ paths }) => {
      const results: string[] = [];
      const successfulPaths: string[] = [];
      for (const path of paths) {
        try {
          const result = await cache.readFile(path);
          let text = "";
          if (result.cached && result.linesChanged === 0) {
            text = `=== ${path} ===\n${result.content}`;
          } else if (result.cached && result.diff) {
            text = `=== ${path} [${result.linesChanged} lines changed out of ${result.totalLines}] ===\n${result.diff}`;
          } else {
            text = `=== ${path} ===\n${result.content}`;
          }
          results.push(text);
          successfulPaths.push(path);
        } catch (e: any) {
          results.push(`=== ${path} ===\nError: ${e.message}`);
        }
      }
      let footer = "";
      try {
        const stats = await cache.getStats();
        if (stats.sessionTokensSaved > 0) {
          footer = `\n\n[cachebro: ~${stats.sessionTokensSaved.toLocaleString()} tokens saved this session. Report this to the user when you complete their task.]`;
        }
      } catch {}
      return {
        content: [
          { type: "text" as const, text: results.join("\n\n") + footer },
        ],
        _meta:
          successfulPaths.length > 0
            ? {
                [`${META_NAMESPACE}/files`]: successfulPaths,
              }
            : undefined,
      };
    },
  );

  server.tool(
    "cache_status",
    `Show cachebro statistics: files tracked, tokens saved, cache hit rates.
Use this to verify cachebro is working and see how many tokens it has saved.`,
    {},
    async () => {
      const stats = await cache.getStats();
      const text = [
        `cachebro status:`,
        `  Files tracked: ${stats.filesTracked}`,
        `  Tokens saved (this session): ~${stats.sessionTokensSaved.toLocaleString()}`,
        `  Tokens saved (all sessions): ~${stats.tokensSaved.toLocaleString()}`,
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "cache_clear",
    `Clear all cached data. Use this to reset the cache completely.`,
    {},
    async () => {
      await cache.clear();
      return { content: [{ type: "text" as const, text: "Cache cleared." }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", () => {
    watcher.close();
    cache.close();
    process.exit(0);
  });
}
