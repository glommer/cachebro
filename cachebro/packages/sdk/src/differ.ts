/**
 * Minimal unified diff implementation.
 * Computes a line-based diff between two strings and returns a compact representation.
 */

export interface DiffResult {
  /** Unified diff string */
  diff: string;
  /** Number of lines changed (added + removed) */
  linesChanged: number;
  /** Whether there are any changes */
  hasChanges: boolean;
}

export function computeDiff(oldContent: string, newContent: string, filePath: string): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // LCS-based diff
  const lcs = longestCommonSubsequence(oldLines, newLines);

  const hunks: string[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;
  let linesChanged = 0;

  // Collect raw diff lines
  const rawLines: Array<{ type: "keep" | "add" | "remove"; line: string; oldLine: number; newLine: number }> = [];

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx] &&
        newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
      rawLines.push({ type: "keep", line: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      oldIdx++;
      newIdx++;
      lcsIdx++;
    } else if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
      rawLines.push({ type: "add", line: newLines[newIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      newIdx++;
      linesChanged++;
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      rawLines.push({ type: "remove", line: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      oldIdx++;
      linesChanged++;
    }
  }

  if (linesChanged === 0) {
    return { diff: "", linesChanged: 0, hasChanges: false };
  }

  // Group into hunks with 3 lines of context
  const CONTEXT = 3;
  const hunkGroups: typeof rawLines[] = [];
  let currentHunk: typeof rawLines = [];
  let lastChangeIdx = -999;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.type !== "keep") {
      // If this change is far from the last, start a new hunk
      if (i - lastChangeIdx > CONTEXT * 2 + 1 && currentHunk.length > 0) {
        hunkGroups.push(currentHunk);
        currentHunk = [];
        // Add leading context
        for (let c = Math.max(0, i - CONTEXT); c < i; c++) {
          currentHunk.push(rawLines[c]);
        }
      } else if (currentHunk.length === 0) {
        // First hunk, add leading context
        for (let c = Math.max(0, i - CONTEXT); c < i; c++) {
          currentHunk.push(rawLines[c]);
        }
      }
      // Add all lines between last change context end and this change
      const contextEnd = lastChangeIdx + CONTEXT + 1;
      for (let c = Math.max(contextEnd, currentHunk.length > 0 ? i : 0); c < i; c++) {
        if (!currentHunk.includes(rawLines[c])) {
          currentHunk.push(rawLines[c]);
        }
      }
      currentHunk.push(line);
      lastChangeIdx = i;
    } else if (i - lastChangeIdx <= CONTEXT && currentHunk.length > 0) {
      currentHunk.push(line);
    }
  }
  if (currentHunk.length > 0) {
    hunkGroups.push(currentHunk);
  }

  // Format hunks
  for (const hunk of hunkGroups) {
    if (hunk.length === 0) continue;
    const firstLine = hunk[0];
    const lastLine = hunk[hunk.length - 1];
    hunks.push(`@@ -${firstLine.oldLine},${lastLine.oldLine - firstLine.oldLine + 1} +${firstLine.newLine},${lastLine.newLine - firstLine.newLine + 1} @@`);
    for (const line of hunk) {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      hunks.push(`${prefix}${line.line}`);
    }
  }

  const header = `--- a/${filePath}\n+++ b/${filePath}`;
  return {
    diff: `${header}\n${hunks.join("\n")}`,
    linesChanged,
    hasChanges: true,
  };
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Optimize for large files: use Map-based approach for sparse LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the LCS
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
