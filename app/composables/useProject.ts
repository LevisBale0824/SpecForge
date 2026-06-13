// ---------------------------------------------------------------------------
// Project Store — shared state for opened project directory
// ---------------------------------------------------------------------------

import { reactive } from "vue";

export type FileNode = {
  name: string;
  kind: "file" | "directory";
  path: string;
  handle?: FileSystemDirectoryHandle;
  children?: FileNode[];
  expanded?: boolean;
  loaded?: boolean;
};

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

async function readDirectory(
  handle: FileSystemDirectoryHandle,
  parentPath: string,
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  try {
    // @ts-expect-error
    for await (const [name, child] of handle.entries()) {
      // @ts-expect-error
      const kind = child.kind as "file" | "directory";
      const path = parentPath ? `${parentPath}/${name}` : name;
      const node: FileNode = { name, kind, path };
      if (kind === "directory") {
        // @ts-expect-error
        node.handle = child as FileSystemDirectoryHandle;
        node.children = [];
        node.expanded = false;
        node.loaded = false;
      }
      nodes.push(node);
    }
  } catch {
    // @ts-expect-error
    for await (const child of handle.values()) {
      // @ts-expect-error
      const kind = child.kind as "file" | "directory";
      const name = child.name;
      const path = parentPath ? `${parentPath}/${name}` : name;
      const node: FileNode = { name, kind, path };
      if (kind === "directory") {
        // @ts-expect-error
        node.handle = child as FileSystemDirectoryHandle;
        node.children = [];
        node.expanded = false;
        node.loaded = false;
      }
      nodes.push(node);
    }
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
      const children = await readDirectory(handle, "");
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

  async function toggleNode(node: FileNode) {
    if (node.kind !== "directory" || !node.handle) return;

    if (!node.loaded) {
      const children = await readDirectory(node.handle, node.path);
      node.children = children;
      node.loaded = true;
    }
    node.expanded = !node.expanded;
  }

  function openDirectoryPath(path: string) {
    state.rootHandle = null;
    state.directoryName = path.split(/[/\\]/).pop() || path;
    state.directoryPath = path;
    state.root = null;
    state.loading = false;
    state.error = "";
  }

  function clearProject() {
    state.rootHandle = null;
    state.directoryName = "";
    state.directoryPath = "";
    state.root = null;
    state.loading = false;
    state.error = "";
  }

  return {
    state,
    openDirectoryHandle,
    toggleNode,
    openDirectoryPath,
    clearProject,
  };
}
