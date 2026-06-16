// ---------------------------------------------------------------------------
// File Index — flat list of project files for @ autocomplete
// ---------------------------------------------------------------------------
// Lazily builds a flat list of relative file paths (POSIX style) for the
// currently opened project. Used by the @ file mention menu in InputPanel.
//
// Data source:
//   - Electron mode: window.electronAPI.readDirectory(root, rel) — already
//     filters IGNORED_DIRS (node_modules, .git, dist, …) on the main side.
//   - Web mode: useProject().state.rootHandle via FileSystemDirectoryHandle
//     iteration; we filter the same dirs client-side.
//
// Safety valves:
//   - MAX_DEPTH: don't recurse beyond N levels (defends against pathological
//     deep trees).
//   - MAX_FILES: stop after collecting M files (defends against huge repos).
//   - Failure does NOT mark `loaded` so the next @ press retries — same
//     lesson as useCommands.
// ---------------------------------------------------------------------------

import { ref } from "vue";
import { isElectron, readDirectory } from "../utils/electronBridge";
import { useProject } from "./useProject";

// Depth cap defends against pathological trees (e.g. a vendored copy of some
// deep package). 6 was too low — Java projects routinely hit
// `src/main/java/com/company/project/module/service/impl/Xyz.java` (9 levels),
// Go monorepos and Rust workspaces go deeper still. 20 covers every real
// project structure we've seen without letting a runaway nested vendor dir
// blow up the walk.
const MAX_DEPTH = 20;
// File cap is the real safety valve — IGNORED_DIRS already drops the giant
// dirs (node_modules / .git / dist / build), so the surviving source tree is
// rarely huge. 20000 leaves plenty of headroom for monorepos.
const MAX_FILES = 20000;

// Mirror of electron/main.ts IGNORED_DIRS — applied only in Web mode because
// the Electron IPC already filters them server-side.
const WEB_IGNORED_DIRS = new Set([
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

const files = ref<string[]>([]);
const loaded = ref(false);
const loading = ref(false);

async function walkElectron(rootAbs: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    const entries = await readDirectory(rootAbs, rel);
    if (!entries) continue;
    for (const e of entries) {
      if (out.length >= MAX_FILES) return out;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "directory") {
        queue.push({ rel: childRel, depth: depth + 1 });
      } else {
        out.push(childRel);
      }
    }
  }
  return out;
}

async function walkHandle(
  handle: FileSystemDirectoryHandle,
  parentPath: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  for await (const [name, child] of handle.entries()) {
    if (out.length >= MAX_FILES) return;
    const childPath = parentPath ? `${parentPath}/${name}` : name;
    if (child.kind === "directory") {
      if (WEB_IGNORED_DIRS.has(name)) continue;
      await walkHandle(child as FileSystemDirectoryHandle, childPath, depth + 1, out);
    } else {
      out.push(childPath);
    }
  }
}

async function load(rootAbs: string): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    let result: string[] = [];
    if (isElectron() && rootAbs) {
      result = await walkElectron(rootAbs);
    } else {
      const project = useProject();
      const rootHandle = project.state.rootHandle;
      if (rootHandle) {
        await walkHandle(rootHandle, "", 0, result);
      }
    }
    files.value = result;
    loaded.value = true;
  } catch (error) {
    // Do NOT flip `loaded` on error — ensureLoaded() would then suppress
    // every retry (same bug we hit in useCommands).
    console.error("[useFileIndex] load failed:", error);
    files.value = [];
  } finally {
    loading.value = false;
  }
}

function ensureLoaded(rootAbs: string): void {
  if (loaded.value || loading.value) return;
  void load(rootAbs);
}

function reset(): void {
  files.value = [];
  loaded.value = false;
  loading.value = false;
}

export function useFileIndex() {
  return {
    files,
    loaded,
    loading,
    ensureLoaded,
    reset,
  };
}
