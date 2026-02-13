# cachebro

File cache with diff tracking for AI coding agents. Powered by [Turso](https://turso.tech), a high-performance embedded database.

Agents waste most of their token budget re-reading files they've already seen. cachebro fixes this: on first read it caches the file, on subsequent reads it returns either "unchanged" (one line instead of the whole file) or a compact diff of what changed. Drop-in replacement for file reads that agents adopt on their own.

## Why this matters

We ran 3 related coding tasks sequentially on a 1,000-file TypeScript codebase ([opencode](https://github.com/sst/opencode)) using Claude Opus as the agent. Each task touched overlapping files in the same area of the codebase — the normal pattern when you're working on a feature across multiple sessions.

| Task | Tokens Used | Tokens Saved by Cache | Cumulative Savings |
|------|------------:|----------------------:|-------------------:|
| 1. Add session export command | 62,190 | 2,925 | 2,925 |
| 2. Add --since flag to session list | 41,167 | 15,571 | 18,496 |
| 3. Add session stats subcommand | 63,169 | 35,355 | 53,851 |

By task 3, cachebro saved **35,355 tokens in a single task** — files cached during tasks 1 and 2 were served as one-line confirmations instead of full content. Over the 3-task sequence, **53,851 tokens saved out of 166,526 consumed (~24%)**.

At scale, this compounds:
- A full day of coding (20+ related tasks): **300-400k tokens saved per developer per day**
- On Claude Opus ($15/M input tokens): **$4.50-$6.00/day per developer**
- Fleet of 10,000 developers: **$1M+/year in saved API costs**

### Agents adopt it without being told

We tested whether agents would use cachebro voluntarily. We launched a coding agent with cachebro configured as an MCP server but **gave the agent no instructions about it**. The agent chose `cachebro.read_files` as its very first action — preferring batched cached reads over built-in file read tools. The tool descriptions alone were enough.

## How it works

```
First read:   agent reads src/auth.ts → cachebro caches content + hash → returns full file
Second read:  agent reads src/auth.ts → hash unchanged → returns "[unchanged, 245 lines, 1,837 tokens saved]"
After edit:   agent reads src/auth.ts → hash changed → returns unified diff (only changed lines)
```

The cache persists in a local [Turso](https://turso.tech) (SQLite-compatible) database. Content hashing (SHA-256) detects changes. No network, no external services, no configuration beyond a file path.

## Installation

```bash
bun add cachebro-sdk              # SDK
bun add -g cachebro               # CLI
```

## Usage

### As an MCP server (recommended)

Add to your `.mcp.json` (for Claude Code, Cursor, or any MCP-compatible agent):

```json
{
  "mcpServers": {
    "cachebro": {
      "command": "bun",
      "args": ["run", "cachebro", "serve"]
    }
  }
}
```

The MCP server exposes 4 tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file with caching. Returns full content on first read, "unchanged" or diff on subsequent reads. |
| `read_files` | Batch read multiple files with caching. |
| `cache_status` | Show stats: files tracked, tokens saved. |
| `cache_clear` | Reset the cache. |

Agents discover these tools automatically and prefer them over raw file reads because the tool descriptions advertise token savings.

### As a CLI

```bash
cachebro serve      # Start the MCP server
cachebro status     # Show cache statistics
cachebro help       # Show help
```

Set `CACHEBRO_DIR` to control where the cache database is stored (default: `.cachebro/` in the current directory).

### As an SDK

```typescript
import { createCache } from "cachebro-sdk";

const { cache, watcher } = createCache({
  dbPath: "./my-cache.db",
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

// Stats
const stats = await cache.getStats();
// { filesTracked: 12, tokensSaved: 53851, ... }

// Cleanup
watcher.close();
```

The SDK has no opinions about embeddings, models, or AI providers. It's a cache. You read files through it, it tracks what changed.

## Architecture

```
packages/
  sdk/     cachebro-sdk — the library
           - CacheStore: content-addressed file cache backed by Turso (via @tursodatabase/database)
           - FileWatcher: fs.watch wrapper for change notification
           - computeDiff: line-based unified diff
  cli/     cachebro — batteries-included CLI + MCP server
```

**Database:** Single [Turso](https://turso.tech) database file with one table (`file_cache`) mapping absolute file paths to their content, SHA-256 hash, line count, and timestamps. A `stats` table tracks cumulative tokens saved.

**Change detection:** On every read, cachebro hashes the current file content and compares it to the cached hash. Same hash = unchanged. Different hash = compute diff, update cache. No polling, no watchers required for correctness — the hash is the source of truth.

**Token estimation:** `ceil(characters * 0.75)`. Rough but directionally correct for code. Good enough for the "tokens saved" metric.

## License

MIT
