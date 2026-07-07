import { describe, expect, it } from "vitest";
import { computeHiddenStageSessions, encodeStageSuffix } from "../stageTitleEncoding";
import type { SessionInfo } from "../../types/sse";

function session(id: string, title = id, parentID?: string): SessionInfo {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/tmp",
    title,
    version: "",
    time: { created: 0, updated: 0 },
    ...(parentID ? { parentID } : {}),
  };
}

describe("computeHiddenStageSessions", () => {
  it("hides registry-only stage session ids before the session list catches up", () => {
    const hidden = computeHiddenStageSessions([], new Set(["stage-pending"]));

    expect(hidden.has("stage-pending")).toBe(true);
  });

  it("hides title-bound stage sessions and their descendants", () => {
    const stageTitle = encodeStageSuffix("Apply work", {
      stage: "apply",
      workflowKey: "change-1",
    });
    const hidden = computeHiddenStageSessions([
      session("stage-1", stageTitle),
      session("child-1", "child", "stage-1"),
      session("normal-1"),
    ]);

    expect([...hidden].sort()).toEqual(["child-1", "stage-1"]);
  });
});
