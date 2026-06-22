<script setup lang="ts">
// ---------------------------------------------------------------------------
// ModelPicker
// ---------------------------------------------------------------------------
// Chip + dropdown shown above the input area. Lists only models whose provider
// is in the "connected" set (see useModels.flatModels). Selection is stored
// per-session in memory via useSessionModel. When nothing is selected the
// backend falls back to its configured default model.
// ---------------------------------------------------------------------------

import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useModels } from "../composables/useModels";
import { useSessionModel } from "../composables/useSessionModel";
import type { AvailableModel } from "../composables/useModels";

const props = defineProps<{
  sessionId: string;
}>();

const { t } = useI18n();
const { flatModels, refreshModels } = useModels();
const sessionModel = useSessionModel();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const current = computed(() => sessionModel.getModelForSession(props.sessionId));

const currentLabel = computed(() => {
  const sel = current.value;
  if (!sel) return t("modelPicker.default");
  const match = flatModels.value.find(
    (m) => m.providerId === sel.providerId && m.id === sel.modelId,
  );
  return match?.name ?? sel.modelId;
});

const isEmpty = computed(() => flatModels.value.length === 0);

// Group models by providerName for display.
const groups = computed(() => {
  const map = new Map<string, AvailableModel[]>();
  for (const m of flatModels.value) {
    const key = m.providerName;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  return Array.from(map, ([name, items]) => ({ name, items }));
});

function toggle() {
  if (isEmpty.value) return;
  open.value = !open.value;
}

function pick(m: AvailableModel) {
  sessionModel.setModelForSession(props.sessionId, m.providerId, m.id);
  open.value = false;
}

function clearSelection() {
  sessionModel.clearModelForSession(props.sessionId);
  open.value = false;
}

async function handleRefresh() {
  await refreshModels();
}

// Click-outside close. Lightweight self-contained listener — avoids pulling in
// @vueuse/core just for this one interaction.
function onDocClick(e: MouseEvent) {
  const root = rootRef.value;
  if (!root) return;
  if (!root.contains(e.target as Node)) open.value = false;
}
document.addEventListener("mousedown", onDocClick);
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="rootRef" class="relative inline-block">
    <button
      type="button"
      :disabled="isEmpty"
      :title="isEmpty ? t('modelPicker.empty') : currentLabel"
      class="group inline-flex max-w-[280px] items-center gap-1.5 rounded-full border border-surface-700 bg-surface-800/60 px-2.5 py-1 text-xs text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-700 disabled:hover:text-surface-300"
      @click="toggle"
    >
      <span class="text-[10px] uppercase tracking-wide text-surface-500">
        {{ t("modelPicker.label") }}
      </span>
      <span class="truncate font-medium">{{ currentLabel }}</span>
      <svg
        v-if="!isEmpty"
        class="h-3 w-3 shrink-0 text-surface-500 transition-transform"
        :class="{ 'rotate-180': open }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full left-0 z-30 mb-1.5 max-h-72 w-72 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-xl"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-surface-500"
      >
        <span>{{ t("modelPicker.label") }}</span>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-200"
          @click="handleRefresh"
        >
          {{ t("modelPicker.refresh") }}
        </button>
      </div>

      <!-- Default option (clear) -->
      <button
        type="button"
        class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors"
        :class="
          !current ? 'bg-accent-cyan/10 text-surface-100' : 'text-surface-300 hover:bg-surface-800'
        "
        @click="clearSelection"
      >
        <span class="flex items-center gap-2">
          <span class="text-surface-500">★</span>
          {{ t("modelPicker.default") }}
        </span>
        <svg
          v-if="!current"
          class="h-3.5 w-3.5 text-accent-cyan"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </button>

      <div v-for="group in groups" :key="group.name" class="mt-1">
        <div class="px-3 py-0.5 text-[10px] font-medium uppercase tracking-wide text-surface-600">
          {{ group.name }}
        </div>
        <button
          v-for="m in group.items"
          :key="`${m.providerId}:${m.id}`"
          type="button"
          class="flex w-full items-center justify-between px-3 py-1.5 pl-6 text-left text-sm transition-colors"
          :class="
            current?.providerId === m.providerId && current?.modelId === m.id
              ? 'bg-accent-cyan/10 text-surface-100'
              : 'text-surface-300 hover:bg-surface-800'
          "
          :title="m.id"
          @click="pick(m)"
        >
          <span class="truncate">{{ m.name }}</span>
          <svg
            v-if="current?.providerId === m.providerId && current?.modelId === m.id"
            class="h-3.5 w-3.5 shrink-0 text-accent-cyan"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </button>
      </div>

      <div v-if="isEmpty" class="px-3 py-2 text-xs text-surface-500">
        {{ t("modelPicker.empty") }}
      </div>
    </div>
  </div>
</template>
