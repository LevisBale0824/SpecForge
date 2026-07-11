<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MessageDiffEntry } from "../types/message";
import { useMessages } from "../composables/useMessages";
import { extractEditDiffs } from "./ToolWindow/utils";
import DiffViewer from "./DiffViewer.vue";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const msgStore = useMessages();

function countLines(patch: string, sign: string): number {
  if (!patch) return 0;
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith(sign) && !line.startsWith(sign + sign)) count += 1;
  }
  return count;
}

// Aggregate file diffs from edit-family tool calls in the session. The
// opencode /session/{id}/diff endpoint returns empty in practice, so we build
// the session-level view directly from the tool inputs already in the store.
type FileGroup = {
  file: string;
  entries: MessageDiffEntry[];
  additions: number;
  deletions: number;
};

const fileGroups = computed<FileGroup[]>(() => {
  void msgStore.contentVersion.value;
  const sessionId = props.sessionId;
  if (!sessionId) return [];

  const messages = msgStore.list().filter((m) => m.sessionID === sessionId);
  const byFile = new Map<string, MessageDiffEntry[]>();

  for (const msg of messages) {
    const parts = msgStore.getParts(msg.id);
    for (const part of parts) {
      if (part.type !== "tool") continue;
      if (part.state.status === "pending") continue;
      const diffs = extractEditDiffs(part.tool, part.state.input);
      if (!diffs) continue;
      for (const d of diffs) {
        const baseFile = d.file.replace(/#\d+$/, "");
        const existing = byFile.get(baseFile);
        if (existing) existing.push(d);
        else byFile.set(baseFile, [d]);
      }
    }
  }

  const groups: FileGroup[] = [];
  for (const [file, entries] of byFile) {
    let additions = 0;
    let deletions = 0;
    for (const d of entries) {
      additions += d.additions ?? countLines(d.diff, "+");
      deletions += d.deletions ?? countLines(d.diff, "-");
    }
    groups.push({ file, entries, additions, deletions });
  }
  return groups;
});

const totalAdditions = computed(() => fileGroups.value.reduce((s, g) => s + g.additions, 0));
const totalDeletions = computed(() => fileGroups.value.reduce((s, g) => s + g.deletions, 0));

const expanded = ref<Set<string>>(new Set());

watch(
  () => fileGroups.value.map((g) => g.file),
  (files) => {
    const next = new Set<string>();
    for (const f of files) {
      if (expanded.value.has(f)) next.add(f);
    }
    if (next.size === 0 && files.length > 0) next.add(files[0]);
    expanded.value = next;
  },
  { immediate: true },
);

function toggle(file: string) {
  const next = new Set(expanded.value);
  if (next.has(file)) next.delete(file);
  else next.add(file);
  expanded.value = next;
}

function expandAll() {
  expanded.value = new Set(fileGroups.value.map((g) => g.file));
}

function collapseAll() {
  expanded.value = new Set();
}

function basename(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || file;
}

function dirname(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}
</script>

<template>
  <aside class="session-diff-panel">
    <header class="sdp-header">
      <div class="sdp-title-row">
        <svg
          class="sdp-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M16 3h5v5M8 3H3v5M21 16v5h-5M3 16v5h5M10 7l4 10M14 7l-4 10" />
        </svg>
        <span class="sdp-title">文件变更</span>
        <span class="sdp-file-count">{{ fileGroups.length }}</span>
        <div class="sdp-totals">
          <span class="sdp-add">+{{ totalAdditions }}</span>
          <span class="sdp-del">−{{ totalDeletions }}</span>
        </div>
        <button
          v-if="fileGroups.length > 1"
          type="button"
          class="sdp-expand-btn"
          title="全部展开"
          @click="expandAll"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="7 13 12 18 17 13" />
            <polyline points="7 6 12 11 17 6" />
          </svg>
        </button>
        <button
          v-if="expanded.size > 0"
          type="button"
          class="sdp-expand-btn"
          title="全部折叠"
          @click="collapseAll"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="17 11 12 6 7 11" />
            <polyline points="17 18 12 13 7 18" />
          </svg>
        </button>
        <button type="button" class="sdp-close-btn" title="关闭" @click="emit('close')">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </header>

    <div class="sdp-body">
      <div v-if="fileGroups.length === 0" class="sdp-empty">当前会话暂无文件变更</div>
      <template v-else>
        <div v-for="g in fileGroups" :key="g.file" class="sdp-file">
          <button
            type="button"
            class="sdp-file-header"
            :class="{ expanded: expanded.has(g.file) }"
            :title="g.file"
            @click="toggle(g.file)"
          >
            <span class="sdp-chevron">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span class="sdp-file-info">
              <span class="sdp-file-basename">{{ basename(g.file) }}</span>
              <span v-if="dirname(g.file)" class="sdp-file-dirname">{{ dirname(g.file) }}</span>
            </span>
            <span v-if="g.entries.length > 1" class="sdp-edit-count"
              >{{ g.entries.length }}× 编辑</span
            >
            <span class="sdp-file-stats">
              <span class="sdp-stat-add">+{{ g.additions }}</span>
              <span class="sdp-stat-del">−{{ g.deletions }}</span>
            </span>
          </button>
          <div v-if="expanded.has(g.file)" class="sdp-diff-container">
            <div v-for="(d, idx) in g.entries" :key="idx" class="sdp-diff-block">
              <div v-if="g.entries.length > 1" class="sdp-diff-block-label">
                编辑 #{{ idx + 1 }}
              </div>
              <DiffViewer :diff="d" />
            </div>
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.session-diff-panel {
  display: flex;
  flex-direction: column;
  width: 440px;
  flex-shrink: 0;
  border-left: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent);
  background: color-mix(in srgb, var(--color-surface-950, #020617) 80%, transparent);
  overflow: hidden;
}

.sdp-header {
  flex-shrink: 0;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 92%, transparent);
}

.sdp-title-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.sdp-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--color-surface-400, #94a3b8);
  stroke-width: 1.8;
}

