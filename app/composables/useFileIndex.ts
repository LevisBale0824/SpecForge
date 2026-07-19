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
import { isElectron, readFileIndex } from "../utils/electronBridge";
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
  "build",
  "out",
  "bin",
  "obj",
  "target",
  "coverage",
  "tmp",
  "temp",
  ".gradle",
  ".turbo",
  ".parcel-cache",
  ".vinxi",
  ".svelte-kit",
  ".angular",
  ".astro",
  ".docusaurus",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tsbuildinfo",
]);

const WEB_IGNORED_FILES = new Set([".DS_Store", "Thumbs.db", ".npmrc", ".gitkeep", ".keep"]);
const WEB_IGNORED_FILE_SUFFIXES = [".log", ".min.js", ".min.css", ".map", ".tsbuildinfo", ".class"];

function isIgnoredFile(name: string): boolean {
  if (WEB_IGNORED_FILES.has(name)) return true;
  for (const suffix of WEB_IGNORED_FILE_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

const files = ref<string[]>([]);
const loaded = ref(false);
const loading = ref(false);
// Guards a background `refresh` so rapid focus events don't stack overlapping
// walks. Distinct from `loading` (the cold-load flag shown in the UI) — a
// refresh never flips loading, so stale data stays visible until the fresh
// list swaps in.
let refreshing = false;

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
      // Trailing-slash entries mark directories for the @ menu (see walkElectron).
      out.push(`${childPath}/`);
      await walkHandle(child as FileSystemDirectoryHandle, childPath, depth + 1, out);
    } else if (!isIgnoredFile(name)) {
      out.push(childPath);
    }
  }
}

// Collect the full flat path list. Electron: a single IPC round-trip (the main
// process walks the tree synchronously). Web: a recursive directory-handle
// walk. Both apply the same depth/file caps and trailing-slash dir convention.
async function collect(rootAbs: string): Promise<string[]> {
  if (isElectron() && rootAbs) {
    return (await readFileIndex(rootAbs)) ?? [];
  }
  const project = useProject();
  const rootHandle = project.state.rootHandle;
  if (!rootHandle) return [];
  const out: string[] = [];
  await walkHandle(rootHandle, "", 0, out);
  return out;
}

async function load(rootAbs: string): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    files.value = await collect(rootAbs);
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

// Background refresh: re-read disk and swap in the fresh list WITHOUT flipping
// `loading`, so the @ menu never re-shows "Loading files…". Stale data stays
// visible until the new list lands. Used by focus/visibility handlers —
// external edits (rm/mv/CLI) should refresh the index silently.
async function refresh(rootAbs: string): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    files.value = await collect(rootAbs);
    loaded.value = true;
  } catch (error) {
    console.error("[useFileIndex] refresh failed:", error);
  } finally {
    refreshing = false;
  }
}

function reset(): void {
  files.value = [];
  loaded.value = false;
  loading.value = false;
  refreshing = false;
}

export function useFileIndex() {
  return {
    files,
    loaded,
    loading,
    ensureLoaded,
    refresh,
    reset,
  };
}
