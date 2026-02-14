import { watch, type FSWatcher } from "fs";
import { resolve } from "path";
import type { CacheStore } from "./cache.js";

export class FileWatcher {
  private watchers: FSWatcher[] = [];
  private cache: CacheStore;
  private debounceTimers = new Map<string, Timer>();
  private debounceMs: number;

  constructor(cache: CacheStore, debounceMs = 100) {
    this.cache = cache;
    this.debounceMs = debounceMs;
  }

  watch(paths: string[]): void {
    for (const p of paths) {
      const absPath = resolve(p);
      const watcher = watch(absPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const filePath = resolve(absPath, filename);

        // Skip hidden files, node_modules, .git
        if (filename.startsWith(".") || filename.includes("node_modules") || filename.includes(".git")) {
          return;
        }

        // Debounce rapid changes to the same file
        const existing = this.debounceTimers.get(filePath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          filePath,
          setTimeout(() => {
            this.debounceTimers.delete(filePath);
            this.handleChange(event, filePath);
          }, this.debounceMs),
        );
      });

      this.watchers.push(watcher);
    }
  }

  close(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private async handleChange(event: string, filePath: string): Promise<void> {
    try {
      const { existsSync } = await import("fs");
      if (existsSync(filePath)) {
        await this.cache.onFileChanged(filePath);
      } else {
        await this.cache.onFileDeleted(filePath);
      }
    } catch {
      // File may be in a transient state during writes
    }
  }
}
