import { describe, expect, it } from "vitest";
import { calcTotalTokens, calcSegments, formatCost } from "../tokenStats";
import type { MessageTokens } from "../../types/message";

function tokens(
  input: number,
  output: number,
  reasoning: number,
  cache?: { read: number; write: number },
): MessageTokens {
  return { input, output, reasoning, cache };
}

describe("calcTotalTokens", () => {
  it("sums input + output + reasoning without cache", () => {
    expect(calcTotalTokens(tokens(100, 200, 50))).toBe(350);
  });

  it("sums all fields including cache read and write", () => {
    expect(calcTotalTokens(tokens(100, 200, 50, { read: 500, write: 30 }))).toBe(880);
  });

  it("handles partial cache (only read present via undefined write edge)", () => {
    // MessageTokens.cache is always { read, write } per type, but we test
    // the arithmetic: cache.read counted, cache.write = 0
    const t: MessageTokens = {
      input: 10,
      output: 20,
      reasoning: 5,
      cache: { read: 100, write: 0 },
    };
    expect(calcTotalTokens(t)).toBe(135);
  });

  it("handles cache write only", () => {
    const t: MessageTokens = { input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 40 } };
    expect(calcTotalTokens(t)).toBe(75);
  });

  it("returns 0 for all-zero tokens", () => {
    expect(calcTotalTokens(tokens(0, 0, 0))).toBe(0);
  });

  it("does NOT apply billing discount to cache.read", () => {
    // cache.read=1000 must contribute exactly 1000, not 100 (0.1x discount)
    const t: MessageTokens = {
      input: 100,
      output: 100,
      reasoning: 0,
      cache: { read: 1000, write: 0 },
    };
    expect(calcTotalTokens(t)).toBe(1200);
  });
});

describe("calcSegments", () => {
  it("segments input/output/reasoning without cache", () => {
    expect(calcSegments(tokens(100, 200, 50))).toEqual({
      input: 100,
      output: 200,
      reasoning: 50,
      cache: 0,
    });
  });

  it("merges cache read + write into single cache segment", () => {
    expect(calcSegments(tokens(100, 200, 50, { read: 500, write: 30 }))).toEqual({
      input: 100,
      output: 200,
      reasoning: 50,
      cache: 530,
    });
  });

  it("segment sum equals calcTotalTokens", () => {
    const t = tokens(100, 200, 50, { read: 500, write: 30 });
    const seg = calcSegments(t);
    expect(seg.input + seg.output + seg.reasoning + seg.cache).toBe(calcTotalTokens(t));
  });

  it("returns all-zero segments for zero tokens", () => {
    expect(calcSegments(tokens(0, 0, 0))).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: 0,
    });
  });
});

describe("formatCost", () => {
  it("formats a normal cost with $ prefix and 4 decimal places", () => {
    expect(formatCost(0.0123)).toBe("$0.0123");
  });

  it("formats a larger cost", () => {
    expect(formatCost(1.5)).toBe("$1.5000");
  });

  it("returns empty string for undefined", () => {
    expect(formatCost(undefined)).toBe("");
  });

  it("formats zero as $0.0000", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("formats very small values without precision loss", () => {
    expect(formatCost(0.00001)).toBe("$0.0000");
  });

  it("formats 0.00005 rounds to $0.0001", () => {
    expect(formatCost(0.00005)).toBe("$0.0001");
  });
});
