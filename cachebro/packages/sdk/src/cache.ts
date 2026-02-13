import { connect } from "@tursodatabase/database";
import { computeDiff } from "./differ.js";
import type { CacheConfig, CacheStats, FileReadResult } from "./types.js";
import { createHash } from "crypto";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS file_versions (
  path        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  content     TEXT NOT NULL,
  lines       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (path, hash)
);

CREATE TABLE IF NOT EXISTS session_reads (
  session_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  read_at     INTEGER NOT NULL,
  PRIMARY KEY (session_id, path)
);

CREATE TABLE IF NOT EXISTS stats (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_stats (
  session_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, key)
);

INSERT OR IGNORE INTO stats (key, value) VALUES ('tokens_saved', 0);
`;

function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.75);
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class CacheStore {
  private db: Awaited<ReturnType<typeof connect>> | null = null;
  private dbPath: string;
  private sessionId: string;
  private initialized = false;

  constructor(config: CacheConfig) {
    this.dbPath = config.dbPath;
    this.sessionId = config.sessionId;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.db = await connect(this.dbPath);
    await this.db.exec(SCHEMA);
    this.initialized = true;
  }

  private getDb() {
    if (!this.db) throw new Error("CacheStore not initialized. Call init() first.");
    return this.db;
  }

  async readFile(filePath: string): Promise<FileReadResult> {
    await this.init();
    const db = this.getDb();
    const { readFileSync, statSync } = await import("fs");
    const { resolve } = await import("path");

    const absPath = resolve(filePath);
    statSync(absPath); // throws if file doesn't exist

    const currentContent = readFileSync(absPath, "utf-8");
    const currentHash = contentHash(currentContent);
    const currentLines = currentContent.split("\n").length;
    const now = Date.now();

    // What did THIS session last see for this file?
    const lastRead = await db.prepare(
      "SELECT hash FROM session_reads WHERE session_id = ? AND path = ?"
    ).all(this.sessionId, absPath);

    if (lastRead.length > 0) {
      const lastHash = (lastRead[0] as any).hash as string;

      if (lastHash === currentHash) {
        // Same content this session already saw — big win
        const tokensSaved = estimateTokens(currentContent);
        await this.addTokensSaved(tokensSaved);

        // Update read timestamp
        await db.prepare(
          "UPDATE session_reads SET read_at = ? WHERE session_id = ? AND path = ?"
        ).run(now, this.sessionId, absPath);

        return {
          cached: true,
          content: `[cachebro: unchanged, ${currentLines} lines, ${tokensSaved} tokens saved]`,
          hash: currentHash,
          totalLines: currentLines,
          linesChanged: 0,
        };
      }

      // File changed since this session last read it — find the old version to diff against
      const oldVersion = await db.prepare(
        "SELECT content FROM file_versions WHERE path = ? AND hash = ?"
      ).all(absPath, lastHash);

      // Store the new version
      await db.prepare(
        "INSERT OR IGNORE INTO file_versions (path, hash, content, lines, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(absPath, currentHash, currentContent, currentLines, now);

      // Update session read pointer to new version
      await db.prepare(
        "UPDATE session_reads SET hash = ?, read_at = ? WHERE session_id = ? AND path = ?"
      ).run(currentHash, now, this.sessionId, absPath);

      if (oldVersion.length > 0) {
        const oldContent = (oldVersion[0] as any).content as string;
        const diffResult = computeDiff(oldContent, currentContent, filePath);

        if (diffResult.hasChanges) {
          const fullTokens = estimateTokens(currentContent);
          const diffTokens = estimateTokens(diffResult.diff);
          const saved = Math.max(0, fullTokens - diffTokens);
          await this.addTokensSaved(saved);

          return {
            cached: true,
            content: diffResult.diff,
            diff: diffResult.diff,
            hash: currentHash,
            linesChanged: diffResult.linesChanged,
            totalLines: currentLines,
          };
        }
      }

      // Old version not found in cache (pruned?) — return full content
      return {
        cached: false,
        content: currentContent,
        hash: currentHash,
        totalLines: currentLines,
      };
    }

    // First read in this session — check if we already have this version stored
    await db.prepare(
      "INSERT OR IGNORE INTO file_versions (path, hash, content, lines, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(absPath, currentHash, currentContent, currentLines, now);

    // Record that this session has seen this version
    await db.prepare(
      "INSERT OR REPLACE INTO session_reads (session_id, path, hash, read_at) VALUES (?, ?, ?, ?)"
    ).run(this.sessionId, absPath, currentHash, now);

    return {
      cached: false,
      content: currentContent,
      hash: currentHash,
      totalLines: currentLines,
    };
  }

  async onFileChanged(_filePath: string): Promise<void> {
    // Hash check in readFile handles staleness detection.
  }

  async onFileDeleted(filePath: string): Promise<void> {
    await this.init();
    const db = this.getDb();
    const { resolve } = await import("path");
    const absPath = resolve(filePath);
    await db.prepare("DELETE FROM file_versions WHERE path = ?").run(absPath);
    await db.prepare("DELETE FROM session_reads WHERE path = ?").run(absPath);
  }

  async getStats(): Promise<CacheStats> {
    await this.init();
    const db = this.getDb();

    const versions = await db.prepare("SELECT COUNT(DISTINCT path) as c FROM file_versions").all();
    const tokens = await db.prepare("SELECT value FROM stats WHERE key = 'tokens_saved'").all();
    const sessionTokens = await db.prepare(
      "SELECT value FROM session_stats WHERE session_id = ? AND key = 'tokens_saved'"
    ).all(this.sessionId);

    const filesTracked = (versions[0] as any).c as number;

    return {
      filesTracked,
      tokensSaved: tokens.length > 0 ? (tokens[0] as any).value as number : 0,
      sessionTokensSaved: sessionTokens.length > 0 ? (sessionTokens[0] as any).value as number : 0,
    };
  }

  async clear(): Promise<void> {
    await this.init();
    const db = this.getDb();
    await db.exec("DELETE FROM file_versions; DELETE FROM session_reads; DELETE FROM session_stats; UPDATE stats SET value = 0;");
  }

  async close(): Promise<void> {
    // @tursodatabase/database doesn't expose close — connection is managed internally
  }

  private async addTokensSaved(tokens: number): Promise<void> {
    const db = this.getDb();
    await db.prepare(
      "UPDATE stats SET value = value + ? WHERE key = 'tokens_saved'"
    ).run(tokens);
    await db.prepare(
      "INSERT INTO session_stats (session_id, key, value) VALUES (?, 'tokens_saved', ?) ON CONFLICT(session_id, key) DO UPDATE SET value = value + ?"
    ).run(this.sessionId, tokens, tokens);
  }
}
