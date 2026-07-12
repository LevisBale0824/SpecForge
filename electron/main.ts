import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initAutoUpdater } from "./updater";
import { installDesktopEntry, isLinuxAppImage } from "./linux-integration";
import { initPaths } from "./paths";
import { registerInstance, unregisterInstance, hasOtherLiveInstances } from "./instanceCoordinator";
import {
  startServer,
  stopAllServers,
  restartServer,
  switchAgent,
  getServerStatus,
  getAgentConfig,
  type AgentConfig,
} from "./serverPool";
import { loadPrefs, getAllPrefs, setPref } from "./prefsStore";

// ── Directory reading ─────────────────────────────────────────────────────

type DirEntry = {
  name: string;
  kind: "file" | "directory";
  /** POSIX-style path relative to the opened root, "" for root itself. */
  path: string;
};

type WorkspaceFileDiff = {
  file: string;
  before?: string;
  after?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".openspec",
  "dist",
  "dist-electron",
  "release",
  ".next",
  ".nuxt",
  ".cache",
  ".vscode",
  ".idea",
]);

async function readDirectoryEntries(dirPath: string): Promise<DirEntry[]> {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const entry of entries) {
    const name = entry.name;
    // Dirent.isDirectory() returns false for symlinks-to-directories:
    // readdir { withFileTypes: true } does not follow symlinks, so a symlink
    // to a folder reports isSymbolicLink()=true and isDirectory()=false.
    // Stat the target to get the real type so symlinked folders show up as
    // expandable directories instead of being mislabeled as files.
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dirPath, name)).isDirectory();
      } catch {
        // Broken symlink, permission denied, or target outside reachable
        // scope — fall back to "file" so it at least shows up rather than
        // vanishing silently.
        isDir = false;
      }
    }
    if (isDir && IGNORED_DIRS.has(name)) continue;
    result.push({ name, kind: isDir ? "directory" : "file", path: name });
  }
  result.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function runGit(
  directory: string,
  args: string[],
): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd: directory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        code: code ?? 0,
      });
    });
  });
}

function parsePorcelainStatus(output: Buffer): Array<{
  path: string;
  status: "added" | "deleted" | "modified";
}> {
  const chunks = output.toString("utf8").split("\0").filter(Boolean);
  const result: Array<{
    path: string;
    status: "added" | "deleted" | "modified";
  }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const item = chunks[i];
    const xy = item.slice(0, 2);
    let file = item.slice(3);
    if (xy[0] === "R" || xy[0] === "C") {
      file = chunks[i + 1] ?? file;
      i += 1;
    }
    if (!file) continue;
    const status =
      xy.includes("?") || xy.includes("A") ? "added" : xy.includes("D") ? "deleted" : "modified";
    result.push({ path: file.replace(/\\/g, "/"), status });
  }

  return result;
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const root = path.resolve(rootPath);
  const target = path.resolve(rootPath, ...filePath.split("/"));
  return target === root || target.startsWith(root + path.sep);
}

function readTextFile(rootPath: string, relPath: string): string | undefined {
  if (!isPathInside(rootPath, relPath)) return undefined;
  const abs = path.resolve(rootPath, ...relPath.split("/"));
  if (!fs.existsSync(abs)) return undefined;
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size > 1024 * 1024) return undefined;
  const content = fs.readFileSync(abs);
  if (content.includes(0)) return undefined;
  return content.toString("utf8");
}

async function readGitHeadFile(rootPath: string, relPath: string): Promise<string | undefined> {
  const result = await runGit(rootPath, ["show", `HEAD:${relPath}`]);
  if (result.code !== 0) return undefined;
  if (result.stdout.length > 1024 * 1024) return undefined;
  if (result.stdout.includes(0)) return undefined;
  return result.stdout.toString("utf8");
}

function countPatchStats(patchText: string): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

async function readWorkspaceDiffs(rootPath: string): Promise<WorkspaceFileDiff[]> {
  const status = await runGit(rootPath, [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ]);
  if (status.code !== 0) return [];

  const files = parsePorcelainStatus(status.stdout);
  const diffs: WorkspaceFileDiff[] = [];
  for (const item of files) {
    const before = item.status === "added" ? undefined : await readGitHeadFile(rootPath, item.path);
    const after = item.status === "deleted" ? undefined : readTextFile(rootPath, item.path);
    const patch =
      item.status === "added"
        ? ""
        : (
            await runGit(rootPath, ["-c", "core.quotepath=false", "diff", "HEAD", "--", item.path])
          ).stdout.toString("utf8");
    const stats =
      item.status === "added" && after
        ? { additions: after.split("\n").length, deletions: 0 }
        : countPatchStats(patch);
    if (before === undefined && after === undefined && !patch.trim()) continue;
    diffs.push({
      file: item.path,
      before,
      after,
      patch,
      additions: stats.additions,
      deletions: stats.deletions,
      status: item.status,
    });
  }

  return diffs;
}

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── OpenSpec helpers ───────────────────────────────────────────────────────

/**
 * On Windows `openspec` is shipped as `openspec.cmd`; on Unix it's just
 * `openspec`. Resolve accordingly so spawn works cross-platform.
 */
function resolveCliCmd(base: string): string {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

async function runCli(
  directory: string,
  args: string[],
): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  // Reuse the same subprocess pattern as runGit (lines 64-87).
  return new Promise((resolve, reject) => {
    const baseCmd = args[0];
    const rest = args.slice(1);
    const cmd = resolveCliCmd(baseCmd);
    const proc = spawn(cmd, rest, {
      cwd: directory,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        code: code ?? 0,
      });
    });
  });
}