.sdp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-surface-200, #e2e8f0);
  white-space: nowrap;
}

.sdp-file-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 60%, transparent);
  color: var(--color-surface-300, #cbd5e1);
}

.sdp-totals {
  display: inline-flex;
  gap: 0.35rem;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sdp-add {
  color: color-mix(in srgb, var(--color-accent-emerald, #10b981) 80%, var(--color-surface-100));
}

.sdp-del {
  color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 80%, var(--color-surface-100));
}

.sdp-expand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.sdp-expand-btn:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
  color: var(--color-surface-300, #cbd5e1);
}

.sdp-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.sdp-close-btn:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.sdp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.35rem;
}

.sdp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  font-size: 12px;
  color: var(--color-surface-600, #475569);
}

.sdp-file {
  margin-bottom: 2px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid transparent;
}

.sdp-file-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.12s ease;
}

.sdp-file-header:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 40%, transparent);
}

.sdp-file-header.expanded {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}

.sdp-chevron {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-surface-500, #64748b);
  transition: transform 0.15s ease;
}

.sdp-file-header.expanded .sdp-chevron {
  transform: rotate(90deg);
}

.sdp-file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  gap: 1px;
}

.sdp-file-basename {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-surface-200, #e2e8f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdp-file-dirname {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  color: var(--color-surface-600, #475569);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdp-edit-count {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--color-surface-600, #475569);
  white-space: nowrap;
}

.sdp-file-stats {
  display: inline-flex;
  gap: 0.35rem;
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sdp-stat-add {
  color: color-mix(in srgb, var(--color-accent-emerald, #10b981) 75%, var(--color-surface-100));
}

.sdp-stat-del {
  color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 75%, var(--color-surface-100));
}

.sdp-diff-container {
  border: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  overflow: hidden;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.sdp-diff-block {
  display: flex;
  flex-direction: column;
}

.sdp-diff-block + .sdp-diff-block {
  border-top: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
}

.sdp-diff-block-label {
  padding: 0.25rem 0.55rem;
  font-size: 9px;
  font-weight: 600;
  color: var(--color-surface-500, #64748b);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 80%, transparent);
}

.sdp-diff-container :deep(.diff-viewer) {
  height: auto;
  max-height: 400px;
}

.sdp-diff-container :deep(.diff-inline) {
  max-height: 360px;
}
</style>
