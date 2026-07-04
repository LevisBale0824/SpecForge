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

const normalized = computed<NormalizedDiff[]>(() =>
  (props.diffs ?? [])
    .filter((diff) => diff.file)
    .map((diff) => ({ ...diff, ...normalizeStats(diff) })),
);

const patchOnlyFiles = computed(() => {
  const diffFiles = new Set(normalized.value.map((diff) => diff.file));
  return (props.patchFiles ?? []).filter((file) => !diffFiles.has(file));
});

const hasChanges = computed(() => normalized.value.length > 0 || patchOnlyFiles.value.length > 0);

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
      class="diff-item"
      :title="diff.file"
      @click="onOpen(diff)"
    >
      <svg class="diff-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M16 3h5v5M8 3H3v5M21 16v5h-5M3 16v5h5M10 7l4 10M14 7l-4 10" />
      </svg>
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
      class="diff-item patch-only"
      :title="file"
    >
      <svg class="diff-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      </svg>
      <span class="file-basename">{{ basename(file) }}</span>
      <span class="patch-waiting">Waiting</span>
    </div>
  </div>
  <div v-else class="diff-list-empty">No file changes</div>
</template>

<style scoped>
.diff-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.diff-list-empty {
  padding: 2rem 0.5rem;
  text-align: center;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}

.diff-item {
  width: 100%;
  min-height: 32px;
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  padding: 6px 7px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.diff-item:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}

.diff-icon {
  width: 15px;
  height: 15px;
  color: var(--color-surface-500, #64748b);
  stroke-width: 1.8;
}

.file-basename {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
}

.file-status {
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 18%, transparent);
  color: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 68%, var(--color-surface-100));
}

.file-stats {
  display: flex;
  gap: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 800;
}

.stat-add {
  color: color-mix(in srgb, var(--color-accent-emerald, #10b981) 74%, var(--color-surface-100));
}

.stat-del {
  color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 78%, var(--color-surface-100));
}

.patch-only {
  cursor: default;
  opacity: 0.62;
}

.patch-only:hover {
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
}

.patch-waiting {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
}
</style>