let cachedOpenspecVersion: string | null | undefined;
async function detectOpenspecCli(): Promise<{ available: boolean; version?: string }> {
  if (cachedOpenspecVersion !== undefined) {
    return {
      available: cachedOpenspecVersion !== null,
      version: cachedOpenspecVersion ?? undefined,
    };
  }
  try {
    const result = await runCli(process.cwd(), ["openspec", "--version"]);
    if (result.code === 0) {
      const v = result.stdout.toString("utf8").trim();
      cachedOpenspecVersion = v || "(unknown)";
      return { available: true, version: cachedOpenspecVersion };
    }
    cachedOpenspecVersion = null;
    return { available: false };
  } catch {
    cachedOpenspecVersion = null;
    return { available: false };
  }
}

function safeJoinPosix(rootPath: string, relPosix: string): string {
  // Reject absolute rel, parent traversal, drive letters.
  if (!relPosix || path.isAbsolute(relPosix)) throw new Error("invalid rel path");
  if (relPosix.split("/").some((seg) => seg === "..")) throw new Error("parent traversal");
  return path.resolve(rootPath, ...relPosix.split("/"));
}

// — OpenSpec state reader —
// Reads openspec/ under rootPath and assembles the GUI state. Mirrors the
// renderer-side OpenSpecState shape (minus the renderer-only fields like
// loading/error/validation). The renderer merges this into its reactive store.

type GuiCapability = {
  name: string;
  specPath: string;
  hasSpec: boolean;
  purpose?: string;
  requirements?: GuiRequirement[];
};
type GuiRequirement = {
  name: string;
  level?: string;
  text?: string;
  scenarios?: GuiScenario[];
  capability?: string;
  source?: string;
};
type GuiScenario = { name: string; steps: Array<{ keyword: string; text: string }> };
type GuiDeltaRequirement = {
  op: "added" | "modified" | "removed" | "renamed";
  name: string;
  fromName?: string;
  requirement?: GuiRequirement;
  reason?: string;
};
type GuiDeltaSpec = {
  capability: string;
  path: string;
  requirements: GuiDeltaRequirement[];
};
type GuiProposal = {
  raw: string;
  why?: string;
  whatChanges?: string;
  capabilitiesNew: string[];
  capabilitiesModified: string[];
  impact?: string;
};
type GuiTask = {
  id: string;
  title: string;
  status: "pending" | "completed";
  groupIndex: number;
  groupTitle: string;
  requirement?: string;
  verification?: string;
  estimate?: number;
  dependsOn?: string[];
  result?: string;
  lineOffset: number;
};
type GuiTaskStats = { total: number; completed: number; pending: number; progress: number };
type GuiChange = {
  id: string;
  dirPath: string;
  archived: boolean;
  archivedAt?: string;
  proposal?: GuiProposal;
  brainstorm?: string;
  tasks: GuiTask[];
  taskStats: GuiTaskStats;
  deltaSpecs: GuiDeltaSpec[];
  hasDesign: boolean;
  taskPath: string;
  proposalPath: string;
  tasksRaw?: string;
};
type GuiReadStateResult = {
  rootPath: string;
  initialized: boolean;
  capabilities: GuiCapability[];
  activeChanges: GuiChange[];
  archivedChanges: GuiChange[];
  cliAvailable: boolean;
  cliVersion?: string;
};

async function readOpenSpecState(rootPath: string): Promise<GuiReadStateResult | null> {
  const openspecRoot = path.join(rootPath, "openspec");
  if (!fs.existsSync(openspecRoot) || !fs.statSync(openspecRoot).isDirectory()) {
    const cli = await detectOpenspecCli();
    return {
      rootPath,
      initialized: false,
      capabilities: [],
      activeChanges: [],
      archivedChanges: [],
      cliAvailable: cli.available,
      cliVersion: cli.version,
    };
  }

  // Capabilities under specs/<cap>/spec.md
  const capabilities: GuiCapability[] = [];
  const specsDir = path.join(openspecRoot, "specs");
  if (fs.existsSync(specsDir) && fs.statSync(specsDir).isDirectory()) {
    for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const specPath = `specs/${entry.name}/spec.md`;
      const abs = path.join(specsDir, entry.name, "spec.md");
      const hasSpec = fs.existsSync(abs) && fs.statSync(abs).isFile();
      const cap: GuiCapability = { name: entry.name, specPath, hasSpec };
      if (hasSpec) {
        const md = fs.readFileSync(abs, "utf-8");
        const parsed = parseSpecShim(md, entry.name, "spec");
        cap.purpose = parsed.purpose;
        cap.requirements = parsed.requirements;
      }
      capabilities.push(cap);
    }
  }

  // Changes
  const activeChanges: GuiChange[] = [];
  const archivedChanges: GuiChange[] = [];
  const changesDir = path.join(openspecRoot, "changes");
  if (fs.existsSync(changesDir) && fs.statSync(changesDir).isDirectory()) {
    for (const entry of fs.readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "archive") {
        const archiveDir = path.join(changesDir, "archive");
        for (const sub of fs.readdirSync(archiveDir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const change = readChangeDir(rootPath, path.join("changes", "archive", sub.name), true);
          if (change) archivedChanges.push(change);
        }
      } else {
        const change = readChangeDir(rootPath, path.join("changes", entry.name), false);
        if (change) activeChanges.push(change);
      }
    }
  }

  const cli = await detectOpenspecCli();
  return {
    rootPath,
    initialized: true,
    capabilities,
    activeChanges,
    archivedChanges,
    cliAvailable: cli.available,
    cliVersion: cli.version,
  };
}

