<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  files: string[];
  query: string;
  selectedIndex: number;
  loading?: boolean;
}>();

const emit = defineEmits<{
  select: [file: string];
  hover: [index: number];
}>();

const filtered = computed<string[]>(() => {
  const q = props.query.trim().toLowerCase();
  const base = q ? props.files.filter((f) => f.toLowerCase().includes(q)) : props.files;
  return base.slice(0, 100);
});

// Split a path into [dirPart, basePart] for highlighting the filename.
function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

const listRef = ref<HTMLElement | null>(null);

watch(
  () => props.selectedIndex,
  async () => {
    await nextTick();
    const list = listRef.value;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${props.selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  },
);

function handleClick(file: string) {
  emit("select", file);
}
</script>

<template>
  <div
    ref="listRef"
    class="file-menu absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 shadow-xl"
  >
    <div v-if="loading" class="px-3 py-2 text-xs text-surface-500">Loading files…</div>
    <div v-else-if="filtered.length === 0" class="px-3 py-2 text-xs text-surface-500">
      <template v-if="files.length === 0">No files found</template>
      <template v-else>No matching files</template>
    </div>
    <button
      v-for="(file, index) in filtered"
      v-else
      :key="file"
      :data-index="index"
      :title="file"
      type="button"
      class="flex w-full items-baseline gap-1 px-3 py-1.5 text-left transition-colors min-w-0"
      :class="
        index === selectedIndex
          ? 'bg-accent-cyan/10 text-surface-100'
          : 'text-surface-300 hover:bg-surface-800'
      "
      @click="handleClick(file)"
      @mouseenter="emit('hover', index)"
    >
      <span class="font-mono text-sm text-accent-cyan flex-shrink-0">@</span>
      <!-- min-w-0 + flex-1 lets the path truncate inside flex; without it the
           long path pushes the menu wider than the viewport. dir is dimmed so
           when truncation kicks in the basename stays the most visible part. -->
      <span class="font-mono text-sm truncate min-w-0 flex-1">
        <span class="text-surface-500">{{ splitPath(file).dir }}</span>
        <span class="text-surface-100">{{ splitPath(file).base }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.file-menu {
  z-index: 20;
}
</style>
