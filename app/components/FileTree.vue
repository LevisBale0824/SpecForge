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

// Internal drag-and-drop MIME type. The renderer reads this in InputPanel's
// drop handler to convert a dragged tree node into a `@<relpath>` attachment.
// We also mirror the path to text/plain so the drop remains useful if it lands
// in any plain-text surface (e.g. an external editor during debugging).
const TREE_MIME = "application/x-specforge-tree";

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return;
  // Payload carries the relative path plus node kind so the composer can tell
  // folders from files when synthesizing the `@path` token.
  const payload = JSON.stringify({ path: props.node.path, kind: props.node.kind });
  e.dataTransfer.setData(TREE_MIME, payload);
  e.dataTransfer.setData("text/plain", props.node.path);
  // `copy` matches the intent — dragging a reference, not moving the file.
  e.dataTransfer.effectAllowed = "copy";
}

// ---------------------------------------------------------------------------
// File/folder iconography — inline SVG (Lucide-derived paths).
// ---------------------------------------------------------------------------
// Inlining SVGs avoids the runtime network fetch that @iconify/vue requires
// by default, which is unreliable in a packaged Electron app. Each entry
// returns one or more <path> `d` strings rendered in a single <svg> stroke
// container below. Color is applied separately via the `colors` map.
type IconKind =
  | "folder"
  | "folder-open"
  | "file"
  | "file-code"
  | "file-text"
  | "file-config"
  | "file-image";

const ICON_PATHS: Record<IconKind, string[]> = {
  // Lucide `folder`
  folder: [
    "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
  ],
  // Lucide `folder-open`
  "folder-open": [
    "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2",
  ],
  // Lucide `file` (with folded corner)
  file: [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
  ],
  // Lucide `file-code` — file body + two chevrons
  "file-code": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "m10 12-2 2 2 2",
    "m14 12 2 2-2 2",
  ],
  // Lucide `file-text` — file body + horizontal text lines
  "file-text": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M16 13H8",
    "M16 17H8",
    "M10 9H8",
  ],
  // Lucide `file-cog`-ish — file body + small gear hint (config files)
  "file-config": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M11.5 12.5 11 13l-.5-.5.5-.5.5.5z",
    "M11 11.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  ],
  // Lucide `file-image` — file body + sun circle + mountain line
  "file-image": [
    "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M8.5 14.5 11 12l2.5 2.5L16 12",
    "M10 11.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z",
  ],
};

function fileIconKind(name: string): IconKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "vue", "svelte", "py", "rs", "go"].includes(ext))
    return "file-code";
  if (["md", "mdx", "txt", "log"].includes(ext)) return "file-text";
  if (["json", "yaml", "yml", "toml", "ini", "env", "conf"].includes(ext)) return "file-config";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) return "file-image";
  return "file";
}

// Color tints per extension family. Kept narrow so the tree reads as a calm
// monochrome with a few accent dots — too many colors turn into noise.
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
  <div>
    <!-- Dir entry -->
    <button
      v-if="node.kind === 'directory' && depth !== undefined"
      draggable="true"
      class="w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-200"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      :title="node.path"
      @click="toggleNode(node)"
      @dragstart="onDragStart"
    >
      <span class="w-3 text-center text-surface-600 text-[10px]">
        {{ node.expanded ? "▾" : "›" }}
      </span>
      <svg
        class="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="node.expanded ? 'text-accent-amber' : 'text-accent-amber/80'"
      >
        <path
          v-for="(d, i) in ICON_PATHS[node.expanded ? 'folder-open' : 'folder']"
          :key="i"
          :d="d"
        />
      </svg>
      <span class="truncate flex-1">{{ node.displayName ?? node.name }}</span>
    </button>

    <!-- File entry -->
    <button
      v-if="node.kind === 'file'"
      draggable="true"
      class="w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-200"
      :style="{ paddingLeft: `${(depth ?? 0) * 14 + 20}px` }"
      :title="node.path"
      @click="emit('open-file', node.path)"
      @dragstart="onDragStart"
    >
      <svg
        class="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ color: fileColor(node.name) }"
      >
        <path v-for="(d, i) in ICON_PATHS[fileIconKind(node.name)]" :key="i" :d="d" />
      </svg>
      <span class="truncate flex-1">{{ node.displayName ?? node.name }}</span>
    </button>

    <!-- Children (if directory and expanded) -->
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
