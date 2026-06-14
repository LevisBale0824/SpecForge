// ---------------------------------------------------------------------------
// Patch text parser — unified diff → structured rows + side-by-side pairing
// ---------------------------------------------------------------------------
// Lightweight synchronous parser for git-style unified diffs. Avoids the worker
// round-trip so the diff view renders instantly. Also reconstructs before /
// after snapshots from a patch when actual snapshots aren't provided.
// ---------------------------------------------------------------------------

export type DiffRow =
  | {
      kind: "hunk";
      oldStart: number;
      oldLen: number;
      newStart: number;
      newLen: number;
      text: string;
    }
  | { kind: "context"; oldNo: number; newNo: number; text: string }
  | { kind: "added"; newNo: number; text: string }
  | { kind: "removed"; oldNo: number; text: string }
  | { kind: "meta"; text: string };

export type ParsedDiff = {
  rows: DiffRow[];
  /** True when the patch text contained at least one parseable hunk. */
  hasHunks: boolean;
};

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function parseUnifiedDiff(patch: string): ParsedDiff {
  const rows: DiffRow[] = [];
  let hasHunks = false;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  const lines = patch.split(/\r?\n/);

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = HUNK_RE.exec(line);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[3]);
        rows.push({
          kind: "hunk",
          oldStart: oldNo,
          oldLen: match[2] ? Number(match[2]) : 1,
          newStart: newNo,
          newLen: match[4] ? Number(match[4]) : 1,
          text: line,
        });
        inHunk = true;
        hasHunks = true;
      }
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch") ||
      line.startsWith("\\")
    ) {
      inHunk = false;
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++")) {
      if (inHunk) rows.push({ kind: "meta", text: line });
      else inHunk = false;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+")) {
      rows.push({ kind: "added", newNo, text: line.slice(1) });
      newNo += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "removed", oldNo, text: line.slice(1) });
      oldNo += 1;
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "context", oldNo, newNo, text: line.slice(1) });
      oldNo += 1;
      newNo += 1;
    } else if (line === "") {
      rows.push({ kind: "context", oldNo, newNo, text: "" });
      oldNo += 1;
      newNo += 1;
    }
  }

  return { rows, hasHunks };
}

// ── Reconstruct before/after from a unified patch ──────────────────────────
//
// Replays the hunks against an empty base to derive the old and new file
// contents. Unchanged context lines are emitted to both sides; +/- lines only
// to their respective side. Lines outside any hunk are not represented (the
// patch only carries changed regions plus a few context lines), so the result
// is a *partial* reconstruction suitable for visual comparison.

export function reconstructFromPatch(patch: string): {
  before: string;
  after: string;
} {
  const beforeLines: Array<[number, string]> = [];
  const afterLines: Array<[number, string]> = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      const match = HUNK_RE.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[3]);
      }
      inHunk = true;
      continue;
    }

    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch") ||
      line.startsWith("\\")
    ) {
      inHunk = false;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      afterLines.push([newLine, line.slice(1)]);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      beforeLines.push([oldLine, line.slice(1)]);
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      const text = line.slice(1);
      beforeLines.push([oldLine, text]);
      afterLines.push([newLine, text]);
      oldLine += 1;
      newLine += 1;
    }
  }

  const buildPadded = (entries: Array<[number, string]>) => {
    if (entries.length === 0) return "";
    const maxLine = entries.reduce((m, [n]) => Math.max(m, n), 0);
    const arr = Array.from<string>({ length: maxLine }).fill("");
    for (const [n, text] of entries) arr[n - 1] = text;
    return arr.join("\n");
  };

  return { before: buildPadded(beforeLines), after: buildPadded(afterLines) };
}

// ── Side-by-side pairing via LCS ──────────────────────────────────────────

export type SidePair = {
  left?: { no: number; text: string };
  right?: { no: number; text: string };
  kind: "equal" | "added" | "removed";
};

export function sideBySidePair(before: string, after: string): SidePair[] {
  const b = before.split("\n");
  const a = after.split("\n");
  const m = b.length;
  const n = a.length;

  // Cap memory for very large inputs — fall back to naive append/remove.
  if (m * n > 200_000) {
    const pairs: SidePair[] = [];
    let oldNo = 1;
    let newNo = 1;
    for (const text of b) {
      pairs.push({ left: { no: oldNo++, text }, kind: "removed" });
    }
    for (const text of a) {
      pairs.push({ right: { no: newNo++, text }, kind: "added" });
    }
    return pairs;
  }

  // LCS DP — dp[i][j] = longest common suffix length from (i,j) to (m,n)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (b[i] === a[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const pairs: SidePair[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < m && j < n) {
    if (b[i] === a[j]) {
      pairs.push({
        left: { no: oldNo++, text: b[i] },
        right: { no: newNo++, text: a[j] },
        kind: "equal",
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pairs.push({ left: { no: oldNo++, text: b[i] }, kind: "removed" });
      i++;
    } else {
      pairs.push({ right: { no: newNo++, text: a[j] }, kind: "added" });
      j++;
    }
  }
  while (i < m) {
    pairs.push({ left: { no: oldNo++, text: b[i++] }, kind: "removed" });
  }
  while (j < n) {
    pairs.push({ right: { no: newNo++, text: a[j++] }, kind: "added" });
  }
  return pairs;
}

/**
 * Fallback unified line-by-line comparison (kept for callers that prefer the
 * single-column layout). Returns DiffRow[] suitable for the unified renderer.
 */
export function diffSnapshots(before: string, after: string): DiffRow[] {
  const pairs = sideBySidePair(before, after);
  const rows: DiffRow[] = [];
  for (const p of pairs) {
    if (p.kind === "equal" && p.left && p.right) {
      rows.push({ kind: "context", oldNo: p.left.no, newNo: p.right.no, text: p.left.text });
    } else if (p.kind === "removed" && p.left) {
      rows.push({ kind: "removed", oldNo: p.left.no, text: p.left.text });
    } else if (p.kind === "added" && p.right) {
      rows.push({ kind: "added", newNo: p.right.no, text: p.right.text });
    }
  }
  return rows;
}
