<script setup lang="ts">
import { useProject, type FileNode } from "../composables/useProject";

const props = defineProps<{
  node: FileNode;
  depth?: number;
}>();

const { toggleNode } = useProject();

const emit = defineEmits<{
  "open-file": [path: string];
}>();

const TREE_MIME = "application/x-specforge-tree";

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return;
  const payload = JSON.stringify({ path: props.node.path, kind: props.node.kind });
  e.dataTransfer.setData(TREE_MIME, payload);
  e.dataTransfer.setData("text/plain", props.node.path);
  e.dataTransfer.effectAllowed = "copy";
}

type IconKind =
  | "folder"
  | "folder-open"
  | "file"
  | "file-code"
  | "file-text"
  | "file-config"
  | "file-image";

const ICON_PATHS: Record<IconKind, string[]> = {
  folder: [
    "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
  ],
  "folder-open": [
    "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2",
  ],
  file: [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
  ],
  "file-code": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "m10 12-2 2 2 2",
    "m14 12 2 2-2 2",
  ],
  "file-text": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M16 13H8",
    "M16 17H8",
    "M10 9H8",
  ],
  "file-config": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M11.5 12.5 11 13l-.5-.5.5-.5.5.5z",
    "M11 11.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  ],
  "file-image": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M8.5 14.5 11 12l2.5 2.5L16 12",
    "M10 11.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z",
  ],
};

function fileIconKind(name: string): IconKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "vue", "svelte", "py", "rs", "go"].includes(ext)) {
    return "file-code";
  }
  if (["md", "mdx", "txt", "log"].includes(ext)) return "file-text";
  if (["json", "yaml", "yml", "toml", "ini", "env", "conf"].includes(ext)) return "file-config";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) {
    return "file-image";
  }
  return "file";
}

const FILE_COLOR: Record<string, string> = {
  ts: "#3b82f6",
  tsx: "#3b82f6",
  js: "#f59e0b",
  jsx: "#f59e0b",
  mjs: "#f59e0b",
  vue: "#10b981",
  svelte: "#f97316",
  py: "#6366f1",
  rs: "#f43f5e",
  go: "#06b6d4",
  md: "#94a3b8",
  mdx: "#94a3b8",
  json: "#f59e0b",
  yaml: "#f59e0b",
  yml: "#f59e0b",
  toml: "#f59e0b",
  css: "#06b6d4",
  scss: "#ec4899",
  less: "#06b6d4",
};

function fileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_COLOR[ext] ?? "#64748b";
}
</script>

<template>
  <div class="file-tree-node">
    <button
      v-if="node.kind === 'directory' && depth !== undefined"
      type="button"
      draggable="true"
      class="tree-row"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      :title="node.path"
      @click="toggleNode(node)"
      @dragstart="onDragStart"
    >
      <span class="tree-caret" :class="{ expanded: node.expanded }">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path
            clip-rule="evenodd"
            fill-rule="evenodd"
            d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
          />
        </svg>
      </span>
      <svg
        class="tree-icon folder"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          v-for="(d, i) in ICON_PATHS[node.expanded ? 'folder-open' : 'folder']"
          :key="i"
          :d="d"
        />
      </svg>
      <span class="tree-label">{{ node.displayName ?? node.name }}</span>
    </button>

    <button
      v-if="node.kind === 'file'"
      type="button"
      draggable="true"
      class="tree-row file"
      :style="{ paddingLeft: `${(depth ?? 0) * 14 + 20}px` }"
      :title="node.path"
      @click="emit('open-file', node.path)"
      @dragstart="onDragStart"
    >
      <svg
        class="tree-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ color: fileColor(node.name) }"
      >
        <path v-for="(d, i) in ICON_PATHS[fileIconKind(node.name)]" :key="i" :d="d" />
      </svg>
      <span class="tree-label">{{ node.displayName ?? node.name }}</span>
    </button>

    <template v-if="node.kind === 'directory' && node.expanded && node.children">
      <FileTree
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="(depth ?? 0) + 1"
        @open-file="emit('open-file', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-row {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 5px;
  padding-right: 7px;
  padding-bottom: 5px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.tree-row:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}

.tree-caret {
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-surface-600, #475569);
}

.tree-caret svg {
  width: 11px;
  height: 11px;
  transition: transform 0.12s ease;
}

.tree-caret.expanded svg {
  transform: rotate(90deg);
}

.tree-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  stroke-width: 1.75;
}

.tree-icon.folder {
  color: var(--color-accent-amber, #f59e0b);
}

.tree-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
