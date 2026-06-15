<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { CommandInfo } from "../types/command";

const props = defineProps<{
  commands: CommandInfo[];
  query: string;
  selectedIndex: number;
}>();

const emit = defineEmits<{
  select: [command: CommandInfo];
  hover: [index: number];
}>();

// query is the text after "/", e.g. "ops" for "/ops". Filter by id or name.
const filtered = computed<CommandInfo[]>(() => {
  const q = props.query.trim().toLowerCase();
  if (!q) return props.commands;
  return props.commands.filter((c) => {
    const id = c.id.toLowerCase();
    const name = (c.name ?? "").toLowerCase();
    return id.includes(q) || name.includes(q);
  });
});

const listRef = ref<HTMLElement | null>(null);

// Keep the highlighted item in view when navigating with the keyboard.
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

function handleClick(command: CommandInfo) {
  emit("select", command);
}
</script>

<template>
  <div
    v-if="filtered.length > 0"
    ref="listRef"
    class="command-menu absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 shadow-xl"
  >
    <button
      v-for="(command, index) in filtered"
      :key="command.id"
      :data-index="index"
      type="button"
      class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors"
      :class="
        index === selectedIndex
          ? 'bg-accent-cyan/10 text-surface-100'
          : 'text-surface-300 hover:bg-surface-800'
      "
      @click="handleClick(command)"
      @mouseenter="emit('hover', index)"
    >
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm text-accent-cyan">/{{ command.id }}</span>
        <span
          v-if="command.category"
          class="rounded bg-surface-800 px-1.5 text-[10px] text-surface-500"
        >
          {{ command.category }}
        </span>
      </div>
      <span v-if="command.description" class="text-xs text-surface-500 line-clamp-1">
        {{ command.description }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.command-menu {
  z-index: 20;
}
</style>
