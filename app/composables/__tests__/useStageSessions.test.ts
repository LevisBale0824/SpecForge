import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStageSessions } from "../useStageSessions";
import { useSessions } from "../useSessions";
import type { SessionInfo } from "../../types/sse";

const KEY = "specforge.workflow.stageSessions";

function sessionInfo(id: string, updated = 0): SessionInfo {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/tmp",
    title: id,
    version: "",
    time: { created: 0, updated },
  };
}

beforeEach(() => {
  localStorage.clear();
  useStageSessions().reset();
  useSessions().reset();
});

afterEach(() => {
  localStorage.clear();
  useStageSessions().reset();
  useSessions().reset();
});

describe("useStageSessions registry", () => {
  it("registers and reads a stage→session binding", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", "sess-a");
    expect(s.stageSessionId("change-1", "explore")).toBe("sess-a");
    expect(s.stageSessionId("change-1", "propose")).toBeUndefined();
  });

  it("exposes every bound id via stageSessionIds", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", "sess-a");
    s.registerStageSession("change-1", "propose", "sess-b");
    s.registerStageSession("__draft__", "explore", "sess-c");
    expect([...s.stageSessionIds.value].sort()).toEqual(["sess-a", "sess-b", "sess-c"]);
  });

  it("lists all sessions for a single workflow key", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", "sess-a");
    s.registerStageSession("change-1", "apply", "sess-b");
    expect(s.sessionsForWorkflow("change-1").sort()).toEqual(["sess-a", "sess-b"]);
    expect(s.sessionsForWorkflow("change-2")).toEqual([]);
  });

  it("clearStageSessions removes a key's bindings and updates stageSessionIds", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", "sess-a");
    s.registerStageSession("__draft__", "explore", "sess-c");
    s.clearStageSessions("change-1");
    expect(s.stageSessionId("change-1", "explore")).toBeUndefined();
    expect([...s.stageSessionIds.value]).toEqual(["sess-c"]);
  });

  it("migrateWorkflowKey moves draft bindings to the real changeId", () => {
    const s = useStageSessions();
    s.registerStageSession("__draft__", "explore", "sess-a");
    s.registerStageSession("__draft__", "propose", "sess-b");
    s.migrateWorkflowKey("__draft__", "change-42");
    expect(s.stageSessionId("__draft__", "explore")).toBeUndefined();
    expect(s.stageSessionId("change-42", "explore")).toBe("sess-a");
    expect(s.stageSessionId("change-42", "propose")).toBe("sess-b");
  });

  it("persists bindings to localStorage", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", "sess-a");
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    expect(raw["change-1"]?.explore).toBe("sess-a");
  });

  it("ignores empty sessionId on register", () => {
    const s = useStageSessions();
    s.registerStageSession("change-1", "explore", undefined);
    s.registerStageSession("change-1", "explore", "");
    expect(s.stageSessionId("change-1", "explore")).toBeUndefined();
  });
});

describe("useSessions sidebar filtering", () => {
  it("hides stage-bound sessions from sortedSessions (absolute filter)", () => {
    const stages = useStageSessions();
    const sessions = useSessions();

    sessions.upsert(sessionInfo("normal-1", 10));
    sessions.upsert(sessionInfo("stage-1", 20));
    sessions.upsert(sessionInfo("stage-2", 30));
    stages.registerStageSession("change-1", "explore", "stage-1");
    stages.registerStageSession("change-1", "propose", "stage-2");

    const ids = sessions.sortedSessions.value.map((s) => s.id);
    expect(ids).toEqual(["normal-1"]);
  });

  it("a session reappears after its workflow key is cleared", () => {
    const stages = useStageSessions();
    const sessions = useSessions();
    sessions.upsert(sessionInfo("stage-1", 20));
    stages.registerStageSession("change-1", "explore", "stage-1");

    expect(sessions.sortedSessions.value.map((s) => s.id)).toEqual([]);

    stages.clearStageSessions("change-1");
    expect(sessions.sortedSessions.value.map((s) => s.id)).toEqual(["stage-1"]);
  });

  it("draft sessions (__draft__ key) are also filtered", () => {
    const stages = useStageSessions();
    const sessions = useSessions();
    sessions.upsert(sessionInfo("draft-sess", 5));
    sessions.upsert(sessionInfo("normal", 1));
    stages.registerStageSession("__draft__", "explore", "draft-sess");

    const ids = sessions.sortedSessions.value.map((s) => s.id);
    expect(ids).toEqual(["normal"]);
  });
});
