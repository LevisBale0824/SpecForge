// ---------------------------------------------------------------------------
// useOpenSpec — OpenSpec 工作流面板的状态与操作
// ---------------------------------------------------------------------------
// 数据来源:
//   - Electron 模式 → IPC readOpenSpecState / writeOpenSpecTasks / runOpenSpecValidate
//   - 浏览器模式 → File System Access API,从 useProject().state.rootHandle 取 openspec/
//
// 触发刷新的时机:
//   - watch project.state.directoryPath(immediate)
//   - file.edited SSE 事件(由 useBackend 注入)
//   - 手动 refresh()
//
// 注意:浏览器模式的 FSA 写入需要 readwrite 权限。我们尝试 queryPermission,
// 如果不是 'granted' 就直接降级为只读 + error 提示。
// ---------------------------------------------------------------------------

import { reactive, watch } from "vue";
import {
  initOpenSpec,
  isElectron,
  readChangeArtifact,
  readOpenSpecState,
  removeChangeDir,
  runOpenSpecValidate,
  runProjectGate,
  writeChangeArtifact,
  writeOpenSpecTasks,
} from "../utils/electronBridge";
import { useProject } from "./useProject";
import {
  applyTaskToggle,
  countTaskStats,
  parseDeltaSpec,
  parseProposal,
  parseSpec,
  parseTasks,
  updateTaskStatuses,
} from "../utils/openspecParser";
import type {
  EvidenceFile,
  GateLayer,
  GateResult,
  GateVerdict,
  OpenSpecChange,
  OpenSpecReadStateResult,
  OpenSpecState,
  OpenSpecValidationResult,
} from "../types/openspec";

const state = reactive<OpenSpecState>({
  rootPath: "",
  initialized: false,
  capabilities: [],
  activeChanges: [],
  archivedChanges: [],
  loading: false,
  error: "",
  lastRefreshedAt: 0,
  cliAvailable: false,
  cliVersion: undefined,
  validation: {},
  evidence: {},
});

let refreshTimer: number | undefined;

function scheduleRefresh(delay = 600): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refresh();
  }, delay);
}

async function refreshViaElectron(rootPath: string): Promise<void> {
  const data = await readOpenSpecState(rootPath);
  if (!data) {
    state.initialized = false;
    state.capabilities = [];
    state.activeChanges = [];
    state.archivedChanges = [];
    state.cliAvailable = false;
    state.cliVersion = undefined;
    return;
  }
  applyReadState(data);
}

function applyReadState(data: OpenSpecReadStateResult): void {
  state.rootPath = data.rootPath;
  state.initialized = data.initialized;
  state.capabilities = data.capabilities;
  state.activeChanges = data.activeChanges;
  state.archivedChanges = data.archivedChanges;
  state.cliAvailable = data.cliAvailable;
  state.cliVersion = data.cliVersion;
  state.lastRefreshedAt = Date.now();
}

// ── 浏览器模式:File System Access API ────────────────────────────────────

async function getOpenSpecDirHandle(
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle("openspec");
  } catch {
    return null;
  }
}

async function readTextViaHandle(
  dir: FileSystemDirectoryHandle,
  relPath: string,
): Promise<string | null> {
  const parts = relPath.split("/").filter(Boolean);
  let current: FileSystemDirectoryHandle = dir;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      current = await current.getDirectoryHandle(parts[i]);
    } catch {
      return null;
    }
  }
  const fileName = parts[parts.length - 1];
  try {
    const fileHandle = await current.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    if (file.size > 1024 * 1024) return null;
    return await file.text();
  } catch {
    return null;
  }
}

async function listDirEntries(
  dir: FileSystemDirectoryHandle,
): Promise<{ name: string; isDir: boolean }[]> {
  const out: { name: string; isDir: boolean }[] = [];
  for await (const [name, handle] of dir.entries()) {
    out.push({ name, isDir: handle.kind === "directory" });
  }
  return out;
}

