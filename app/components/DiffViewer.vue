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

// Content-based cache: fileGroups creates new MessageDiffEntry objects on
// every contentVersion bump, but the actual before/after/patch strings are
// identical (tool inputs are set once when the call starts). Without this
// cache, LCS O(m×n) runs on every token batch during streaming.
let _diffContentKey = "";
let _cachedPairs: SidePair[] = [];

function resolvePairs(diff: MessageDiffEntry): SidePair[] {
  if (diff.diff && diff.diff.trim()) {
    const parsed = parseUnifiedDiff(diff.diff);
    if (parsed.hasHunks) return sideBySideFromPatch(diff.diff);
  }
  const hasBefore = typeof diff.before === "string";
  const hasAfter = typeof diff.after === "string";
  if (hasBefore || hasAfter) {
    return sideBySidePair(
      hasBefore ? (diff.before as string) : "",
      hasAfter ? (diff.after as string) : "",
    );
  }
  return [];
}

const pairs = computed<SidePair[]>(() => {
  const diff = props.diff;
  const contentKey = `${diff.diff}\0${diff.before ?? ""}\0${diff.after ?? ""}`;
  if (contentKey === _diffContentKey) return _cachedPairs;
  _diffContentKey = contentKey;
  _cachedPairs = resolvePairs(diff);
  return _cachedPairs;
});

// Count additions/deletions from the SAME pairs we render, not from backend-
// supplied stats. Backend stats are frequently 0 even when a patch carries
// real +/- lines (snapshot-backed diffs, partial metadata), which previously
// showed "+0 −0" beside visible red/green rows. Deriving from pairs keeps the
// legend count and the rendered rows in lockstep.
const additions = computed(() => pairs.value.filter((p) => p.kind === "added").length);
const deletions = computed(() => pairs.value.filter((p) => p.kind === "removed").length);

// Inline (vertical) rows: drop unchanged context (it only adds noise — the
// line numbers on each changed row already pinpoint where the edit happened),
// then flatten to one row per changed line. Removed lines (编辑前, rose) sit
// above added lines (编辑后, emerald) within each hunk because unified diffs
// emit `-` runs before `+` runs.
type InlineRow = { kind: "removed" | "added"; no?: number; text: string };

const inlineRows = computed<InlineRow[]>(() =>
  pairs.value
    .filter((p) => p.kind === "removed" || p.kind === "added")
    .map((p) =>
      p.kind === "removed"
        ? { kind: "removed", no: p.left?.no, text: p.left?.text ?? "" }
        : { kind: "added", no: p.right?.no, text: p.right?.text ?? "" },
    ),
);
</script>

<template>
  <div class="diff-viewer">
    <div v-if="pairs.length === 0" class="diff-empty">此文件有变更，但后端未提供可对比的内容。</div>
    <div v-else class="diff-inline">
      <!-- Color legend: makes the before/after semantics explicit since the
           vertical layout no longer carries 原文件/修改后 column labels. -->
      <div class="diff-legend">
        <span class="legend-item legend-removed">− 编辑前</span>
        <span class="legend-item legend-added">+ 编辑后</span>
        <span class="legend-stats">
          <span class="stat-add">+{{ additions }}</span>
          <span class="stat-del">−{{ deletions }}</span>
        </span>
      </div>

      <div
        v-for="(row, idx) in inlineRows"
        :key="idx"
        class="diff-row"
        :class="row.kind === 'removed' ? 'row-removed' : 'row-added'"
      >
        <span class="row-sign">{{ row.kind === "removed" ? "−" : "+" }}</span>
        <span class="line-no">{{ row.no ?? "" }}</span>
        <span class="line-text">{{ row.text }}</span>
      </div>
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

.diff-inline {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
}

/* Sticky legend so the color meaning stays visible while scrolling long hunks. */
.diff-legend {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.3rem 0.6rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 95%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.legend-removed {
  color: var(--color-accent-rose, #f43f5e);
}
.legend-added {
  color: var(--color-accent-emerald, #10b981);
}
.legend-stats {
  margin-left: auto;
  display: inline-flex;
  gap: 0.5rem;
}
.stat-add {
  color: var(--color-accent-emerald, #10b981);
}
.stat-del {
  color: var(--color-accent-rose, #f43f5e);
}

.diff-row {
  display: grid;
  grid-template-columns: 1.5ch 4ch 1fr;
  align-items: start;
  padding-right: 0.4rem;
  min-height: 1.6em;
}

.row-sign {
  text-align: center;
  user-select: none;
  font-weight: 700;
}

.line-no {
  text-align: right;
  padding-right: 0.5ch;
  color: var(--color-surface-500, #71717a);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.line-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-left: 0.4ch;
}

.row-removed {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 20%, transparent);
  color: var(--color-surface-100, #f4f4f5);
}
.row-removed .row-sign {
  color: var(--color-accent-rose, #f43f5e);
}

.row-added {
  background: color-mix(in srgb, var(--color-accent-emerald, #10b981) 20%, transparent);
  color: var(--color-surface-100, #f4f4f5);
}
.row-added .row-sign {
  color: var(--color-accent-emerald, #10b981);
}
</style>
