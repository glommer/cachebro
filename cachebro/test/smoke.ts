import { createCache } from "@turso/cachebro";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".tmp_test");
const DB_PATH = join(TEST_DIR, "test.db");
const FILE_PATH = join(TEST_DIR, "example.ts");

// Setup
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

writeFileSync(FILE_PATH, `function hello() {\n  console.log("hello world");\n}\n`);

const { cache, watcher } = createCache({
  dbPath: DB_PATH,
  sessionId: "test-session-1",
});

await cache.init();

// Test 1: First read returns full content
console.log("--- Test 1: First read (should be full content) ---");
const r1 = await cache.readFile(FILE_PATH);
console.log(`  cached: ${r1.cached}`);
console.log(`  lines: ${r1.totalLines}`);
console.log(`  content preview: ${r1.content.slice(0, 60)}...`);
console.assert(!r1.cached, "First read should not be cached");

// Test 2: Second read, no changes — should be cached
console.log("\n--- Test 2: Second read, no changes (should be cached) ---");
const r2 = await cache.readFile(FILE_PATH);
console.log(`  cached: ${r2.cached}`);
console.log(`  linesChanged: ${r2.linesChanged}`);
console.log(`  content: ${r2.content}`);
console.assert(r2.cached, "Second read should be cached");
console.assert(r2.linesChanged === 0, "No lines should have changed");

// Test 3: Modify file, read again — should return diff
console.log("\n--- Test 3: Modified file (should return diff) ---");
writeFileSync(FILE_PATH, `function hello() {\n  console.log("hello cachebro!");\n  return true;\n}\n`);
const r3 = await cache.readFile(FILE_PATH);
console.log(`  cached: ${r3.cached}`);
console.log(`  linesChanged: ${r3.linesChanged}`);
console.log(`  diff:\n${r3.diff}`);
console.assert(r3.cached, "Should be cached (returning diff)");
console.assert(r3.linesChanged! > 0, "Should have changed lines");

// Test 4: Stats
console.log("\n--- Test 4: Stats ---");
const stats = await cache.getStats();
console.log(`  Files tracked: ${stats.filesTracked}`);
console.log(`  Tokens saved (session): ~${stats.sessionTokensSaved}`);
console.log(`  Tokens saved (total): ~${stats.tokensSaved}`);
console.assert(stats.filesTracked === 1, "Should track 1 file");
console.assert(stats.sessionTokensSaved > 0, "Should have saved tokens in session");
console.assert(stats.tokensSaved > 0, "Should have saved tokens total");

// Test 5: Multi-session isolation
console.log("\n--- Test 5: Multi-session isolation ---");
// Session 2 has never read the file — should get full content even though session 1 cached it
const { cache: cache2 } = createCache({
  dbPath: DB_PATH,
  sessionId: "test-session-2",
});
await cache2.init();
const r5 = await cache2.readFile(FILE_PATH);
console.log(`  cached: ${r5.cached}`);
console.log(`  content preview: ${r5.content.slice(0, 60)}...`);
console.assert(!r5.cached, "Session 2 first read should NOT be cached");

// Session 2 reads again — now it should be cached for session 2
const r5b = await cache2.readFile(FILE_PATH);
console.log(`  second read cached: ${r5b.cached}`);
console.assert(r5b.cached, "Session 2 second read should be cached");
console.assert(r5b.linesChanged === 0, "No lines should have changed for session 2");

await cache2.close();

// Cleanup
watcher.close();
await cache.close();
rmSync(TEST_DIR, { recursive: true, force: true });

console.log("\nAll tests passed!");