async function refreshViaFsa(root: FileSystemDirectoryHandle): Promise<void> {
  const openspecDir = await getOpenSpecDirHandle(root);
  if (!openspecDir) {
    state.initialized = false;
    state.capabilities = [];
    state.activeChanges = [];
    state.archivedChanges = [];
    return;
  }

  // capabilities
  const capabilities: OpenSpecState["capabilities"] = [];
  try {
    const specsDir = await openspecDir.getDirectoryHandle("specs");
    for (const entry of await listDirEntries(specsDir)) {
      if (!entry.isDir) continue;
      const specPath = `specs/${entry.name}/spec.md`;
      const md = await readTextViaHandle(await specsDir.getDirectoryHandle(entry.name), "spec.md");
      const cap: OpenSpecState["capabilities"][number] = {
        name: entry.name,
        specPath,
        hasSpec: md !== null,
      };
      if (md) {
        const parsed = parseSpec(md, entry.name, "spec");
        cap.purpose = parsed.purpose;
        cap.requirements = parsed.requirements;
      }
      capabilities.push(cap);
    }
  } catch {
    // no specs/
  }

  // changes
  const activeChanges: OpenSpecChange[] = [];
  const archivedChanges: OpenSpecChange[] = [];
  try {
    const changesDir = await openspecDir.getDirectoryHandle("changes");
    for (const entry of await listDirEntries(changesDir)) {
      if (!entry.isDir) continue;
      if (entry.name === "archive") {
        const archiveDir = await changesDir.getDirectoryHandle("archive");
        for (const sub of await listDirEntries(archiveDir)) {
          if (!sub.isDir) continue;
          const change = await readChangeViaFsa(root.name, archiveDir, sub.name, true);
          if (change) archivedChanges.push(change);
        }
      } else {
        const change = await readChangeViaFsa(root.name, changesDir, entry.name, false);
        if (change) activeChanges.push(change);
      }
    }
  } catch {
    // no changes/
  }

  state.rootPath = root.name;
  state.initialized = true;
  state.capabilities = capabilities;
  state.activeChanges = activeChanges;
  state.archivedChanges = archivedChanges;
  state.cliAvailable = false;
  state.cliVersion = undefined;
  state.lastRefreshedAt = Date.now();
}

async function readChangeViaFsa(
  rootName: string,
  parentDir: FileSystemDirectoryHandle,
  dirName: string,
  archived: boolean,
): Promise<OpenSpecChange | null> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await parentDir.getDirectoryHandle(dirName);
  } catch {
    return null;
  }

  let id = dirName;
  let archivedAt: string | undefined;
  if (archived) {
    const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(dirName);
    if (m) {
      archivedAt = m[1];
      id = m[2];
    }
  }

  const proposalMd = await readTextViaHandle(dir, "proposal.md");
  const tasksMd = await readTextViaHandle(dir, "tasks.md");
  const brainstormMd = await readTextViaHandle(dir, "brainstorm.md");
  let hasDesign = false;
  try {
    await dir.getFileHandle("design.md");
    hasDesign = true;
  } catch {
    hasDesign = false;
  }

  const proposal = proposalMd ? parseProposal(proposalMd) : undefined;
  const parsedTasks = tasksMd ? parseTasks(tasksMd) : null;

  // delta specs
  const deltaSpecs: OpenSpecChange["deltaSpecs"] = [];
  try {
    const deltaRoot = await dir.getDirectoryHandle("specs");
    for (const entry of await listDirEntries(deltaRoot)) {
      if (!entry.isDir) continue;
      const md = await readTextViaHandle(deltaRoot, `${entry.name}/spec.md`);
      if (!md) continue;
      deltaSpecs.push(
        parseDeltaSpec(md, entry.name, `changes/${dirName}/specs/${entry.name}/spec.md`),
      );
    }
  } catch {
    // no delta specs
  }

  const dirPath = archived ? `changes/archive/${dirName}` : `changes/${dirName}`;

  return {
    id,
    dirPath,
    archived,
    archivedAt,
    proposal,
    brainstorm: brainstormMd ?? undefined,
    tasks: parsedTasks ? parsedTasks.groups.flatMap((g) => g.tasks) : [],
    taskStats: parsedTasks
      ? parsedTasks.stats
      : { total: 0, completed: 0, pending: 0, progress: 0 },
    deltaSpecs,
    hasDesign,
    taskPath: `${dirPath}/tasks.md`,
    proposalPath: `${dirPath}/proposal.md`,
  };
  // Note: rootName used implicitly via rootHandle; referenced to silence lint.
  void rootName;
}

