import { ref } from "vue";
import * as cliBridge from "../utils/cliBridge";

export interface TaskSpec {
  id: string;
  title: string;
  prompt: string;
  verification?: string;
}

export interface TaskStatus {
  taskId: string;
  title: string;
  status: "pending" | "running" | "done" | "failed";
  exitCode: number | null;
  output: string;
  sessionId?: string;
}

export function useTaskRunner() {
  const tasks = ref<TaskStatus[]>([]);
  const busy = ref(false);

  async function loadPendingTasks(specs: TaskSpec[]) {
    tasks.value = specs.map((s) => ({
      taskId: s.id,
      title: s.title,
      status: "pending" as const,
      exitCode: null,
      output: "",
    }));
  }

  async function runAll(directory: string, agent = "claude-code"): Promise<void> {
    busy.value = true;
    for (const t of tasks.value) {
      if (t.status !== "pending") continue;
      t.status = "running";
      try {
        const session = (await cliBridge.createSession({
          agent,
          directory,
        })) as { id: string };
        t.sessionId = session.id;

        const spec = specsMap.value.get(t.taskId);
        const prompt = spec?.prompt ?? t.title;

        await cliBridge.sendPromptAsync(session.id, {
          parts: [{ type: "text", text: prompt }],
          directory,
        });

        const result = await pollSession(session.id, 180_000);
        t.exitCode = result.exitCode;
        t.output = result.output;
        t.status = result.exitCode === 0 ? "done" : "failed";

        if (session.id) {
          cliBridge.deleteSession(session.id).catch(() => {});
        }
      } catch (err) {
        t.status = "failed";
        t.output = String(err);
        if (t.sessionId) cliBridge.deleteSession(t.sessionId).catch(() => {});
      }
    }
    busy.value = false;
  }

  async function runSingle(
    taskId: string,
    directory: string,
    agent = "claude-code",
  ): Promise<void> {
    const t = tasks.value.find((x) => x.taskId === taskId);
    if (!t || t.status !== "pending") return;
    t.status = "running";
    try {
      const session = (await cliBridge.createSession({
        agent,
        directory,
      })) as { id: string };
      t.sessionId = session.id;

      const spec = specsMap.value.get(taskId);
      const prompt = spec?.prompt ?? t.title;

      await cliBridge.sendPromptAsync(session.id, {
        parts: [{ type: "text", text: prompt }],
        directory,
      });

      const result = await pollSession(session.id, 180_000);
      t.exitCode = result.exitCode;
      t.output = result.output;
      t.status = result.exitCode === 0 ? "done" : "failed";

      if (session.id) cliBridge.deleteSession(session.id).catch(() => {});
    } catch (err) {
      t.status = "failed";
      t.output = String(err);
      if (t.sessionId) cliBridge.deleteSession(t.sessionId).catch(() => {});
    }
  }

  async function pollSession(
    sessionId: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number | null; output: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = (await cliBridge.getSession(sessionId)) as {
        status?: string;
      } | null;
      if (!s) return { exitCode: null, output: "session lost" };
      if (s.status === "idle" || s.status === "error") {
        const msgs = (await cliBridge.listSessionMessages(sessionId)) as Array<{
          role: string;
          content?: string;
        }> | null;
        const output =
          msgs
            ?.filter((m) => m.role === "assistant")
            .map((m) => m.content ?? "")
            .join("\n") ?? "";
        return {
          exitCode: s.status === "error" ? 1 : 0,
          output,
        };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { exitCode: null, output: "timeout" };
  }

  const specsMap = ref<Map<string, TaskSpec>>(new Map());

  function setSpecs(specs: TaskSpec[]) {
    specsMap.value = new Map(specs.map((s) => [s.id, s]));
  }

  function reset() {
    tasks.value = [];
    busy.value = false;
    specsMap.value = new Map();
  }

  return {
    tasks,
    busy,
    loadPendingTasks,
    setSpecs,
    runAll,
    runSingle,
    reset,
  };
}
