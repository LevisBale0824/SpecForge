<script setup lang="ts">
import { computed } from "vue";
import type { MessageDiffEntry } from "../types/message";
import {
  parseUnifiedDiff,
  sideBySideFromPatch,
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

// Resolve side-by-side pairs.
//
// Priority:
//   1. Patch text (Myers/git diff) → use the hunk structure directly. This
//      matches VSCode exactly because we reuse git's own diff decision
//      instead of re-running LCS over a lossy reconstruction.
//   2. Explicit before/after snapshots → fall back to LCS pairing.
//   3. Empty array (no renderable content).
const pairs = computed<SidePair[]>(() => {
  const diff = normalized.value;

  // 1. Patch-first
  if (diff.diff && diff.diff.trim()) {
    const parsed = parseUnifiedDiff(diff.diff);
    if (parsed.hasHunks) return sideBySideFromPatch(diff.diff);
  }

  // 2. Snapshot fallback
  const hasBefore = typeof diff.before === "string";
  const hasAfter = typeof diff.after === "string";
  if (hasBefore || hasAfter) {
    return sideBySidePair(
      hasBefore ? (diff.before as string) : "",
      hasAfter ? (diff.after as string) : "",
    );
  }

  return [];
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
  /* surface-500 sits in the middle of the scale for both dark and light themes,
     so the gutter stays readable without competing with line content. */
  color: var(--color-surface-500, #71717a);
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
  /* surface-100 is the highest-contrast text token in both modes (lightest on
     dark backgrounds, darkest on light backgrounds). */
  color: var(--color-surface-100, #f4f4f5);
  background: transparent;
}

.cell-added {
  background: color-mix(in srgb, var(--color-accent-emerald, #10b981) 22%, transparent);
  color: var(--color-surface-100, #f4f4f5);
}

.cell-removed {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 22%, transparent);
  color: var(--color-surface-100, #f4f4f5);
}

.cell-empty {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 35%, transparent);
  color: var(--color-surface-500, #71717a);
  font-style: italic;
}

.cell-empty .line-text::before {
  content: "—";
}
</style>
