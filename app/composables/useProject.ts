// ---------------------------------------------------------------------------
// Project Store — shared state for opened project directory
// ---------------------------------------------------------------------------

import { reactive } from "vue";
import { isElectron, selectDirectory, readDirectory } from "../utils/electronBridge";
import type { DirEntry } from "../types/electron";

export type FileNode = {
  name: string;
  kind: "file" | "directory";
  path: string;
  handle?: FileSystemDirectoryHandle;
  children?: FileNode[];
  expanded?: boolean;
  loaded?: boolean;
  // Display-only label; set when consecutive single-child directory chains
  // are compacted (e.g. `packages/foo/src`). `path`/`name` keep their original
  // single-level values so IPC, drag payload, and toggleNode loading remain
  // keyed on the real on-disk hierarchy.
  displayName?: string;
};

// IDEA-style "compact folders": if a directory's only child is itself a
// directory, merge the child's name into the parent's displayName and morph
// the parent to represent the deeper directory (path/handle/loaded become the
// tail's). Recurses so chains like packages/foo/src collapse into a single
// node. Only call this on freshly-loaded entries before they're rendered, so
// there's no prior expanded/loaded state to preserve on the intermediate nodes.
function compactChildren(entries: FileNode[]): FileNode[] {
  for (const node of entries) {
    if (node.kind !== "directory") continue;
    // Walk down the chain as long as the cursor has exactly one directory
    // child and no file siblings. We stop when the chain widens (multiple
    // children) or hits an unloaded directory — those will compact later
    // when the user expands them.
    const segs: string[] = [node.displayName ?? node.name];
    while (node.children && node.children.length === 1 && node.children[0].kind === "directory") {
      const child = node.children[0];
      segs.push(child.displayName ?? child.name);
      // Morph `node` to represent the deeper directory. Its `path` and
      // `handle` now point at the tail, so a subsequent toggleNode loads the
      // tail's children correctly.
      node.path = child.path;
      node.handle = child.handle ?? node.handle;
      node.loaded = child.loaded;
      node.expanded = child.expanded;
      node.children = child.children;
    }
    if (segs.length > 1) {
      node.displayName = segs.join("/");
    }
    // Recurse into the (possibly promoted) children.
    if (node.children && node.children.length > 0) {
      compactChildren(node.children);
    }
  }
  return entries;
}

type ProjectState = {
  rootHandle: FileSystemDirectoryHandle | null;
  directoryName: string;
  directoryPath: string;
  root: FileNode | null;
  loading: boolean;
  error: string;
};

const state = reactive<ProjectState>({
  rootHandle: null,
  directoryName: "",
  directoryPath: "",
  root: null,
  loading: false,
  error: "",
});

