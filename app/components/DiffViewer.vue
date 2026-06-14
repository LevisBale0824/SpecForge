<script setup lang="ts">
import { computed } from "vue";
import type { MessageDiffEntry } from "../types/message";
import {
  parseUnifiedDiff,
  reconstructFromPatch,
  sideBySidePair,
  type SidePair,
} from "../utils/parseDiff";

const props = defineProps<{
  diff: MessageDiffEntry;
}>();

type NormalizedDiff = MessageDiffEntry & {
  additions: number;
  deletions: number;
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

const normalized = computed<NormalizedDiff>(() => ({
  ...props.diff,
  ...normalizeStats(props.diff),
}));

// Resolve before/after snapshots. Prefer explicit snapshots (treating a
// missing side as an empty string so brand-new / deleted files still render);
// otherwise reconstruct from the patch text. Returns null only when we have
// neither snapshots nor a parseable patch.
const snapshots = computed<{ before: string; after: string } | null>(() => {
  const diff = normalized.value;
  const hasBefore = typeof diff.before === "string";
  const hasAfter = typeof diff.after === "string";
  if (hasBefore || hasAfter) {
    return {
      before: hasBefore ? (diff.before as string) : "",
      after: hasAfter ? (diff.after as string) : "",
    };
  }
  if (diff.diff && diff.diff.trim()) {
    const parsed = parseUnifiedDiff(diff.diff);
    if (parsed.hasHunks) return reconstructFromPatch(diff.diff);
  }
  return null;
});

const pairs = computed<SidePair[]>(() => {
  const snap = snapshots.value;
  if (!snap) return [];
  return sideBySidePair(snap.before, snap.after);
});

function leftCellClass(p: SidePair): string {
  if (p.kind === "removed") return "cell-removed";
  if (p.kind === "added") return "cell-empty";
  return "cell-context";
}

function rightCellClass(p: SidePair): string {
  if (p.kind === "added") return "cell-added";
  if (p.kind === "removed") return "cell-empty";
  return "cell-context";
}
</script>

<template>
  <div class="diff-viewer">
    <div v-if="pairs.length === 0" class="diff-empty">此文件有变更，但后端未提供可对比的内容。</div>
    <div v-else class="diff-grid">
      <!-- Column headers -->
      <div class="col-header">原文件</div>
      <div class="col-header">修改后</div>

      <!-- Scrollable paired rows -->
      <template v-for="(pair, idx) in pairs" :key="idx">
        <div class="cell" :class="leftCellClass(pair)">
          <span class="line-no">{{ pair.left?.no ?? "" }}</span>
          <span class="line-text">{{ pair.left?.text ?? "" }}</span>
        </div>
        <div class="cell" :class="rightCellClass(pair)">
          <span class="line-no">{{ pair.right?.no ?? "" }}</span>
          <span class="line-text">{{ pair.right?.text ?? "" }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 60%, transparent);
}

.diff-empty {
  padding: 2rem 1rem;
  text-align: center;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}

.diff-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: min-content;
  overflow: auto;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
}

.col-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.35rem 0.6rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-surface-400, #94a3b8);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 95%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.col-header:first-child {
  border-right: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.cell {
  display: grid;
  grid-template-columns: 4ch 1fr;
  align-items: start;
  padding-right: 0.4rem;
  min-height: 1.6em;
}

.cell .line-no {
  text-align: right;
  padding-right: 0.5ch;
  color: var(--color-surface-600, #475569);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.cell .line-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-left: 0.4ch;
}

/* Left column gets a right border so the two columns are visually separated */
.cell:nth-child(odd):not(.col-header) {
  border-right: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}

.cell-context {
  color: var(--color-surface-300, #cbd5e1);
  background: transparent;
}

.cell-added {
  background: color-mix(in srgb, var(--color-accent-emerald, #10b981) 16%, transparent);
  color: #aff5b4;
}

.cell-removed {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 16%, transparent);
  color: #ffdcd7;
}

.cell-empty {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 35%, transparent);
  color: var(--color-surface-600, #475569);
  font-style: italic;
}

.cell-empty .line-text::before {
  content: "—";
}
</style>
