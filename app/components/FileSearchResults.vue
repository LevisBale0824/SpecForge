<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  query: string;
  files: readonly string[];
}>();

const emit = defineEmits<{
  "open-file": [path: string];
}>();

// Same MIME contract as FileTree.vue — the InputPanel composer reads this to
// turn a dragged result into an `@<relpath>` attachment. Mirroring it here
// lets search results be dragged into the composer just like tree nodes.
const TREE_MIME = "application/x-specforge-tree";

function onDragStart(path: string, e: DragEvent) {
  if (!e.dataTransfer) return;
  // The file index stores relative paths; directory entries carry a trailing
  // "/". Pass the kind through so the composer's drop handler can re-add the
  // trailing slash for folders (it normalizes the path either way).
  const isDir = path.endsWith("/");
  const payload = JSON.stringify({ path, kind: isDir ? "directory" : "file" });
  e.dataTransfer.setData(TREE_MIME, payload);
  e.dataTransfer.setData("text/plain", path);
  e.dataTransfer.effectAllowed = "copy";
}

// Upper bound on rendered rows. With a 20k-file index a broad query like
// "test" can match thousands of entries — rendering all of them as DOM nodes
// janks the sidebar hard. 100 is enough for a quick scan; the user narrows
// the query if they don't see what they need.
const MAX_RESULTS = 100;

const results = computed(() => {
  const q = props.query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const path of props.files) {
    if (out.length >= MAX_RESULTS) break;
    if (path.toLowerCase().includes(q)) out.push(path);
  }
  return out;
});

// Inline file-type icon — mirrors FileTree.vue's iconography but kept small
// and local since search results are flat (no folders to render).
function fileColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "#3b82f6",
    tsx: "#3b82f6",
    js: "#f59e0b",
    jsx: "#f59e0b",
    vue: "#10b981",
    py: "#6366f1",
    rs: "#f43f5e",
    go: "#06b6d4",
    md: "#94a3b8",
    json: "#f59e0b",
  };
  return map[ext] ?? "#64748b";
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <button
      v-for="path in results"
      :key="path"
      type="button"
      draggable="true"
      class="flex w-full items-center gap-1.5 rounded px-2.5 py-1.5 text-left text-sm text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200 cursor-grab active:cursor-grabbing"
      :title="path"
      @click="emit('open-file', path)"
      @dragstart="onDragStart(path, $event)"
    >
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{ color: fileColor(path) }"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
      <span class="truncate flex-1">{{ path }}</span>
    </button>
    <div
      v-if="query.trim() && results.length === 0"
      class="px-2.5 py-3 text-center text-xs text-surface-600"
    >
      No matches
    </div>
  </div>
</template>
