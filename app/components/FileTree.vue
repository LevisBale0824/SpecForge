<script setup lang="ts">
import { useProject, type FileNode } from "../composables/useProject";

defineProps<{
  node: FileNode;
  depth?: number;
}>();

const { toggleNode } = useProject();

const emit = defineEmits<{
  "open-file": [path: string];
}>();

function icon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs"].includes(ext)) return "js";
  if (["vue", "svelte"].includes(ext)) return "vue";
  if (["css", "scss", "less"].includes(ext)) return "css";
  if (["md", "mdx"].includes(ext)) return "md";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "cfg";
  if (["py"].includes(ext)) return "py";
  if (["rs"].includes(ext)) return "rs";
  if (["go"].includes(ext)) return "go";
  return "file";
}

const colors: Record<string, string> = {
  js: "text-accent-amber",
  vue: "text-accent-emerald",
  css: "text-accent-cyan",
  md: "text-surface-400",
  cfg: "text-surface-500",
  py: "text-accent-indigo",
  rs: "text-accent-rose",
  go: "text-accent-cyan",
  file: "text-surface-600",
};
</script>

<template>
  <div>
    <!-- Dir entry -->
    <button
      v-if="node.kind === 'directory' && depth !== undefined"
      class="w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-200"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="toggleNode(node)"
    >
      <span class="w-3 text-center text-surface-600 text-[10px]">
        {{ node.expanded ? "▾" : "›" }}
      </span>
      <span class="text-accent-amber">📁</span>
      <span class="truncate flex-1">{{ node.name }}</span>
    </button>

    <!-- File entry -->
    <button
      v-if="node.kind === 'file'"
      class="w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center gap-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-200"
      :style="{ paddingLeft: `${(depth ?? 0) * 12 + 20}px` }"
      @click="emit('open-file', node.path)"
    >
      <span :class="colors[icon(node.name)] ?? 'text-surface-600'">📄</span>
      <span class="truncate flex-1">{{ node.name }}</span>
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
