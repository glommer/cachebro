#!/usr/bin/env bun
import { startMcpServer } from "./mcp.js";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

const command = process.argv[2];

if (!command || command === "serve") {
  await startMcpServer();
} else if (command === "status") {
  const { createCache } = await import("@turso/cachebro");
  const { resolve, join } = await import("path");
  const { existsSync } = await import("fs");

  const cacheDir = resolve(process.env.CACHEBRO_DIR ?? ".cachebro");
  const dbPath = join(cacheDir, "cache.db");

  if (!existsSync(dbPath)) {
    console.log("No cachebro database found. Run 'cachebro serve' to start caching.");
    process.exit(0);
  }

  const { cache } = createCache({ dbPath, sessionId: "cli-status" });
  await cache.init();
  const stats = await cache.getStats();

  console.log(`cachebro status:`);
  console.log(`  Files tracked:          ${stats.filesTracked}`);
  console.log(`  Tokens saved (total):   ~${stats.tokensSaved.toLocaleString()}`);

  await cache.close();
} else if (command === "init") {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  const home = homedir();

  // mcpServers format (Claude Code, Cursor, Windsurf)
  const mcpServersEntry = {
    command: "npx",
    args: ["cachebro", "serve"],
  };

  // opencode format (mcp key, command is a single array)
  const opencodeMcpEntry = {
    type: "local" as const,
    command: ["npx", "cachebro", "serve"],
  };

  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");

  const targets = [
    {
      name: "Claude Code",
      path: join(home, ".claude.json"),
      key: "mcpServers",
      entry: mcpServersEntry,
    },
    {
      name: "Cursor",
      path: join(home, ".cursor", "mcp.json"),
      key: "mcpServers",
      entry: mcpServersEntry,
    },
  ];

  let configured = 0;

  for (const target of targets) {
    // Only configure tools that are already installed (config dir exists)
    const dir = join(target.path, "..");
    if (!existsSync(dir)) continue;

    let config: any = {};
    if (existsSync(target.path)) {
      try {
        config = JSON.parse(readFileSync(target.path, "utf-8"));
      } catch {
        config = {};
      }
    }

    if (config[target.key]?.cachebro) {
      console.log(`  ${target.name}: already configured`);
      configured++;
      continue;
    }

    config[target.key] = config[target.key] ?? {};
    config[target.key].cachebro = target.entry;
    writeFileSync(target.path, JSON.stringify(config, null, 2) + "\n");
    console.log(`  ${target.name}: configured (${target.path})`);
    configured++;
  }

  // OpenCode: prefer opencode.jsonc over opencode.json
  // Use jsonc-parser modify()/applyEdits() to preserve
  // comments and formatting, mirroring OpenCode's addMcpToConfig().
  const opencodeDir = join(xdgConfig, "opencode");
  if (existsSync(opencodeDir)) {
    const candidates = [
      join(opencodeDir, "opencode.jsonc"),
      join(opencodeDir, "opencode.json"),
    ];
    const target = candidates.find(existsSync) ?? candidates[0];
    const raw = existsSync(target) ? readFileSync(target, "utf-8") : "{}";
    const text = raw.trim() ? raw : "{}";

    const errors: ParseError[] = [];
    const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length) {
      console.log(`OpenCode: config invalid, skipping (${target})`);
    } else if ((parsed as any)?.mcp?.cachebro) {
      console.log(`OpenCode: already configured (${target})`);
      configured++;
    } else {
      const edits = modify(text, ["mcp", "cachebro"], opencodeMcpEntry, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      });
      const updated = applyEdits(text, edits);
      writeFileSync(target, updated.endsWith("\n") ? updated : updated + "\n");
      console.log(`OpenCode: configured (${target})`);
      configured++;
    }
  }

  if (configured === 0) {
    console.log("No supported tools detected. You can manually add cachebro to your MCP config:");
    console.log(JSON.stringify({ mcpServers: { cachebro: mcpServersEntry } }, null, 2));
  } else {
    console.log(`\nDone! Restart your editor to pick up cachebro.`);
  }
} else if (command === "help" || command === "--help") {
  console.log(`cachebro - Agent file cache with diff tracking

Usage:
  cachebro init      Auto-configure cachebro for your editor
  cachebro serve     Start the MCP server (default)
  cachebro status    Show cache statistics
  cachebro help      Show this help message

Environment:
  CACHEBRO_DIR       Cache directory (default: .cachebro)`);
} else {
  console.error(`Unknown command: ${command}. Run 'cachebro help' for usage.`);
  process.exit(1);
}