// ── 主入口 ────────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  const project = useProject();
  const dirPath = project.state.directoryPath;
  if (!dirPath && !project.state.rootHandle) {
    state.initialized = false;
    state.capabilities = [];
    state.activeChanges = [];
    state.archivedChanges = [];
    return;
  }
  state.loading = true;
  state.error = "";
  try {
    if (isElectron()) {
      await refreshViaElectron(project.state.directoryPath);
    } else if (project.state.rootHandle) {
      await refreshViaFsa(project.state.rootHandle);
    }
  } catch (e) {
    state.error = String(e);
  } finally {
    state.loading = false;
  }
  await loadEvidence();
}

async function loadEvidence(): Promise<void> {
  if (!isElectron()) return;
  const project = useProject();
  const root = state.rootPath || project.state.directoryPath;
  if (!root) return;
  for (const change of state.activeChanges) {
    try {
      const raw = await readChangeArtifact(root, change.id, "evidence.json");
      if (raw) state.evidence[change.id] = JSON.parse(raw) as EvidenceFile;
    } catch {
      // evidence.json 缺失或损坏 — 跳过，保留内存中已有值
    }
  }
}

async function toggleTask(changeId: string, taskId: string, completed: boolean): Promise<void> {
  const change = state.activeChanges.find((c) => c.id === changeId);
  if (!change) return;

  const project = useProject();

  if (isElectron()) {
    // main 进程自己读 + 改 + 写,保证不破坏 evidence 子字段
    const result = await writeOpenSpecTasks(
      state.rootPath || project.state.directoryPath,
      changeId,
      taskId,
      completed,
    );
    if (!result?.ok) {
      state.error = result?.reason || "切换 task 状态失败";
      await refresh();
      return;
    }
    state.error = "";
  } else if (project.state.rootHandle) {
    await toggleTaskViaFsa(project.state.rootHandle, changeId, taskId, completed);
  }

  // 乐观更新内存
  change.tasks = updateTaskStatuses(change.tasks, taskId, completed);
  change.taskStats = countTaskStats(change.tasks);
}

async function toggleTaskViaFsa(
  root: FileSystemDirectoryHandle,
  changeId: string,
  taskId: string,
  completed: boolean,
): Promise<void> {
  const openspecDir = await getOpenSpecDirHandle(root);
  if (!openspecDir) return;
  const changesDir = await openspecDir.getDirectoryHandle("changes");
  let changeDir: FileSystemDirectoryHandle;
  try {
    changeDir = await changesDir.getDirectoryHandle(changeId);
  } catch {
    return;
  }
  const fileHandle = await changeDir.getFileHandle("tasks.md");
  // 申请读写权限(FSA 默认只读)
  const perm = await (
    fileHandle as unknown as {
      queryPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
      requestPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
    }
  ).queryPermission?.({ mode: "readwrite" });
  if (perm !== "granted") {
    const req = await (
      fileHandle as unknown as {
        requestPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
      }
    ).requestPermission?.({ mode: "readwrite" });
    if (req !== "granted") {
      state.error = "需要文件读写权限才能切换 task 状态";
      return;
    }
  }
  const file = await fileHandle.getFile();
  const text = await file.text();
  const newRaw = applyTaskToggle(text.split(/\r?\n/), taskId, completed);
  const writable = await fileHandle.createWritable();
  await writable.write(newRaw.join("\n"));
  await writable.close();
  state.error = "";
}

