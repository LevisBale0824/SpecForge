import { describe, expect, it } from "vitest";
import type { SessionInfo, ToolState } from "../../../types/sse";
import { extractSubSessionId, isSubAgentTool, matchChildSession } from "../utils";

function completed(metadata: Record<string, unknown> = {}, output = ""): ToolState {
  return {
    status: "completed",
    input: {},
    output,
    title: "t",
    metadata,
    time: { start: 1, end: 2 },
  };
}

function running(metadata: Record<string, unknown> = {}): ToolState {
  return { status: "running", input: {}, metadata, time: { start: 1 } };
}

function pending(): ToolState {
  return { status: "pending", input: {}, raw: "" };
}

function session(id: string, parentID?: string, created = 0): SessionInfo {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/d",
    parentID,
    title: id,
    version: "1",
    time: { created, updated: created },
  };
}

describe("isSubAgentTool", () => {
  it("recognizes task and batch", () => {
    expect(isSubAgentTool("task")).toBe(true);
    expect(isSubAgentTool("batch")).toBe(true);
  });

  it("rejects other tools", () => {
    expect(isSubAgentTool("read")).toBe(false);
    expect(isSubAgentTool("bash")).toBe(false);
  });
});

describe("extractSubSessionId", () => {
  it("returns undefined for non-subagent tools", () => {
    expect(extractSubSessionId("read", completed({ sessionId: "ses_1" }))).toBeUndefined();
  });

  it("reads metadata.sessionId (primary path, not inferred)", () => {
    expect(extractSubSessionId("task", completed({ sessionId: "ses_abc" }))).toEqual({
      sessionId: "ses_abc",
      inferred: false,
    });
  });

  it("falls back to alternative metadata keys", () => {
    expect(extractSubSessionId("task", completed({ session_id: "ses_k2" }))).toEqual({
      sessionId: "ses_k2",
      inferred: false,
    });
    expect(extractSubSessionId("task", completed({ subSessionID: "ses_k3" }))).toEqual({
      sessionId: "ses_k3",
      inferred: false,
    });
    expect(extractSubSessionId("task", completed({ sub_session_id: "ses_k4" }))).toEqual({
      sessionId: "ses_k4",
      inferred: false,
    });
  });

  it("prefers sessionId over alternative keys", () => {
    expect(
      extractSubSessionId("task", completed({ sessionId: "first", session_id: "second" })),
    ).toEqual({ sessionId: "first", inferred: false });
  });

  it("extracts from output text via task_id regex (inferred)", () => {
    const out = "task_id: ses_xyz (for resuming)\n<task_result>ok</task_result>";
    expect(extractSubSessionId("task", completed({}, out))).toEqual({
      sessionId: "ses_xyz",
      inferred: true,
    });
  });

  it("works while running via metadata", () => {
    expect(extractSubSessionId("task", running({ sessionId: "ses_run" }))).toEqual({
      sessionId: "ses_run",
      inferred: false,
    });
  });

  it("returns undefined when no metadata and no output match", () => {
    expect(extractSubSessionId("task", completed({}, "no id here"))).toBeUndefined();
    expect(extractSubSessionId("task", completed({ interrupted: true }))).toBeUndefined();
  });

  it("returns undefined for pending state", () => {
    expect(extractSubSessionId("task", pending())).toBeUndefined();
  });

  it("ignores non-string metadata values", () => {
    expect(extractSubSessionId("task", completed({ sessionId: 123 }))).toBeUndefined();
    expect(extractSubSessionId("task", completed({ sessionId: "  " }))).toBeUndefined();
  });
});

describe("matchChildSession", () => {
  const kids = [
    session("ses_a", "parent", 100),
    session("ses_b", "parent", 200),
    session("ses_c", "other", 150),
  ];

  it("returns undefined without a parent id", () => {
    expect(matchChildSession(undefined, kids)).toBeUndefined();
  });

  it("filters candidates by parentID", () => {
    const r = matchChildSession("parent", kids);
    expect(r?.sessionId).toMatch(/^ses_[ab]$/);
    expect(r?.inferred).toBe(true);
  });

  it("picks the child whose created time is closest to toolTime", () => {
    expect(matchChildSession("parent", kids, { toolTimeMs: 210 * 1000 })?.sessionId).toBe("ses_b");
    expect(matchChildSession("parent", kids, { toolTimeMs: 90 * 1000 })?.sessionId).toBe("ses_a");
  });

  it("excludes already-claimed session ids", () => {
    expect(
      matchChildSession("parent", kids, { toolTimeMs: 210 * 1000, exclude: new Set(["ses_b"]) })
        ?.sessionId,
    ).toBe("ses_a");
  });

  it("returns undefined when all matching children are excluded", () => {
    expect(
      matchChildSession("parent", kids, {
        exclude: new Set(["ses_a", "ses_b"]),
      }),
    ).toBeUndefined();
  });

  it("returns undefined when no children match the parent", () => {
    expect(matchChildSession("missing", kids)).toBeUndefined();
    expect(matchChildSession("parent", [])).toBeUndefined();
  });

  it("defaults to the most recently created when toolTime omitted", () => {
    expect(matchChildSession("parent", kids)?.sessionId).toBe("ses_b");
  });
});
