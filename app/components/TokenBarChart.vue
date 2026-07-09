<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { TokenSegments, UsageBar } from "../utils/tokenStats";

const props = defineProps<{
  bars: UsageBar[];
}>();

const { t } = useI18n();

const visibleBars = computed(() => props.bars.slice(-50));

const maxToken = computed(() => {
  if (visibleBars.value.length === 0) return 1;
  return Math.max(...visibleBars.value.map((b) => b.tokens), 1);
});

function barHeightPct(tokens: number): number {
  return Math.max((tokens / maxToken.value) * 100, 2);
}

const SEGMENT_KEYS: Array<{ key: keyof TokenSegments }> = [
  { key: "cache" },
  { key: "input" },
  { key: "reasoning" },
  { key: "output" },
];

function segmentsOf(bar: UsageBar) {
  const seg = bar.segments;
  return SEGMENT_KEYS.map((s) => ({
    key: s.key,
    heightPct: bar.tokens > 0 && seg ? (seg[s.key] / bar.tokens) * 100 : 0,
  }));
}

function barTooltip(bar: UsageBar): string {
  const s = bar.segments ?? { input: 0, output: 0, reasoning: 0, cache: 0 };
  const parts = [`${bar.tokens.toLocaleString()} ${t("chat.tokenUsage.tokens")}`];
  if (s.input > 0) parts.push(`${t("chat.tokenUsage.input")} ${s.input.toLocaleString()}`);
  if (s.output > 0) parts.push(`${t("chat.tokenUsage.output")} ${s.output.toLocaleString()}`);
  if (s.reasoning > 0)
    parts.push(`${t("chat.tokenUsage.reasoning")} ${s.reasoning.toLocaleString()}`);
  if (s.cache > 0) parts.push(`${t("chat.tokenUsage.cache")} ${s.cache.toLocaleString()}`);
  return parts.join(" · ");
}
</script>

<template>
  <div class="flex w-full items-end gap-[3px] overflow-hidden" style="height: 48px">
    <template v-if="visibleBars.length === 0">
      <span class="self-center text-[10px] text-surface-600">
        {{ t("chat.tokenUsage.emptyState") }}
      </span>
    </template>
    <template v-else>
      <div
        v-for="bar in visibleBars"
        :key="bar.messageId"
        class="token-bar"
        :style="{ height: barHeightPct(bar.tokens) + '%' }"
        :title="barTooltip(bar)"
      >
        <div
          v-for="seg in segmentsOf(bar)"
          :key="seg.key"
          class="token-seg"
          :class="'seg-' + seg.key"
          :style="{ height: seg.heightPct + '%' }"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.token-bar {
  flex: 1 1 0;
  min-width: 2px;
  max-width: 14px;
  border-radius: 2px 2px 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  transition:
    height 0.15s ease-out,
    filter 0.15s ease-out;
}
.token-bar:hover {
  filter: brightness(1.3);
}
.token-seg {
  width: 100%;
  flex-shrink: 0;
}
.seg-output {
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 95%, transparent);
}
.seg-reasoning {
  background: color-mix(in srgb, var(--color-accent-indigo, #818cf8) 80%, transparent);
}
.seg-input {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 65%, transparent);
}
.seg-cache {
  background: color-mix(in srgb, var(--color-surface-600, #52525b) 45%, transparent);
}
</style>
