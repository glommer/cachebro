export interface CacheConfig {
  /** Path to the database file */
  dbPath: string;
  /** Session identifier. Each session tracks its own read state independently. */
  sessionId: string;
  /** Directories to watch for file changes. Defaults to cwd. */
  watchPaths?: string[];
}

export interface FileReadResult {
  /** Whether this was served from cache */
  cached: boolean;
  /** The file content (full on first read, diff on subsequent) */
  content: string;
  /** If cached and changed, the unified diff */
  diff?: string;
  /** Lines changed since last read */
  linesChanged?: number;
  /** Total lines in the file */
  totalLines?: number;
  /** Content hash */
  hash: string;
}

export interface CacheStats {
  /** Total files cached */
  filesTracked: number;
  /** Approximate tokens saved across all sessions */
  tokensSaved: number;
  /** Approximate tokens saved in this session */
  sessionTokensSaved: number;
}