async function readDirectoryFromHandle(
  handle: FileSystemDirectoryHandle,
  parentPath: string,
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  for await (const [name, child] of handle.entries()) {
    const kind = child.kind as "file" | "directory";
    const path = parentPath ? `${parentPath}/${name}` : name;
    const node: FileNode = { name, kind, path };
    if (kind === "directory") {
      node.handle = child as FileSystemDirectoryHandle;
      node.children = [];
      node.expanded = false;
      node.loaded = false;
    }
    nodes.push(node);
  }
  // Sort: directories first, then files, alphabetically
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function useProject() {
  async function openDirectoryHandle(handle: FileSystemDirectoryHandle) {
    state.rootHandle = handle;
    state.directoryName = handle.name;
    state.directoryPath = handle.name;
    state.loading = true;
    state.error = "";

    try {
      const children = compactChildren(await readDirectoryFromHandle(handle, ""));
      state.root = {
        name: handle.name,
        kind: "directory",
        path: "",
        handle,
        children,
        expanded: true,
        loaded: true,
      };
    } catch (e) {
      console.error("[useProject] read error:", e);
      state.error = String(e);
    } finally {
      state.loading = false;
    }
  }

  // Recursively refresh every directory node that has already been loaded.
  // Children that still exist on disk keep their `expanded`/`loaded` flags
  // so the user's tree expansion state survives the refresh.
  async function refreshNode(node: FileNode): Promise<void> {
    if (node.kind !== "directory" || !node.loaded) return;

    let newEntries: FileNode[] = [];
    if (node.handle) {
      newEntries = await readDirectoryFromHandle(node.handle, node.path);
    } else if (isElectron() && state.directoryPath) {
      const entries = await readDirectory(state.directoryPath, node.path);
      newEntries = (entries ?? []).map(entryToFileNode);
    }

    const oldMap = new Map((node.children ?? []).map((c) => [c.path, c]));
    node.children = compactChildren(
      newEntries.map((c) => {
        const old = oldMap.get(c.path);
        if (old) {
          return {
            ...c,
            expanded: old.expanded,
            loaded: old.loaded,
            children: old.children,
          };
        }
        return c;
      }),
    );

    for (const child of node.children) {
      if (child.loaded) await refreshNode(child);
    }
  }

  async function refreshTree(): Promise<void> {
    if (state.root) await refreshNode(state.root);
  }

  // Debounced entry point for "user might have changed files externally"
  // signals (window focus, visibility change). Catches the case where the
  // user deletes/creates files outside of SpecForge — we don't have a fs
  // watcher, so polling on focus is the lightest acceptable heuristic.
  let refreshTimer: number | undefined;
  function scheduleRefreshTree(delay = 400): void {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void refreshTree();
    }, delay);
  }

  async function toggleNode(node: FileNode) {
    if (node.kind !== "directory") return;

    // Web mode: expand via FileSystemDirectoryHandle
    if (node.handle) {
      if (!node.loaded) {
        const children = await readDirectoryFromHandle(node.handle, node.path);
        node.children = compactChildren(children);
        node.loaded = true;
      }
      node.expanded = !node.expanded;
      return;
    }

    // Electron mode: expand via IPC using absolute root + relative path
    if (isElectron() && state.directoryPath) {
      if (!node.loaded) {
        const entries = await readDirectory(state.directoryPath, node.path);
        node.children = compactChildren((entries ?? []).map(entryToFileNode));
        node.loaded = true;
      }
      node.expanded = !node.expanded;
    }
  }

  function openDirectoryPath(path: string) {
    // In Electron, defer to the IPC-backed loader so the tree actually populates.
    if (isElectron()) {
      void openDirectoryPathElectron(path);
      return;
    }
    state.rootHandle = null;
    state.directoryName = path.split(/[/\\]/).pop() || path;
    state.directoryPath = path;
    state.root = null;
    state.loading = false;
    state.error = "";
  }

  function entryToFileNode(entry: DirEntry): FileNode {
    const node: FileNode = {
      name: entry.name,
      kind: entry.kind,
      path: entry.path,
    };
    if (entry.kind === "directory") {
      node.children = [];
      node.expanded = false;
      node.loaded = false;
    }
    return node;
  }

  async function openDirectoryPathElectron(absPath: string) {
    state.rootHandle = null;
    state.directoryName = absPath.split(/[/\\]/).pop() || absPath;
    state.directoryPath = absPath;
    state.loading = true;
    state.error = "";
    try {
      const entries = await readDirectory(absPath, "");
      const children = compactChildren((entries ?? []).map(entryToFileNode));
      state.root = {
        name: state.directoryName,
        kind: "directory",
        path: "",
        children,
        expanded: true,
        loaded: true,
      };
    } catch (e) {
      console.error("[useProject] electron read error:", e);
      state.error = String(e);
    } finally {
      state.loading = false;
    }
  }

  function clearProject() {
    state.rootHandle = null;
    state.directoryName = "";
    state.directoryPath = "";
    state.root = null;
    state.loading = false;
    state.error = "";
  }

  async function openDirectoryNative(): Promise<boolean> {
    if (!isElectron()) return false;
    const dirPath = await selectDirectory();
    if (!dirPath) return false;
    await openDirectoryPathElectron(dirPath);
    return true;
  }

  return {
    state,
    openDirectoryHandle,
    openDirectoryNative,
    toggleNode,
    openDirectoryPath,
    clearProject,
    refreshTree,
    scheduleRefreshTree,
  };
}