async function runValidate(changeId?: string): Promise<void> {
  if (isElectron()) {
    const result = await runOpenSpecValidate(state.rootPath, changeId);
    if (result) {
      state.validation[changeId ?? "_global"] = result;
    }
    return;
  }
  // 浏览器模式:CLI 不可用
  const placeholder: OpenSpecValidationResult = {
    changeId,
    passed: false,
    cliAvailable: false,
    issues: [],
    rawOutput: "",
    ranAt: Date.now(),
  };
  state.validation[changeId ?? "_global"] = placeholder;
}

const DEFAULT_GATES: { layer: GateLayer; command: string }[] = [
  { layer: "lint", command: "npm run lint" },
  { layer: "test", command: "npm test" },
  { layer: "build", command: "npm run build" },
];

async function runGates(changeId?: string): Promise<EvidenceFile | null> {
  const project = useProject();
  const root = state.rootPath || project.state.directoryPath;
  if (!root) return null;

  const key = changeId ?? "_global";
  const gates: GateResult[] = [];

  await runValidate(changeId);
  const v = state.validation[key];
  gates.push({
    layer: "spec",
    command: `openspec validate${changeId ? ` ${changeId}` : ""} --strict`,
    exitCode: v?.cliAvailable ? (v.passed ? 0 : 1) : null,
    passed: v?.passed ?? false,
    durationMs: 0,
    outputSnippet: v?.rawOutput?.slice(0, 500),
  });

  if (isElectron()) {
    for (const g of DEFAULT_GATES) {
      const r = await runProjectGate(root, g.command);
      gates.push({
        layer: g.layer,
        command: g.command,
        exitCode: r?.exitCode ?? null,
        passed: r?.exitCode === 0,
        durationMs: r?.durationMs ?? 0,
        outputSnippet: (r?.stderr || r?.stdout || "").slice(0, 500),
      });
    }
  }

  const anyFailed = gates.some((g) => g.exitCode !== null && !g.passed);
  const allPassed = gates.every((g) => g.passed);
  const verdict: GateVerdict = allPassed ? "READY" : anyFailed ? "NOT_READY" : "CONDITIONAL";

  const evidence: EvidenceFile = {
    changeId: key,
    verdict,
    gates,
    ranAt: Date.now(),
  };
  state.evidence[key] = evidence;

  if (isElectron() && changeId) {
    await writeChangeArtifact(root, changeId, "evidence.json", JSON.stringify(evidence, null, 2));
  }
  return evidence;
}

async function archiveChange(changeId: string): Promise<{ ok: boolean; reason?: string }> {
  const ev = state.evidence[changeId];
  if (ev && ev.verdict === "NOT_READY") {
    return {
      ok: false,
      reason: `verify 未通过（${ev.verdict}）— evidence gate 确定性阻止归档`,
    };
  }
  if (isElectron()) {
    const project = useProject();
    const root = state.rootPath || project.state.directoryPath;
    const r = await runProjectGate(root, `openspec archive ${changeId}`);
    if (r?.exitCode !== 0) {
      return { ok: false, reason: r?.stderr?.slice(0, 300) || "openspec archive 失败" };
    }
  }
  await refresh();
  return { ok: true };
}

async function captureKnowledge(
  changeId: string,
  summary: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isElectron()) return { ok: false, reason: "仅 Electron 模式支持" };
  const project = useProject();
  const root = state.rootPath || project.state.directoryPath;
  if (!root) return { ok: false, reason: "无根目录" };
  const ts = new Date().toISOString();
  const body = `# Knowledge Draft — ${changeId}\n\n_captured: ${ts}_\n\n${summary.trim()}\n`;
  const r = await writeChangeArtifact(root, changeId, "knowledge.md", body);
  return r?.ok ? { ok: true } : { ok: false, reason: r?.reason || "写入失败" };
}

