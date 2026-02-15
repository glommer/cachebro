<p align="center">
  <img src="logo.svg" alt="cachebro" width="200" />
</p>

# cachebro

File cache with diff tracking for AI coding agents. Powered by [Turso](https://turso.tech), a high-performance embedded database.

Agents waste most of their token budget re-reading files they've already seen. cachebro fixes this: on first read it caches the file, on subsequent reads it returns either "unchanged" (one line instead of the whole file) or a compact diff of what changed. Drop-in replacement for file reads that agents adopt on their own.

## Benchmark

We ran a controlled A/B test: the same refactoring task on a 268-file TypeScript codebase ([opencode](https://github.com/sst/opencode)), same agent (Claude Opus), same prompt. The only difference: cachebro enabled vs disabled.

| | Without cachebro | With cachebro |
|---|---:|---:|
| Total tokens | 158,248 | 117,188 |
| Tool calls | 60 | 58 |
| Files touched | 12 | 12 |

**26% fewer tokens. Same task, same result.** cachebro saved ~33,000 tokens by serving cached reads and compact diffs instead of full file contents.

The savings compound over sequential tasks on the same codebase:

| Task | Tokens Used | Tokens Saved by Cache | Cumulative Savings |
|------|------------:|----------------------:|-------------------:|
| 1. Add session export command | 62,190 | 2,925 | 2,925 |
| 2. Add --since flag to session list | 41,167 | 15,571 | 18,496 |
| 3. Add session stats subcommand | 63,169 | 35,355 | 53,851 |

By task 3, cachebro saved **35,355 tokens in a single task** — a 36% reduction. Over the 3-task sequence, **53,851 tokens saved out of 166,526 consumed (~24%)**.

### Agents adopt it without being told

We tested whether agents would use cachebro voluntarily. We launched a coding agent with cachebro configured as an MCP server but **gave the agent no instructions about it**. The agent chose `cachebro.read_file` over the built-in Read tool on its own. The tool descriptions alone were enough.

## How it works

```
First read:   agent reads src/auth.ts → cachebro caches content + hash → returns full file
Second read:  agent reads src/auth.ts → hash unchanged → returns "[unchanged, 245 lines, 1,837 tokens saved]"
After edit:   agent reads src/auth.ts → hash changed → returns unified diff (only changed lines)
Partial read: agent reads lines 50-60 → edit changed line 200 → returns "[unchanged in lines 50-60]"
```

The cache persists in a local [Turso](https://turso.tech) (SQLite-compatible) database. Content hashing (SHA-256) detects changes. No network, no external services, no configuration beyond a file path.

## Installation

```bash
npx cachebro init     # auto-configures Claude Code, Cursor, OpenCode
```

That's it. Restart your editor and cachebro is active. Agents discover it automatically.

Or configure manually — add to your MCP config (`.claude.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "cachebro": {
      "command": "npx",
      "args": ["cachebro", "serve"]
    }
  }
}
```

## Usage

### As an MCP server (recommended)

The MCP server exposes 4 tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file with caching. Returns full content on first read, "unchanged" or diff on subsequent reads. Supports `offset`/`limit` for partial reads. |
| `read_files` | Batch read multiple files with caching. |
| `cache_status` | Show stats: files tracked, tokens saved. |
| `cache_clear` | Reset the cache. |

Agents discover these tools automatically and prefer them over built-in file reads because the tool descriptions advertise token savings.

### As a CLI

```bash
cachebro serve      # Start the MCP server
cachebro status     # Show cache statistics
cachebro help       # Show help
```

Set `CACHEBRO_DIR` to control where the cache database is stored (default: `.cachebro/` in the current directory).

### As an SDK

```typescript
import { createCache } from "cachebro";

const { cache, watcher } = createCache({
  dbPath: "./my-cache.db",
  sessionId: "my-session-1",  // each session tracks reads independently
  watchPaths: ["."],          // optional: watch for file changes
});

await cache.init();

// First read — returns full content, caches it
const r1 = await cache.readFile("src/auth.ts");
// r1.cached === false
// r1.content === "import { jwt } from ..."

// Second read — file unchanged, returns confirmation
const r2 = await cache.readFile("src/auth.ts");
// r2.cached === true
// r2.content === "[cachebro: unchanged, 245 lines, 1837 tokens saved]"
// r2.linesChanged === 0

// After file is modified — returns diff
const r3 = await cache.readFile("src/auth.ts");
// r3.cached === true
// r3.diff === "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -10,3 +10,4 @@..."
// r3.linesChanged === 3

// Partial read — only the lines you need
const r4 = await cache.readFile("src/auth.ts", { offset: 50, limit: 10 });
// Returns lines 50-59, or "[unchanged in lines 50-59]" if nothing changed there

// Stats
const stats = await cache.getStats();
// { filesTracked: 12, tokensSaved: 53851, sessionTokensSaved: 33205 }

// Cleanup
watcher.close();
```

## Architecture

```
packages/
  sdk/     cachebro — the core library
           - CacheStore: content-addressed file cache backed by an embedded database
           - FileWatcher: fs.watch wrapper for change notification
           - computeDiff: line-based unified diff
  cli/     cachebro — batteries-included CLI + MCP server
```

**Database:** Single [Turso](https://turso.tech) database file with `file_versions` (content-addressed, keyed by path + hash), `session_reads` (per-session read pointers), and `stats`/`session_stats` tables. Multiple sessions and branch switches are handled correctly — each session tracks which version it last saw.

**Change detection:** On every read, cachebro hashes the current file content and compares it to the cached hash. Same hash = unchanged. Different hash = compute diff, update cache. No polling, no watchers required for correctness — the hash is the source of truth.

**Token estimation:** `ceil(characters * 0.75)`. Rough but directionally correct for code. Good enough for the "tokens saved" metric.

## License

MIT
