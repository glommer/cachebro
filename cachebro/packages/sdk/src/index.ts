export { CacheStore } from "./cache.js";
export { FileWatcher } from "./watcher.js";
export { computeDiff } from "./differ.js";
export type { CacheConfig, CacheStats, FileReadResult } from "./types.js";

import { CacheStore } from "./cache.js";
import { FileWatcher } from "./watcher.js";
import type { CacheConfig } from "./types.js";

/**
 * Create a cachebro instance with file watching enabled.
 */
export function createCache(config: CacheConfig): { cache: CacheStore; watcher: FileWatcher } {
  const cache = new CacheStore(config);
  const watcher = new FileWatcher(cache);

  if (config.watchPaths && config.watchPaths.length > 0) {
    watcher.watch(config.watchPaths);
  }

  return { cache, watcher };
}
