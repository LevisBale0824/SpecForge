<script setup lang="ts">
// ---------------------------------------------------------------------------
// AgentPicker
// ---------------------------------------------------------------------------
// Chip + dropdown shown next to ModelPicker above the input area. Lists only
// agents whose mode is "primary" and not hidden (see useAgents.selectableAgents).
// Selection is stored per-session in memory via useSessionAgent. When nothing
// is selected the backend falls back to its default agent (typically
// "general" — see useBackendMessageSend).
// ---------------------------------------------------------------------------

import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAgents } from "../composables/useAgents";
import { useSessionAgent } from "../composables/useSessionAgent";

const props = defineProps<{
  sessionId: string;
}>();

const { t } = useI18n();
const { selectableAgents, refreshAgents } = useAgents();
const sessionAgent = useSessionAgent();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const filter = ref("");

const current = computed(() => sessionAgent.getAgentForSession(props.sessionId));

const currentLabel = computed(() => {
  const name = current.value;
  if (!name) return t("agentPicker.default");
  return name;
});

const currentColor = computed(() => {
  const name = current.value;
  if (!name) return null;
  return selectableAgents.value.find((a) => a.name === name)?.color ?? null;
});

const isEmpty = computed(() => selectableAgents.value.length === 0);

// Local filter by name/description. The list is short (dozens) so a simple
// includes() scan on each keystroke is fine — no need to debounce.
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return selectableAgents.value;
  return selectableAgents.value.filter(
    (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
  );
});

function toggle() {
  if (isEmpty.value) return;
  open.value = !open.value;
  if (open.value) filter.value = "";
}

function pick(name: string) {
  sessionAgent.setAgentForSession(props.sessionId, name);
  open.value = false;
}

function clearSelection() {
  sessionAgent.clearAgentForSession(props.sessionId);
  open.value = false;
}

async function handleRefresh() {
  await refreshAgents();
}

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
      :title="isEmpty ? t('agentPicker.empty') : currentLabel"
      class="group inline-flex max-w-[280px] items-center gap-1.5 rounded-full border border-surface-700 bg-surface-800/60 px-2.5 py-1 text-xs text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-700 disabled:hover:text-surface-300"
      @click="toggle"
    >
      <span
        v-if="currentColor"
        class="inline-block h-2 w-2 shrink-0 rounded-full"
        :style="{ backgroundColor: currentColor }"
      />
      <span class="text-[10px] uppercase tracking-wide text-surface-500">
        {{ t("agentPicker.label") }}
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
      class="absolute bottom-full left-0 z-30 mb-1.5 flex max-h-80 w-80 flex-col overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-xl"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-surface-500"
      >
        <span>{{ t("agentPicker.label") }}</span>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-200"
          @click="handleRefresh"
        >
          {{ t("agentPicker.refresh") }}
        </button>
      </div>

      <!-- Filter input -->
      <div class="px-2 pb-1">
        <input
          v-model="filter"
          type="text"
          :placeholder="t('agentPicker.search')"
          class="w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-surface-200 placeholder:text-surface-600 focus:border-accent-cyan/50 focus:outline-none"
          @keydown.esc="open = false"
        />
      </div>

      <div class="flex-1 overflow-y-auto">
        <!-- Default option (clear) -->
        <button
          type="button"
          class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors"
          :class="
            !current
              ? 'bg-accent-cyan/10 text-surface-100'
              : 'text-surface-300 hover:bg-surface-800'
          "
          @click="clearSelection"
        >
          <span class="flex items-center gap-2">
            <span class="text-surface-500">★</span>
            {{ t("agentPicker.default") }}
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

        <!-- Agent list -->
        <button
          v-for="a in filtered"
          :key="a.name"
          type="button"
          class="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors"
          :class="
            current === a.name
              ? 'bg-accent-cyan/10 text-surface-100'
              : 'text-surface-300 hover:bg-surface-800'
          "
          :title="a.description"
          @click="pick(a.name)"
        >
          <span
            v-if="a.color"
            class="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: a.color }"
          />
          <span v-else class="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-surface-600" />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex items-center gap-1.5">
              <span class="truncate font-medium">{{ a.name }}</span>
              <span
                v-if="!a.native"
                class="rounded bg-surface-800 px-1 text-[9px] uppercase text-surface-500"
              >
                custom
              </span>
            </span>
            <span v-if="a.description" class="truncate text-xs text-surface-500">
              {{ a.description }}
            </span>
          </span>
          <svg
            v-if="current === a.name"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-cyan"
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

        <div v-if="filtered.length === 0" class="px-3 py-2 text-xs text-surface-500">
          {{ filter ? t("agentPicker.noMatch") : t("agentPicker.empty") }}
        </div>
      </div>
    </div>
  </div>
</template>
