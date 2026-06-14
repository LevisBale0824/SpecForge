<script setup lang="ts">
import { computed } from "vue";
import type { MessageDiffEntry } from "../types/message";

const props = defineProps<{
  diffs?: MessageDiffEntry[];
  patchFiles?: string[];
}>();

type NormalizedDiff = MessageDiffEntry & {
  additions: number;
  deletions: number;
  status?: string;
};

function normalizeStats(diff: MessageDiffEntry): {
  additions: number;
  deletions: number;
} {
  if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
    return { additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 };
  }
  const source = diff.diff || "";
  let additions = 0;
  let deletions = 0;
  for (const line of source.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

const emit = defineEmits<{
  "open-diff": [diff: MessageDiffEntry];
}>();

const normalized = computed<NormalizedDiff[]>(
  () =>
    (props.diffs ?? [])
      .filter((diff) => diff.file)
      .map((diff) => ({ ...diff, ...normalizeStats(diff) })),
);

const patchOnlyFiles = computed(() => {
  const diffFiles = new Set(normalized.value.map((diff) => diff.file));
  return (props.patchFiles ?? []).filter((file) => !diffFiles.has(file));
});

const hasChanges = computed(
  () => normalized.value.length > 0 || patchOnlyFiles.value.length > 0,
);

function basename(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || file;
}

function statusLabel(diff: NormalizedDiff): string {
  if (diff.status === "added") return "NEW";
  if (diff.status === "deleted") return "DEL";
  return "";
}

function onOpen(diff: NormalizedDiff) {
  emit("open-diff", diff);
}
</script>

<template>
  <div v-if="hasChanges" class="diff-list">
    <button
      v-for="diff in normalized"
      :key="diff.file"
      type="button"
      class="file-item"
      :title="diff.file"
      @click="onOpen(diff)"
    >
      <span class="file-basename">{{ basename(diff.file) }}</span>
      <span v-if="statusLabel(diff)" class="file-status">{{ statusLabel(diff) }}</span>
      <span class="file-stats">
        <span class="stat-add">+{{ diff.additions }}</span>
        <span class="stat-del">-{{ diff.deletions }}</span>
      </span>
    </button>
    <div
      v-for="file in patchOnlyFiles"
      :key="`patch-${file}`"
      class="file-item patch-only"
      :title="file"
    >
      <span class="file-basename">{{ basename(file) }}</span>
      <span class="patch-waiting">等待 diff</span>
    </div>
  </div>
  <div v-else class="diff-list-empty">No file changes</div>
</template>

<style scoped>
.diff-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.diff-list-empty {
  padding: 2rem 0.5rem;
  text-align: center;
  font-size: 12px;
  color: var(--color-surface-600);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-surface-300);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.file-item:hover {
  background: color-mix(in srgb, var(--color-surface-800) 70%, transparent);
  color: var(--color-surface-100);
}

.file-basename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.file-status {
  flex: 0 0 auto;
  padding: 0 0.3rem;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--color-accent-amber) 22%, transparent);
  color: var(--color-accent-amber);
}

.file-stats {
  flex: 0 0 auto;
  display: flex;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-size: 10px;
}

.stat-add {
  color: var(--color-accent-emerald);
}

.stat-del {
  color: var(--color-accent-rose);
}

.patch-only {
  cursor: default;
  opacity: 0.55;
}

.patch-only:hover {
  background: transparent;
  color: var(--color-surface-300);
}

.patch-waiting {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--color-surface-500);
}
</style>
