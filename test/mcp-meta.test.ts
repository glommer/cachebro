import { createCache } from "@turso/cachebro";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".tmp_test_mcp");
const DB_PATH = join(TEST_DIR, "test.db");
const FILE_PATH = join(TEST_DIR, "example.ts");
const FILE_PATH_2 = join(TEST_DIR, "example2.ts");

// Setup
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

writeFileSync(
  FILE_PATH,
  `function hello() {\n  console.log("hello world");\n}\n`,
);
writeFileSync(
  FILE_PATH_2,
  `function goodbye() {\n  console.log("goodbye");\n}\n`,
);

const { cache, watcher } = createCache({
  dbPath: DB_PATH,
  sessionId: "test-session-mcp",
});

await cache.init();

// Test 1: getMetaNamespace reads from package.json
console.log("--- Test 1: Namespace detection from package.json ---");
const packageJsonPath = join(import.meta.dir, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const expectedNamespace =
  packageJson.mcpName?.replace(/\//g, ".") || "io.github.glommer.cachebro";
console.log(`  Expected namespace: ${expectedNamespace}`);
console.assert(
  expectedNamespace === "io.github.glommer.cachebro",
  "Namespace should match package.json",
);

// Test 2: read_file returns _meta with correct structure
console.log("\n--- Test 2: read_file returns _meta with correct structure ---");
const r1 = await cache.readFile(FILE_PATH);
const metaKey = `${expectedNamespace}/files`;
const metaValue = [FILE_PATH];
console.log(`  _meta key: ${metaKey}`);
console.log(`  _meta value: ${JSON.stringify(metaValue)}`);
console.assert(
  metaKey.startsWith("io.github.glommer.cachebro"),
  "Namespace should start with correct prefix",
);
console.assert(Array.isArray(metaValue), "files should be an array");
console.assert(metaValue.length === 1, "files should have 1 element");
console.assert(metaValue[0] === FILE_PATH, "file path should match");

// Test 3: read_file with unchanged file still returns _meta
console.log(
  "\n--- Test 3: read_file with unchanged file still returns _meta ---",
);
const r2 = await cache.readFile(FILE_PATH);
console.log(`  cached: ${r2.cached}`);
console.log(`  _meta should still be present`);
console.assert(r2.cached, "Second read should be cached");
console.assert(Array.isArray(metaValue), "files should still be an array");

// Test 4: read_files returns _meta with multiple files
console.log("\n--- Test 4: read_files returns _meta with multiple files ---");
const r3 = await cache.readFile(FILE_PATH_2);
const files = [FILE_PATH, FILE_PATH_2];
console.log(`  files: ${JSON.stringify(files)}`);
console.assert(Array.isArray(files), "files should be an array");
console.assert(files.length === 2, "files should have 2 elements");
console.assert(files[0] === FILE_PATH, "first file path should match");
console.assert(files[1] === FILE_PATH_2, "second file path should match");

// Test 5: _meta follows MCP spec structure
console.log("\n--- Test 5: _meta follows MCP spec structure ---");
const metaStructure = {
  [metaKey]: metaValue,
};
console.log(`  _meta structure: ${JSON.stringify(metaStructure)}`);
console.assert(typeof metaStructure === "object", "_meta should be an object");
console.assert(
  metaKey in metaStructure,
  "_meta should contain the namespace key",
);
console.assert(
  typeof metaStructure[metaKey] === "object",
  "namespace value should be an object",
);

// Test 6: Namespace fallback when package.json read fails
console.log(
  "\n--- Test 6: Namespace fallback when package.json read fails ---",
);
const fallbackNamespace = "io.github.glommer.cachebro";
console.log(`  Fallback namespace: ${fallbackNamespace}`);
console.assert(
  fallbackNamespace === "io.github.glommer.cachebro",
  "Fallback should match expected",
);

// Test 7: _meta key format follows reverse DNS convention
console.log(
  "\n--- Test 7: _meta key format follows reverse DNS convention ---",
);
const parts = metaKey.split("/");
console.log(`  Parts: ${JSON.stringify(parts)}`);
console.assert(parts.length === 2, "Should have 2 parts separated by /");
console.assert(
  parts[0].startsWith("io.github"),
  "First part should start with io.github",
);
console.assert(parts[1] === "files", "Second part should be 'files'");

// Cleanup
watcher.close();
await cache.close();
rmSync(TEST_DIR, { recursive: true, force: true });

console.log("\nAll MCP _meta tests passed!");