function readChangeDir(rootPath: string, relDir: string, archived: boolean): GuiChange | null {
  const openspecRoot = path.join(rootPath, "openspec");
  const absDir = path.join(openspecRoot, relDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return null;

  // id: 目录名(归档时去掉日期前缀 YYYY-MM-DD-)
  const dirName = path.basename(relDir);
  let id = dirName;
  let archivedAt: string | undefined;
  if (archived) {
    const dateM = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(dirName);
    if (dateM) {
      archivedAt = dateM[1];
      id = dateM[2];
    }
  }

  // relDir 是相对 openspec 根的路径(如 changes/<id>),readTextFile 接收相对
  // 项目根的路径,所以这里要拼上 openspec/ 前缀,否则会去 <root>/changes/ 找文件。
  const relUnderOpenspec = `${relDir.split(path.sep).join("/")}`;
  const proposalRel = `openspec/${relUnderOpenspec}/proposal.md`;
  const tasksRel = `openspec/${relUnderOpenspec}/tasks.md`;
  const brainstormRel = `openspec/${relUnderOpenspec}/brainstorm.md`;
  const designAbs = path.join(absDir, "design.md");

  const proposalMd = readTextFile(rootPath, proposalRel);
  const tasksMd = readTextFile(rootPath, tasksRel);
  const brainstormMd = readTextFile(rootPath, brainstormRel);

  const proposal = proposalMd ? parseProposalShim(proposalMd) : undefined;
  const parsedTasks = tasksMd
    ? parseTasksShim(tasksMd)
    : { tasks: [], stats: { total: 0, completed: 0, pending: 0, progress: 0 } };

  // Delta specs under <dir>/specs/<cap>/spec.md
  const deltaSpecs: GuiDeltaSpec[] = [];
  const deltaRoot = path.join(absDir, "specs");
  if (fs.existsSync(deltaRoot) && fs.statSync(deltaRoot).isDirectory()) {
    for (const cap of fs.readdirSync(deltaRoot, { withFileTypes: true })) {
      if (!cap.isDirectory()) continue;
      const deltaFile = path.join(deltaRoot, cap.name, "spec.md");
      if (!fs.existsSync(deltaFile)) continue;
      const md = fs.readFileSync(deltaFile, "utf-8");
      const relPath = `${relDir.split(path.sep).join("/")}/specs/${cap.name}/spec.md`;
      deltaSpecs.push(parseDeltaSpecShim(md, cap.name, relPath));
    }
  }

  return {
    id,
    dirPath: relDir.split(path.sep).join("/"),
    archived,
    archivedAt,
    proposal,
    brainstorm: brainstormMd || undefined,
    tasks: parsedTasks.tasks,
    taskStats: parsedTasks.stats,
    deltaSpecs,
    hasDesign: fs.existsSync(designAbs),
    taskPath: tasksRel,
    proposalPath: proposalRel,
    tasksRaw: tasksMd || undefined,
  };
}

// — Lightweight markdown shims —
// We duplicate the renderer-side parser logic here in plain JS so the main
// process can ship pre-parsed structures over IPC without bundling the
// renderer's TS modules. Keeping these in sync with app/utils/openspecParser.ts
// is the cost of process isolation.

function parseProposalShim(md: string): GuiProposal {
  const sections = splitSectionsShim(md);
  const find = (level: number, candidates: string[]) => {
    for (const s of sections) {
      if (s.level !== level) continue;
      const norm = s.header.trim().toLowerCase();
      if (candidates.some((c) => c.toLowerCase() === norm)) return s.body;
    }
    return undefined;
  };
  const why = find(2, ["Why"]) ?? find(2, ["Intent"]);
  const what = find(2, ["What Changes"]) ?? find(2, ["Scope"]);
  const impact = find(2, ["Impact"]) ?? find(2, ["Approach"]);
  const newCap = find(3, ["New Capabilities"]);
  const modCap = find(3, ["Modified Capabilities"]);
  const listFrom = (body: string | undefined): string[] => {
    if (!body) return [];
    const out: string[] = [];
    for (const line of body.split(/\r?\n/)) {
      const m = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (!m) continue;
      const text = m[1].trim();
      const idx = text.indexOf(":");
      out.push((idx > 0 ? text.slice(0, idx) : text).replace(/`/g, "").trim());
    }
    return out;
  };
  return {
    raw: md,
    why: why?.trim() || undefined,
    whatChanges: what?.trim() || undefined,
    capabilitiesNew: listFrom(newCap),
    capabilitiesModified: listFrom(modCap),
    impact: impact?.trim() || undefined,
  };
}

function splitSectionsShim(md: string): Array<{ header: string; level: number; body: string }> {
  const lines = md.split(/\r?\n/);
  const sections: Array<{ header: string; level: number; body: string }> = [];
  let header = "";
  let level = 0;
  let buffer: string[] = [];
  const flush = () => {
    sections.push({ header, level, body: buffer.join("\n") });
    buffer = [];
  };
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (header !== "" || buffer.length > 0) flush();
      level = m[1].length;
      header = m[2].trim();
    } else {
      buffer.push(line);
    }
  }
  if (header !== "" || buffer.length > 0) flush();
  return sections;
}

function splitByH2Shim(md: string): Array<{ header: string; body: string }> {
  const lines = md.split(/\r?\n/);
  const result: Array<{ header: string; body: string }> = [];
  let current: { header: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) result.push({ header: current.header, body: current.body.join("\n") });
      current = { header: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) result.push({ header: current.header, body: current.body.join("\n") });
  return result;
}

function parseTasksShim(md: string): { tasks: GuiTask[]; stats: GuiTaskStats } {
  const rawLines = md.split(/\r?\n/);
  const tasks: GuiTask[] = [];
  let currentGroupIndex = 0;
  let currentGroupTitle = "";
  let currentTask: GuiTask | null = null;

  const flushTask = () => {
    if (currentTask) tasks.push(currentTask);
    currentTask = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const groupM = /^##\s+(\d+)\.\s*(.*)$/.exec(line);
    if (groupM) {
      flushTask();
      currentGroupIndex = parseInt(groupM[1], 10);
      currentGroupTitle = groupM[2].trim();
      continue;
    }
    const taskM = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (taskM) {
      flushTask();
      const completed = taskM[1].toLowerCase() === "x";
      const idM = /^(\d+(?:\.\d+)*)\s+(.*)$/.exec(taskM[2].trim());
      if (!idM) continue;
      currentTask = {
        id: idM[1],
        title: idM[2].trim(),
        status: completed ? "completed" : "pending",
        groupIndex: currentGroupIndex,
        groupTitle: currentGroupTitle,
        lineOffset: i,
      };
      continue;
    }
    if (!currentTask) continue;
    const t = line.trim();
    const reqM = /^-\s*Requirement:\s*(.+)$/i.exec(t);
    const verM = /^-\s*Verification:\s*`?([^`]+?)`?\s*$/i.exec(t);
    const estM = /^-\s*Estimate:\s*(\d+)\s*(?:min|minutes)?\s*$/i.exec(t);
    const depM = /^-\s*Depends\s+on:\s*(.+)$/i.exec(t);
    const resM = /^-\s*Result:\s*(.+)$/i.exec(t);
    if (reqM) currentTask.requirement = reqM[1].trim();
    else if (verM) currentTask.verification = verM[1].trim();
    else if (estM) currentTask.estimate = parseInt(estM[1], 10);
    else if (depM)
      currentTask.dependsOn = depM[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    else if (resM) currentTask.result = resM[1].trim();
  }
  flushTask();

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  return {
    tasks,
    stats: {
      total,
      completed,
      pending: total - completed,
      progress: total === 0 ? 0 : completed / total,
    },
  };
}

function parseSpecShim(
  md: string,
  capability: string,
  source: "spec" | "delta" = "delta",
): { purpose?: string; requirements: GuiRequirement[] } {
  const lines = md.split(/\r?\n/);
  const requirements: GuiRequirement[] = [];
  let purpose: string | undefined;
  let inPurpose = false;
  let currentReq: (GuiRequirement & { text: string[]; scenarios: GuiScenario[] }) | null = null;
  let currentScenario: (GuiScenario & { body: string[] }) | null = null;
  const flushScenario = () => {
    if (currentScenario) {
      const steps: Array<{ keyword: string; text: string }> = [];
      for (const raw of currentScenario.body) {
        const line = raw.trim();
        if (!line) continue;
        const m = /^[-*+]?\s*\*?\*?(GIVEN|WHEN|THEN|AND)\b\*?\*?\s*(.*)$/i.exec(line);
        if (m) steps.push({ keyword: m[1].toUpperCase(), text: m[2].replace(/\*+/g, "").trim() });
      }
      currentReq?.scenarios.push({ name: currentScenario.name, steps });
      currentScenario = null;
    }
  };
  const flushReq = () => {
    flushScenario();
    if (currentReq) {
      const text = currentReq.text.join("\n").trim();
      const level = /\bMUST\b/.test(text)
        ? "MUST"
        : /\bSHALL\b/.test(text)
          ? "SHALL"
          : /\bSHOULD\b/.test(text)
            ? "SHOULD"
            : "MAY";
      requirements.push({
        name: currentReq.name,
        level,
        text,
        scenarios: currentReq.scenarios,
        capability,
        source,
      });
      currentReq = null;
    }
  };
  for (const line of lines) {
    if (/^##\s+Purpose\s*$/.test(line)) {
      flushReq();
      inPurpose = true;
      purpose = "";
      continue;
    }
    if (inPurpose) {
      if (/^#{1,2}\s/.test(line)) {
        inPurpose = false;
        if (purpose !== undefined) purpose = purpose.trim() || undefined;
        // 落到下面的 reqM / scM 判断
      } else {
        purpose = (purpose ?? "") + line + "\n";
        continue;
      }
    }
    const reqM = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(line);
    const scM = /^####\s+Scenario:\s*(.+?)\s*$/i.exec(line);
    if (reqM) {
      flushReq();
      currentReq = {
        name: reqM[1].trim(),
        level: "MAY",
        text: [],
        scenarios: [],
        capability,
        source,
      };
      continue;
    }
    if (scM && currentReq) {
      flushScenario();
      currentScenario = { name: scM[1].trim(), steps: [], body: [] };
      continue;
    }
    if (currentScenario) currentScenario.body.push(line);
    else if (currentReq) currentReq.text.push(line);
  }
  flushReq();
  if (inPurpose && purpose !== undefined) purpose = purpose.trim() || undefined;
  return { purpose, requirements };
}

function parseDeltaSpecShim(md: string, capability: string, deltaPath: string): GuiDeltaSpec {
  const sections = splitByH2Shim(md);
  const requirements: GuiDeltaRequirement[] = [];
  const HEADERS: Record<string, GuiDeltaRequirement["op"]> = {
    "ADDED Requirements": "added",
    "MODIFIED Requirements": "modified",
    "REMOVED Requirements": "removed",
    "RENAMED Requirements": "renamed",
  };
  for (const [header, op] of Object.entries(HEADERS)) {
    const sec = sections.find((s) => s.header.toLowerCase() === header.toLowerCase());
    if (!sec) continue;
    if (op === "removed") {
      for (const line of sec.body.split(/\r?\n/)) {
        const m = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(line);
        if (m) requirements.push({ op, name: m[1].trim() });
      }
    } else if (op === "renamed") {
      const clean = (raw: string): string => {
        const m = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(raw.trim());
        return m ? m[1].trim() : raw.trim();
      };
      let fromName: string | undefined;
      for (const line of sec.body.split(/\r?\n/)) {
        const fromM = /^[-*+]?\s*\*?\*?FROM:?\*?\*?\s*`?([^`]+?)`?\s*$/i.exec(line);
        const toM = /^[-*+]?\s*\*?\*?TO:?\*?\*?\s*`?([^`]+?)`?\s*$/i.exec(line);
        if (fromM) fromName = clean(fromM[1]);
        else if (toM && fromName) {
          requirements.push({ op, name: clean(toM[1]), fromName });
          fromName = undefined;
        }
      }
    } else {
      const inner = parseSpecShim(sec.body, capability);
      for (const req of inner.requirements) {
        requirements.push({
          op,
          name: req.name as string,
          requirement: req,
        });
      }
    }
  }
  return { capability, path: deltaPath, requirements };
}

/**
 * Toggle a single task's checkbox in tasks.md content.
 * Returns the new content, or null if the task wasn't found.
 * Preserves all other lines (evidence subfields, comments, etc.).
 */
function applyTaskToggleShim(content: string, taskId: string, completed: boolean): string | null {
  const lines = content.split(/\r?\n/);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const taskM = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(lines[i]);
    if (!taskM) continue;
    const idM = /^(\d+(?:\.\d+)*)\s+(.*)$/.exec(taskM[2].trim());
    if (!idM || idM[1] !== taskId) continue;
    const newBox = completed ? "[x]" : "[ ]";
    lines[i] = lines[i].replace(/\[([ xX])\]/, newBox);
    found = true;
    break;
  }
  return found ? lines.join("\n") : null;
}

async function runOpenspecValidate(
  rootPath: string,
  changeId?: string,
): Promise<{
  changeId?: string;
  passed: boolean;
  cliAvailable: boolean;
  issues: Array<{
    file: string;
    line?: number;
    message: string;
    rule?: string;
    severity: "error" | "warning";
  }>;
  rawOutput: string;
  ranAt: number;
}> {
  const ranAt = Date.now();
  const cli = await detectOpenspecCli();
  if (!cli.available) {
    return {
      changeId,
      passed: false,
      cliAvailable: false,
      issues: [],
      rawOutput: "",
      ranAt,
    };
  }
  const args = ["openspec", "validate"];
  if (changeId) args.push(changeId);
  args.push("--strict");
  let result;
  try {
    result = await runCli(rootPath, args);
  } catch (e) {
    return {
      changeId,
      passed: false,
      cliAvailable: true,
      issues: [
        {
          file: "",
          message: `Failed to run openspec: ${(e as Error).message}`,
          severity: "error",
        },
      ],
      rawOutput: "",
      ranAt,
    };
  }
  const raw = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`.trim();
  // Exit code is the authoritative pass/fail signal (openspec validate exits 0
  // on success). Issue parsing is best-effort detail extraction only.
  const issues = parseValidationOutput(raw, result.code !== 0);
  return {
    changeId,
    passed: result.code === 0,
    cliAvailable: true,
    issues,
    rawOutput: raw,
    ranAt,
  };
}

function parseValidationOutput(
  raw: string,
  runFailed: boolean,
): Array<{
  file: string;
  line?: number;
  message: string;
  rule?: string;
  severity: "error" | "warning";
}> {
  const out: Array<{
    file: string;
    line?: number;
    message: string;
    rule?: string;
    severity: "error" | "warning";
  }> = [];
  // Common formats:
  //   path/to/file.md:10:5 Error: message [rule/name]
  //   Error: message (path/to/file.md:10:5)
  //   error[rule]: message at path/to/file.md:10
  const lineRe =
    /^(?:(?<file>[^:\r\n]+\.(?:md|yaml|yml)):(?<line>\d+)(?::\d+)?:\s*)?(?:(?<level>Error|Warning|Info):\s*)?(?<msg>.+?)(?:\s+\[(?<rule>[^\]]+)\])?\s*$/i;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = lineRe.exec(line);
    if (!m || !m.groups) continue;
    const explicitLevel = m.groups.level?.toLowerCase();
    // Success output (e.g. "Change '...' is valid") has no severity prefix and
    // must never be promoted to an error — that would flip a passing run to
    // failed. Only treat prefix-less lines as errors on an actually failed run.
    if (!explicitLevel && !runFailed) continue;
    const lvl = (explicitLevel || "error").toLowerCase();
    if (lvl === "info") continue;
    out.push({
      file: m.groups.file || "",
      line: m.groups.line ? parseInt(m.groups.line, 10) : undefined,
      message: m.groups.msg,
      rule: m.groups.rule,
      severity: lvl === "warning" ? "warning" : "error",
    });
  }
  return out;
}

// ── IPC handlers ───────────────────────────────────────────────────────────

function registerIpcHandlers() {
  // ── Shared preferences (multi-instance consistency) ────────────────────
  // The renderer hydrates its localStorage from getAllPrefs() on startup
  // and double-writes every storageSet through prefs:set. See prefsStore.ts
  // and app/utils/storageKeys.ts for the full contract.
  ipcMain.handle("prefs:getAll", () => getAllPrefs());
  ipcMain.handle("prefs:set", (_e, key: string, value: string) => {
    if (typeof key !== "string" || typeof value !== "string") return false;
    setPref(key, value);
    return true;
  });

  ipcMain.handle("openExternalUrl", async (_e, url: string) => {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch (err) {
      console.error("[electron] openExternalUrl failed:", err);
      return false;
    }
  });

  ipcMain.handle("selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open Project",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Read one level of a directory. `relPath` is "" for the root (passed during
  // openProject) or a POSIX-style relative path for sub-directories. `rootPath`
  // is the absolute root chosen by the user.
  ipcMain.handle("readDirectory", async (_e, rootPath: string, relPath: string) => {
    const abs = relPath ? path.join(rootPath, ...relPath.split("/")) : rootPath;
    try {
      const entries = await readDirectoryEntries(abs);
      // Return entries with paths normalized to POSIX and joined with relPath
      // so the renderer can build nested tree paths deterministically.
      return relPath
        ? entries.map((e) => ({
            ...e,
            path: `${relPath}/${e.path}`,
          }))
        : entries;
    } catch (err) {
      console.error("[electron] readDirectory failed:", err);
      return [];
    }
  });

  // Full recursive file index for the @ mention menu, returned in a SINGLE
  // IPC call. This replaces the renderer's old per-directory sequential IPC
  // walk (one round-trip per folder → hundreds of awaits on medium repos),
  // which kept "Loading files…" visible for seconds. Walking server-side with
  // synchronous readdir is tens of ms for typical repos. Same IGNORED_DIRS
  // filter + depth/file caps as useFileIndex so the result matches the old
  // renderer-built list (directories carry a trailing "/").
  const FILE_INDEX_MAX_DEPTH = 20;
  const FILE_INDEX_MAX_FILES = 20000;
  ipcMain.handle("readFileIndex", (_e, rootPath: string) => {
    if (!rootPath) return [] as string[];
    const out: string[] = [];
    const queue: Array<{ abs: string; rel: string; depth: number }> = [
      { abs: rootPath, rel: "", depth: 0 },
    ];
    try {
      while (queue.length > 0) {
        if (out.length >= FILE_INDEX_MAX_FILES) break;
        const { abs, rel, depth } = queue.shift()!;
        if (depth > FILE_INDEX_MAX_DEPTH) continue;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (out.length >= FILE_INDEX_MAX_FILES) break;
          const name = entry.name;
          const childRel = rel ? `${rel}/${name}` : name;
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(name)) continue;
            out.push(`${childRel}/`);
            queue.push({ abs: path.join(abs, name), rel: childRel, depth: depth + 1 });
          } else if (entry.isSymbolicLink()) {
            // Surface symlinked dirs as directory entries (trailing slash) but
            // do NOT recurse — avoids cycles from self-/mutually-referential
            // links that would otherwise hang the walk.
            let isDir = false;
            try {
              isDir = fs.statSync(path.join(abs, name)).isDirectory();
            } catch {
              isDir = false;
            }
            out.push(isDir ? `${childRel}/` : childRel);
          } else {
            out.push(childRel);
          }
        }
      }
    } catch (err) {
      console.error("[electron] readFileIndex failed:", err);
    }
    return out;
  });

  ipcMain.handle("readWorkspaceDiff", async (_e, rootPath: string) => {
    try {
      return await readWorkspaceDiffs(rootPath);
    } catch (err) {
      console.error("[electron] readWorkspaceDiff failed:", err);
      return [];
    }
  });

  ipcMain.handle("getServerStatus", async () => {
    return getServerStatus();
  });

  ipcMain.handle("restartServer", async (_e, kind?: "opencode" | "zero") => {
    await restartServer(kind ?? "opencode");
    return getServerStatus();
  });

  ipcMain.handle("getAgentConfig", async () => {
    return getAgentConfig();
  });

  // Switch active agent. Does NOT kill the previous kind's server — opencode
  // and zero listen on different ports (13284 vs 13286), so both can coexist.
  // This matters in multi-instance setups where another SpecForge window may
  // still be using the previous agent. Each kind's server is cleaned up by
  // its own owner on shutdown (see serverPool.stopAllServers).
  //
  // The merge + switch is delegated to serverPool.switchAgent so the
  // kind/port normalization stays close to the agentConfig state it mutates.
  ipcMain.handle("setAgentConfig", async (_e, next: Partial<AgentConfig>) => {
    return await switchAgent(next);
  });

  // Explicit "stop the agent server" button in Settings → Backend.
  // Replaces the old close-window prompt: server lifecycle is now decoupled
  // from window lifecycle, so the user controls when to release the port.
  ipcMain.handle("stopAgentServer", async () => {
    stopAllServers();
    return getServerStatus();
  });

  // ── OpenSpec IPC ────────────────────────────────────────────────────────

  ipcMain.handle("readOpenSpecState", async (_e, rootPath: string) => {
    try {
      return await readOpenSpecState(rootPath);
    } catch (err) {
      console.error("[electron] readOpenSpecState failed:", err);
      return null;
    }
  });

  // Toggle a task checkbox in tasks.md. The renderer passes a logical
  // instruction (taskId + desired completed state); main process reads the
  // file, applies a single-line replacement, and writes it back. This keeps
  // the file's other content (evidence subfields, comments) untouched.
  ipcMain.handle(
    "writeOpenSpecTasks",
    async (_e, rootPath: string, changeId: string, taskId: string, completed: boolean) => {
      try {
        if (!/^[a-zA-Z0-9._-]+$/.test(changeId)) {
          return { ok: false, reason: "invalid changeId" };
        }
        const relPath = `openspec/changes/${changeId}/tasks.md`;
        const abs = safeJoinPosix(rootPath, relPath);
        if (!isPathInside(rootPath, abs)) {
          return { ok: false, reason: "path outside project" };
        }
        if (!fs.existsSync(abs)) {
          return { ok: false, reason: "tasks.md not found" };
        }
        const original = fs.readFileSync(abs, "utf-8");
        const newContent = applyTaskToggleShim(original, taskId, completed);
        if (newContent === null) {
          return { ok: false, reason: `task ${taskId} not found` };
        }
        fs.writeFileSync(abs, newContent, "utf-8");
        return { ok: true };
      } catch (err) {
        console.error("[electron] writeOpenSpecTasks failed:", err);
        return { ok: false, reason: String(err) };
      }
    },
  );

  // Remove an active (non-archived) change directory: openspec/changes/<changeId>/.
  // Used by the SidePanel "活跃探索" delete button to discard a change without
  // going through the archive flow. Refuses path escapes and the archive/ dir.
  ipcMain.handle("removeChangeDir", async (_e, rootPath: string, changeId: string) => {
    try {
      if (!/^[a-zA-Z0-9._-]+$/.test(changeId)) {
        return { ok: false, reason: "invalid changeId" };
      }
      if (changeId === "archive") {
        return { ok: false, reason: "cannot remove archive dir" };
      }
      const relPath = `openspec/changes/${changeId}`;
      const abs = safeJoinPosix(rootPath, relPath);
      if (!isPathInside(rootPath, abs)) {
        return { ok: false, reason: "path outside project" };
      }
      if (!fs.existsSync(abs)) {
        return { ok: false, reason: "change dir not found" };
      }
      fs.rmSync(abs, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      console.error("[electron] removeChangeDir failed:", err);
      return { ok: false, reason: String(err) };
    }
  });

  ipcMain.handle("runOpenSpecValidate", async (_e, rootPath: string, changeId?: string) => {
    try {
      return await runOpenspecValidate(rootPath, changeId);
    } catch (err) {
      console.error("[electron] runOpenSpecValidate failed:", err);
      return {
        changeId,
        passed: false,
        cliAvailable: false,
        issues: [
          {
            file: "",
            message: `Failed: ${(err as Error).message}`,
            severity: "error" as const,
          },
        ],
        rawOutput: "",
        ranAt: Date.now(),
      };
    }
  });

  // Initialize openspec/ in the project root.
  // Prefer `openspec init` CLI (matches official layout). If the CLI is not
  // available, fall back to a minimal manual skeleton: openspec/ + specs/ +
  // AGENTS.md placeholder. This lets users enable OpenSpec in browser mode
  // (where CLI invocation is impossible) too.
  ipcMain.handle("initOpenSpec", async (_e, rootPath: string) => {
    try {
      if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
        return { ok: false, reason: "rootPath is not a directory" };
      }
      const openspecRoot = path.join(rootPath, "openspec");
      if (fs.existsSync(openspecRoot)) {
        return { ok: false, reason: "openspec/ already exists" };
      }

      // Try CLI first
      const cli = await detectOpenspecCli();
      if (cli.available) {
        try {
          const result = await runCli(rootPath, ["openspec", "init"]);
          if (result.code === 0) {
            return { ok: true, method: "cli" as const };
          }
          // CLI ran but failed — fall through to manual skeleton
          console.warn(
            "[electron] openspec init exited with code",
            result.code,
            result.stderr.toString("utf8"),
          );
        } catch (e) {
          console.warn("[electron] openspec init threw, falling back:", e);
        }
      }

      // Manual fallback: create minimal skeleton (empty dirs only).
      // Don't fabricate AGENTS.md — that file is auto-generated by
      // `openspec update` and our static content would diverge. Users who
      // later install the CLI can run `openspec update` to materialize it.
      fs.mkdirSync(path.join(openspecRoot, "specs"), { recursive: true });
      fs.mkdirSync(path.join(openspecRoot, "changes"), { recursive: true });
      return { ok: true, method: "manual" as const };
    } catch (err) {
      console.error("[electron] initOpenSpec failed:", err);
      return { ok: false, reason: String(err) };
    }
  });

  // ── Gates & Evidence IPC ──────────────────────────────────────────────
  async function runShell(
    directory: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
    const start = Date.now();
    return new Promise((resolve) => {
      const proc = spawn(command, {
        cwd: directory,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      proc.stdout?.on("data", (c: Buffer) => out.push(c));
      proc.stderr?.on("data", (c: Buffer) => err.push(c));
      const finalize = (code: number) =>
        resolve({
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          exitCode: code,
          durationMs: Date.now() - start,
        });
      proc.on("error", () => finalize(1));
      proc.on("close", (code) => finalize(code ?? 1));
    });
  }

  function safeArtifactPath(rootPath: string, changeId: string, filename: string): string | null {
    if (!/^[a-zA-Z0-9._-]+$/.test(changeId)) return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
    const abs = safeJoinPosix(rootPath, `openspec/changes/${changeId}/${filename}`);
    if (!isPathInside(rootPath, abs)) return null;
    return abs;
  }

  ipcMain.handle("runProjectGate", async (_e, rootPath: string, command: string) => {
    try {
      if (!command || typeof command !== "string") {
        return {
          command: String(command),
          exitCode: 1,
          stdout: "",
          stderr: "empty command",
          durationMs: 0,
        };
      }
      return await runShell(rootPath, command);
    } catch (err) {
      return { command, exitCode: 1, stdout: "", stderr: String(err), durationMs: 0 };
    }
  });

  ipcMain.handle(
    "writeChangeArtifact",
    async (_e, rootPath: string, changeId: string, filename: string, content: string) => {
      try {
        const abs = safeArtifactPath(rootPath, changeId, filename);
        if (!abs) return { ok: false, reason: "invalid path" };
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf-8");
        return { ok: true };
      } catch (err) {
        console.error("[electron] writeChangeArtifact failed:", err);
        return { ok: false, reason: String(err) };
      }
    },
  );

  ipcMain.handle(
    "readChangeArtifact",
    async (_e, rootPath: string, changeId: string, filename: string) => {
      try {
        const abs = safeArtifactPath(rootPath, changeId, filename);
        if (!abs || !fs.existsSync(abs)) return null;
        return fs.readFileSync(abs, "utf-8");
      } catch {
        return null;
      }
    },
  );

  // ── Window controls (frameless titlebar) ──────────────────────────────
  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });
  ipcMain.handle("window:close", () => {
    // Tear down any in-flight console subprocesses so the app exits cleanly
    // instead of orphaning shells behind the window.
    for (const proc of consoleChildren.values()) killConsoleChild(proc);
    consoleChildren.clear();
    mainWindow?.close();
  });
  ipcMain.handle("window:isMaximized", () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // ── Console: spawn user commands and stream output ─────────────────────
  // Tracked so we can kill in-flight shells on `console:kill` or window close.
  const consoleChildren = new Map<number, ChildProcess>();

  function killConsoleChild(proc: ChildProcess | undefined): void {
    if (!proc || proc.exitCode !== null || proc.signalCode) return;
    try {
      if (process.platform === "win32") {
        // /T kills the whole descendant tree — important because shell:true
        // spawns a wrapper (cmd.exe) that owns the real process.
        execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
      } else {
        // detached handling isn't set here; fall back to direct kill plus
        // a process-group attempt for shells that did setsid themselves.
        try {
          if (typeof proc.pid === "number") process.kill(-proc.pid, "SIGTERM");
          else proc.kill("SIGTERM");
        } catch {
          proc.kill("SIGTERM");
        }
      }
    } catch {
      // Process already gone — ignore.
    }
  }

  ipcMain.handle("console:exec", async (_e, payload: { cmd: string; cwd?: string }) => {
    const cwd = payload.cwd && fs.existsSync(payload.cwd) ? payload.cwd : undefined;
    let proc: ChildProcess;
    try {
      // shell:true so users get PATH resolution, redirection, quoting —
      // matching what they'd type in a real terminal.
      proc = spawn(payload.cmd, {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return { ok: false as const, error: String(err) };
    }
    const pid = proc.pid ?? -1;
    if (pid >= 0) consoleChildren.set(pid, proc);

    const send = (kind: "stdout" | "stderr" | "exit", data: string, code?: number) => {
      mainWindow?.webContents.send("console:data", { pid, kind, data, code });
    };

    proc.stdout?.on("data", (chunk: Buffer) => send("stdout", chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => send("stderr", chunk.toString()));
    proc.on("error", (err) => send("stderr", `${err.message}\n`));
    proc.on("exit", (code, signal) => {
      consoleChildren.delete(pid);
      send("exit", "", code ?? (signal ? -1 : 0));
    });
    return { ok: true as const, pid };
  });

  ipcMain.handle("console:kill", async (_e, pid: number) => {
    killConsoleChild(consoleChildren.get(pid));
    consoleChildren.delete(pid);
  });
}

// ── Application menu ──────────────────────────────────────────────────────

async function pickAndOpenFolder(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Open Project Folder",
  });
  if (result.canceled || result.filePaths.length === 0) return;
  mainWindow.webContents.send("menu:openFolder", result.filePaths[0]);
}

function registerMenu() {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: () => void pickAndOpenFolder(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Window management ──────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "SpecForge",
    // Frameless window with custom titlebar. On macOS keep the traffic-light
    // buttons (titleBarStyle: "hidden") for native familiarity; on Win/Linux
    // go fully frameless and paint our own window controls.
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition: { x: 10, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Notify renderer when maximize state changes so the titlebar can swap its
  // maximize/restore icon. macOS uses native traffic lights — no toggle needed.
  const emitMaximizeChange = () => {
    mainWindow?.webContents.send("window:maximizeChange", mainWindow.isMaximized());
  };
  mainWindow.on("maximize", emitMaximizeChange);
  mainWindow.on("unmaximize", emitMaximizeChange);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Detach into a standalone window so DevTools doesn't get clipped by the
    // frameless main window and F12 remains accessible.
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

// ── Single-instance lock ──────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (!gotTheLock) {
    app.quit();
    return;
  }

  // AppImage 集成入口:./SpecForge.AppImage --install
  // 写入 ~/.local/share/applications/specforge.desktop 后立即退出。
  if (process.argv.includes("--install")) {
    try {
      if (isLinuxAppImage()) {
        const result = installDesktopEntry();
        console.log(
          `[--install] ${result.alreadyExisted ? "updated" : "created"} ${result.desktopPath}`,
        );
        console.log(`[--install] Exec="${result.execPath}"`);
      } else {
        console.error("[--install] 仅在 AppImage 模式下可用");
      }
    } catch (e) {
      console.error("[--install] failed:", e instanceof Error ? e.message : e);
    }
    app.quit();
    return;
  }

  registerIpcHandlers();
  registerMenu();
  // Initialize path layout (config + runtime dirs) and register this
  // process in the instance coordinator. Must happen before startServer
  // so zombie cleanup can record our PIDs into the right location.
  initPaths();
  // Load shared prefs into the main-process cache before any renderer IPC
  // can arrive. Must run after initPaths() (specforge.config.json lives under the
  // config dir that initPaths ensures exists).
  loadPrefs();
  registerInstance(app.getVersion());
  // Decoupled model: every SpecForge window reuses the same detached agent
  // server. startServer adopts an existing healthy daemon if present, or
  // spawns one if not. No primary/secondary coordination needed.
  await startServer();
  createWindow();
  // Initialize auto-updater after the window exists so its webContents can
  // receive broadcast events. Dev mode is a no-op inside initAutoUpdater.
  initAutoUpdater();
});

// ── Shutdown coordination ─────────────────────────────────────────────────
// Decoupled model: closing a window never stops the agent server. The
// server is a shared detached daemon that survives any single window's
// lifetime. We only stop it when the LAST SpecForge window disappears.
//
// "Last instance" is detected via PID files in the runtime dir (see
// instanceCoordinator.ts): each SpecForge writes {pid}.json on launch
// and deletes it on quit. The close flow scans the directory and probes
// every other PID with process.kill(pid, 0) — if none are alive, we're
// the last and own the cleanup.

let isShuttingDown = false;

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (isShuttingDown) return; // shutdown already in progress, let quit proceed
  event.preventDefault();
  isShuttingDown = true;
  try {
    // Remove our own PID file FIRST so the scan doesn't see us. Then
    // check whether any other instance is still alive. If not, we own
    // the cleanup of the shared agent daemon.
    unregisterInstance();
    const othersAlive = hasOtherLiveInstances();
    if (othersAlive) {
      console.log("[electron] other instances remain — leaving server alive");
    } else {
      console.log("[electron] last instance — stopping agent server");
      stopAllServers();
    }
  } catch (err) {
    console.warn("[electron] shutdown coordination failed:", err);
    // Safe fallback: don't stop. A leaked daemon is recoverable on next
    // launch via detectAndCleanZombie; killing someone else's server is
    // not recoverable.
  }
  app.quit();
});
