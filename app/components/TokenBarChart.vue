<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { UsageBar } from "../utils/tokenStats";

const props = withDefaults(
  defineProps<{
    bars: UsageBar[];
    maxBars?: number;
    barCountOptions?: number[];
  }>(),
  {
    maxBars: 20,
    barCountOptions: () => [10, 20, 50],
  },
);

const emit = defineEmits<{
  "update:maxBars": [value: number];
}>();

const { t } = useI18n();

const visibleBars = computed(() => {
  const slice = props.bars.slice(-props.maxBars);
  return slice;
});

const maxToken = computed(() => {
  if (visibleBars.value.length === 0) return 1;
  return Math.max(...visibleBars.value.map((b) => b.tokens), 1);
});

function barHeightPct(tokens: number): number {
  return Math.max((tokens / maxToken.value) * 100, 2);
}

function selectBarCount(n: number) {
  emit("update:maxBars", n);
}
</script>

<template>
  <div class="flex w-full items-center gap-2 overflow-hidden">
    <div class="flex min-w-0 flex-1 items-end gap-[2px]" style="height: 36px">
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
          :title="bar.tokens.toLocaleString() + ' tokens'"
        />
      </template>
    </div>
    <div class="flex flex-shrink-0 items-center gap-0.5 rounded border border-surface-700/60 p-0.5">
      <button
        v-for="opt in barCountOptions"
        :key="opt"
        type="button"
        class="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors"
        :class="
          maxBars === opt
            ? 'bg-accent-emerald/20 text-accent-emerald'
            : 'text-surface-500 hover:text-surface-300'
        "
        :aria-pressed="maxBars === opt"
        @click="selectBarCount(opt)"
      >
        {{ opt }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.token-bar {
  flex: 1 1 0;
  min-width: 2px;
  max-width: 12px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--color-accent-emerald, #34d399) 60%, transparent),
    color-mix(in srgb, var(--color-accent-emerald, #34d399) 90%, transparent)
  );
  transition: height 0.15s ease-out;
}
</style>
