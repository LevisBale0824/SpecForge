import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  parseUnifiedDiff,
  reconstructFromPatch,
  sideBySidePair,
} from "../parseDiff";

describe("parseUnifiedDiff", () => {
  it("returns empty rows for an empty patch", () => {
    const result = parseUnifiedDiff("");
    expect(result.rows).toEqual([]);
    expect(result.hasHunks).toBe(false);
  });

  it("parses a single hunk with added/removed/context lines", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " unchanged",
      "-old line",
      "+new line",
      "+extra line",
      " tail",
    ].join("\n");

    const result = parseUnifiedDiff(patch);

    expect(result.hasHunks).toBe(true);
    // hunk header + 5 content lines = 6 rows
    expect(result.rows).toHaveLength(6);

    const hunk = result.rows[0];
    expect(hunk.kind).toBe("hunk");
    if (hunk.kind === "hunk") {
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldLen).toBe(3);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newLen).toBe(4);
    }

    const unchanged = result.rows[1];
    expect(unchanged.kind).toBe("context");
    if (unchanged.kind === "context") {
      expect(unchanged.oldNo).toBe(1);
      expect(unchanged.newNo).toBe(1);
      expect(unchanged.text).toBe("unchanged");
    }

    const removed = result.rows[2];
    expect(removed.kind).toBe("removed");
    if (removed.kind === "removed") {
      expect(removed.oldNo).toBe(2);
      expect(removed.text).toBe("old line");
    }

    const added = result.rows[3];
    expect(added.kind).toBe("added");
    if (added.kind === "added") {
      expect(added.newNo).toBe(2);
      expect(added.text).toBe("new line");
    }
  });

  it("treats a bare @@ without lengths as length 1", () => {
    const patch = "@@ -5 +5 @@\n+hello";
    const result = parseUnifiedDiff(patch);
    const hunk = result.rows[0];
    if (hunk.kind === "hunk") {
      expect(hunk.oldLen).toBe(1);
      expect(hunk.newLen).toBe(1);
    }
  });

  it("ignores git metadata lines outside hunks", () => {
    const patch = [
      "diff --git a/foo b/foo",
      "index 1234567..abcdefg 100644",
      "--- a/foo",
      "+++ b/foo",
      "@@ -1,1 +1,1 @@",
      " hello",
    ].join("\n");
    const result = parseUnifiedDiff(patch);
    expect(result.rows.every((r) => r.kind !== "meta")).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it("emits blank lines inside hunks as context with incremented numbers", () => {
    const patch = "@@ -1,2 +1,2 @@\n line1\n\n line3";
    const result = parseUnifiedDiff(patch);
    const blank = result.rows[2];
    expect(blank.kind).toBe("context");
    if (blank.kind === "context") {
      expect(blank.text).toBe("");
      expect(blank.oldNo).toBe(2);
      expect(blank.newNo).toBe(2);
    }
  });
});

describe("reconstructFromPatch", () => {
  it("returns empty strings for a patch without hunks", () => {
    const { before, after } = reconstructFromPatch("nope");
    expect(before).toBe("");
    expect(after).toBe("");
  });

  it("reconstructs a partial before/after snapshot", () => {
    const patch = ["@@ -1,3 +1,3 @@", " ctx", "-removed", "+inserted"].join("\n");
    const { before, after } = reconstructFromPatch(patch);
    expect(before.split("\n")).toContain("ctx");
    expect(before.split("\n")).toContain("removed");
    expect(after.split("\n")).toContain("ctx");
    expect(after.split("\n")).toContain("inserted");
  });
});

describe("sideBySidePair", () => {
  it("pairs identical inputs as all equal", () => {
    const pairs = sideBySidePair("a\nb\nc", "a\nb\nc");
    expect(pairs.every((p) => p.kind === "equal")).toBe(true);
    expect(pairs).toHaveLength(3);
  });

  it("marks removed-only content as removed", () => {
    const pairs = sideBySidePair("a\nb", "a");
    expect(pairs.find((p) => p.kind === "removed")?.left?.text).toBe("b");
  });

  it("marks added-only content as added", () => {
    const pairs = sideBySidePair("a", "a\nb");
    expect(pairs.find((p) => p.kind === "added")?.right?.text).toBe("b");
  });

  it("falls back to naive append/remove for very large inputs", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line-${i}`).join("\n");
    const bigger = Array.from({ length: 500 }, (_, i) => `other-${i}`).join("\n");
    // 1000 * 500 = 500_000 > 200_000 cap
    const pairs = sideBySidePair(big, bigger);
    expect(pairs.length).toBe(1000 + 500);
    expect(pairs.filter((p) => p.kind === "removed")).toHaveLength(1000);
    expect(pairs.filter((p) => p.kind === "added")).toHaveLength(500);
  });
});

describe("diffSnapshots", () => {
  it("emits a context row for equal lines", () => {
    const rows = diffSnapshots("foo", "foo");
    expect(rows[0].kind).toBe("context");
  });

  it("emits added/removed rows for diverging lines", () => {
    const rows = diffSnapshots("x\ny", "x\nz");
    expect(rows.some((r) => r.kind === "removed")).toBe(true);
    expect(rows.some((r) => r.kind === "added")).toBe(true);
  });
});