async function init(): Promise<{ ok: boolean; method?: "cli" | "manual"; reason?: string }> {
  const project = useProject();
  state.error = "";

  if (isElectron()) {
    const result = await initOpenSpec(project.state.directoryPath);
    if (!result?.ok) {
      state.error = result?.reason || "初始化 OpenSpec 失败";
      return { ok: false, reason: result?.reason };
    }
    await refresh();
    // init() just created openspec/ on disk — refresh the Files tree so the
    // new directory shows up without needing to reopen the project.
    void project.refreshTree();
    return { ok: true, method: result.method };
  }

  // 浏览器模式:通过 File System Access API 创建最小骨架(空目录)
  if (!project.state.rootHandle) {
    state.error = "请先打开项目";
    return { ok: false, reason: "no root handle" };
  }
  try {
    const root = project.state.rootHandle;
    // 申请读写权限
    const perm = await (
      root as unknown as {
        queryPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
        requestPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
      }
    ).queryPermission?.({ mode: "readwrite" });
    if (perm !== "granted") {
      const req = await (
        root as unknown as {
          requestPermission?: (opts: { mode: "readwrite" }) => Promise<string>;
        }
      ).requestPermission?.({ mode: "readwrite" });
      if (req !== "granted") {
        state.error = "需要读写权限才能创建 openspec/ 目录";
        return { ok: false, reason: "permission denied" };
      }
    }
    const openspecDir = await root.getDirectoryHandle("openspec", { create: true });
    await openspecDir.getDirectoryHandle("specs", { create: true });
    await openspecDir.getDirectoryHandle("changes", { create: true });
    await refresh();
    return { ok: true, method: "manual" };
  } catch (e) {
    state.error = String(e);
    return { ok: false, reason: String(e) };
  }
}

/**
 * Delete an active (non-archived) change directory and clear its stage session
 * bindings. Bound backend sessions are deleted by the caller (App.vue) since
 * useOpenSpec has no dependency on the backend/session layer.
 */
async function deleteChange(
  changeId: string,
  options?: { onBoundSession?: (sessionId: string) => void | Promise<void> },
): Promise<{ ok: boolean; reason?: string }> {
  const project = useProject();
  if (!changeId || changeId === "archive") {
    return { ok: false, reason: "invalid changeId" };
  }
  // Notify caller of bound sessions BEFORE we clear the registry, so they can
  // delete them via the backend.
  if (options?.onBoundSession) {
    // read from localStorage-backed registry via dynamic import to avoid cycle
    const { useStageSessions } = await import("./useStageSessions");
    const stages = useStageSessions();
    for (const sid of stages.sessionsForWorkflow(changeId)) {
      await options.onBoundSession(sid);
    }
    stages.clearStageSessions(changeId);
  }
  const root = state.rootPath || project.state.directoryPath;
  if (!root) {
    return { ok: false, reason: "no project root" };
  }
  const result = await removeChangeDir(root, changeId);
  if (!result?.ok) {
    state.error = result?.reason || "删除 change 失败";
    return { ok: false, reason: result?.reason };
  }
  state.error = "";
  await refresh();
  return { ok: true };
}

export function useOpenSpec() {
  const project = useProject();
  watch(
    () => project.state.directoryPath,
    () => {
      void scheduleRefresh(0);
    },
    { immediate: true },
  );
  // 浏览器模式:directoryPath 不会变,但 rootHandle 会变
  watch(
    () => project.state.rootHandle,
    () => {
      void scheduleRefresh(0);
    },
  );

  return {
    state,
    refresh,
    scheduleRefresh,
    toggleTask,
    runValidate,
    runGates,
    archiveChange,
    captureKnowledge,
    init,
    deleteChange,
  };
}
