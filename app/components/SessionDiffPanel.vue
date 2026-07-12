<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FileDiff } from "../types/sse";
import type { MessageDiffEntry } from "../types/message";
import { useMessages } from "../composables/useMessages";
import { useDiffPanel } from "../composables/useDiffPanel";
import { useBackend } from "../composables/useBackend";
import { extractEditDiffs, toolActivitySignature } from "./ToolWindow/utils";
import { sideBySidePair } from "../utils/parseDiff";
import DiffViewer from "./DiffViewer.vue";

const props = defineProps<{
  sessionId: string;
  visible?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  close: [];
}>();

const { showDiffPanel } = useDiffPanel();
const msgStore = useMessages();
const backend = useBackend();

// Track whether workspace diffs have been loaded (even if empty).
const wsLoadCount = ref(0);
watch(
  () => backend.workspaceDiffs.value,
  () => {
    wsLoadCount.value++;
  },
);

// Trigger git diff refresh when the panel opens.
watch(
  () => props.visible && showDiffPanel.value,
  (active) => {
    if (active) backend.scheduleWorkspaceDiffRefresh(0);
  },
  { immediate: true },
);

function countLines(patch: string, sign: string): number {
  if (!patch) return 0;
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith(sign) && !line.startsWith(sign + sign)) count += 1;
  }
  return count;
}

// Convert workspace FileDiff into the MessageDiffEntry shape the DiffViewer expects.
function toMessageDiffEntry(d: FileDiff): MessageDiffEntry {
  return {
    file: d.file,
    before: d.before,
    after: d.after,
    diff: d.patch,
    additions: d.additions,
    deletions: d.deletions,
  };
}

type FileGroup = {
  file: string;
  entries: MessageDiffEntry[];
  additions: number;
  deletions: number;
};

// Build file groups from workspace diffs (git status / diff HEAD).
// Falls back to tool-call diffs when git data is unavailable.
const fileGroups = computed<FileGroup[]>(() => {
  if (!showDiffPanel.value || props.visible === false) return [];

  void wsLoadCount.value;
  const wsDiffs = backend.workspaceDiffs.value as FileDiff[];
  if (wsDiffs.length > 0 || wsLoadCount.value > 0) {
    return wsDiffs.map((d) => ({
      file: d.file,
      entries: [toMessageDiffEntry(d)],
      additions: d.additions,
      deletions: d.deletions,
    }));
  }

  // No git data — fall back to tool-call diffs from the session.
  const sessionId = props.sessionId;
  if (!sessionId) return [];

  void msgStore.contentVersion.value;
  const sig = toolActivitySignature(msgStore.list, msgStore.getParts, sessionId);
  if (sig === _toolSig) return _cachedGroups;
  _toolSig = sig;
  _cachedGroups = computeFileGroups(sessionId);
  return _cachedGroups;
});

let _toolSig = "";
let _cachedGroups: FileGroup[] = [];

function computeFileGroups(sessionId: string): FileGroup[] {
  const byFile = new Map<string, MessageDiffEntry[]>();
  for (const msg of msgStore.list().filter((m) => m.sessionID === sessionId)) {
    for (const part of msgStore.getParts(msg.id)) {
      if (part.type !== "tool") continue;
      if (part.state.status === "pending") continue;
      const diffs = extractEditDiffs(part.tool, part.state.input);
      if (!diffs) continue;
      for (const d of diffs) {
        const base = d.file.replace(/#\d+$/, "");
        const existing = byFile.get(base);
        if (existing) existing.push(d);
        else byFile.set(base, [d]);
      }
    }
  }
  const groups: FileGroup[] = [];
  for (const [file, entries] of byFile) {
    let adds = 0;
    let dels = 0;
    for (const d of entries) {
      if (d.additions != null && d.deletions != null) {
        adds += d.additions;
        dels += d.deletions;
      } else if (d.diff) {
        adds += countLines(d.diff, "+");
        dels += countLines(d.diff, "-");
      } else {
        const hasB = typeof d.before === "string";
        const hasA = typeof d.after === "string";
        if (hasB || hasA) {
          const pairs = sideBySidePair(
            hasB ? (d.before as string) : "",
            hasA ? (d.after as string) : "",
          );
          adds += pairs.filter((p) => p.kind === "added").length;
          dels += pairs.filter((p) => p.kind === "removed").length;
        }
      }
    }
    groups.push({ file, entries, additions: adds, deletions: dels });
  }
  return groups;
}

const totalAdditions = computed(() => fileGroups.value.reduce((s, g) => s + g.additions, 0));
const totalDeletions = computed(() => fileGroups.value.reduce((s, g) => s + g.deletions, 0));

const expanded = ref<Set<string>>(new Set());

watch(
  () => fileGroups.value.map((g) => g.file).join("\n"),
  (filesKey) => {
    const files = filesKey ? filesKey.split("\n") : [];
    const next = new Set<string>();
    for (const f of files) {
      if (expanded.value.has(f)) next.add(f);
    }
    if (next.size === 0 && files.length > 0) {
      for (const f of files) next.add(f);
    }
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

const allExpanded = computed(
  () => fileGroups.value.length > 0 && expanded.value.size >= fileGroups.value.length,
);

function toggleExpandAll() {
  if (allExpanded.value) collapseAll();
  else expandAll();
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
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="10" x2="16" y2="10" />
          <line x1="12" y1="6" x2="12" y2="14" />
          <line x1="8" y1="17" x2="16" y2="17" />
        </svg>
        <span class="sdp-title">审查</span>
        <span class="sdp-file-count">{{ fileGroups.length }}</span>
        <div class="sdp-totals">
          <span class="sdp-add">+{{ totalAdditions }}</span>
          <span class="sdp-del">−{{ totalDeletions }}</span>
        </div>
        <button
          v-if="fileGroups.length > 1"
          type="button"
          class="sdp-expand-btn"
          :title="allExpanded ? '全部折叠' : '全部展开'"
          @click="toggleExpandAll"
        >
          <svg
            v-if="allExpanded"
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
          <svg
            v-else
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
      <div v-if="fileGroups.length === 0" class="sdp-empty">当前工作目录无变更</div>
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
  height: 100%;
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
  width: 18px;
  height: 18px;
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
