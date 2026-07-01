export type DirEntry = {
  name: string;
  kind: "file" | "directory";
  /** POSIX-style path relative to the opened root. */
  path: string;
};

export type WorkspaceFileDiff = {
  file: string;
  before?: string;
  after?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

export type AgentKind = "opencode" | "zero";

export type AgentConfig = {
  kind: AgentKind;
  opencodePort: number;
  zeroPort: number;
};

export type ServerStatus = {
  running: boolean;
  port: number;
  pid: number;
};

// ── Console IPC ─────────────────────────────────────────────────────────
export type ConsoleExecResult = { ok: true; pid: number } | { ok: false; error: string };

export type ConsoleDataEvent =
  | { pid: number; kind: "stdout" | "stderr"; data: string }
  | { pid: number; kind: "exit"; data: string; code: number };

// ── OpenSpec IPC ────────────────────────────────────────────────────────
// 主类型定义在 app/types/openspec.ts,这里只 re-export IPC 边界用到的类型
export type {
  OpenSpecReadStateResult,
  OpenSpecWriteTasksResult,
  OpenSpecValidationResult,
} from "./openspec";

// ── Auto-updater IPC ────────────────────────────────────────────────────
export type UpdateEvent =
  | { status: "checking" }
  | { status: "available"; version: string; releaseNotes: string }
  | { status: "up-to-date" }
  | {
      status: "progress";
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { status: "downloaded"; version: string }
  | { status: "error"; error: string };

export type UserUpdatePrefs = {
  autoUpdate: boolean;
  proxy: string;
  skippedVersion: string | null;
};

export interface ElectronAPI {
  /** Read the full shared config map (keyed by "ui:theme" / "opencode:baseUrl" / etc). */
  /** Resolve an absolute OS path for a dropped File via Electron webUtils. */
  getPathForFile: (file: File) => string;
  prefsGetAll: () => Promise<Record<string, string>>;
  /** Mirror a single key/value into specforge.config.json (atomic write on main side). */
  prefsSet: (key: string, value: string) => Promise<boolean>;
  selectDirectory: () => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<boolean>;
  readDirectory: (rootPath: string, relPath: string) => Promise<DirEntry[] | null>;
  /** Full recursive file index (relative POSIX paths, dirs trailing "/") in one IPC call. */
  readFileIndex: (rootPath: string) => Promise<string[]>;
  readWorkspaceDiff: (rootPath: string) => Promise<WorkspaceFileDiff[]>;
  getServerStatus: () => Promise<ServerStatus>;
  restartServer: (kind?: AgentKind) => Promise<ServerStatus>;
  getAgentConfig: () => Promise<AgentConfig>;
  setAgentConfig: (
    config: Partial<AgentConfig>,
  ) => Promise<{ config: AgentConfig; status: ServerStatus }>;
  /** Stop the agent server (Electron only). Server is otherwise a detached
   *  daemon that survives window close; this is the explicit kill switch. */
  stopAgentServer: () => Promise<ServerStatus>;
  /** 读取整个 openspec/ 目录的状态;无 openspec/ 时返回 null */
  readOpenSpecState: (
    rootPath: string,
  ) => Promise<import("./openspec").OpenSpecReadStateResult | null>;
  /** 写回 tasks.md;toggle 一个 task 的 checkbox 状态。成功 ok=true */
  writeOpenSpecTasks: (
    rootPath: string,
    changeId: string,
    taskId: string,
    completed: boolean,
  ) => Promise<import("./openspec").OpenSpecWriteTasksResult>;
  /** 跑 `openspec validate <changeId?> --strict`;changeId 省略为全局校验 */
  runOpenSpecValidate: (
    rootPath: string,
    changeId?: string,
  ) => Promise<import("./openspec").OpenSpecValidationResult>;
  /** 在项目根启用 OpenSpec:优先 openspec init,降级到 fs 创建骨架 */
  initOpenSpec: (
    rootPath: string,
  ) => Promise<{ ok: boolean; method?: "cli" | "manual"; reason?: string }>;
  /** 无边框标题栏:窗口控制 + 最大化状态变化事件 */
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  onOpenFolder: (callback: (path: string) => void) => () => void;
  /** Spawn a user-typed shell command, return OS pid for kill/stream keying. */
  consoleExec: (cmd: string, cwd?: string) => Promise<ConsoleExecResult>;
  /** Kill an in-flight console subprocess by pid. */
  consoleKill: (pid: number) => Promise<void>;
  /** Subscribe to stdout/stderr/exit streams for any console subprocess. */
  onConsoleData: (callback: (event: ConsoleDataEvent) => void) => () => void;
  /** Manual check for updates; resolves with the first terminal event. */
  checkForUpdates: () => Promise<UpdateEvent>;
  /** User-triggered download of the available update. */
  downloadUpdate: () => Promise<void>;
  /** Quit and install a downloaded update. */
  installUpdate: () => Promise<void>;
  /** Current app version (from package.json via app.getVersion). */
  getAppVersion: () => Promise<string>;
  /** Read persistent updater preferences (auto-check toggle). */
  getUpdatePrefs: () => Promise<UserUpdatePrefs>;
  /** Toggle auto-check and persist to specforge.config.json. */
  setUpdateAutoCheck: (enabled: boolean) => Promise<UserUpdatePrefs>;
  /** Persist proxy URL and apply to session immediately. Empty string clears. */
  setUpdateProxy: (proxy: string) => Promise<UserUpdatePrefs>;
  /** Persist "ignore this version" choice; null clears it. */
  skipUpdateVersion: (version: string | null) => Promise<UserUpdatePrefs>;
  /** Subscribe to broadcast update events from the main process. */
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => () => void;
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
