<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import { useUpdate } from "../composables/useUpdate";
import { useDiffPanel } from "../composables/useDiffPanel";
import {
  isElectron,
  onWindowMaximizeChange,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleMaximize,
} from "../utils/electronBridge";

const { t } = useI18n();
const backend = useBackend();
const update = useUpdate();
const inElectron = isElectron();
const { showDiffPanel, toggleDiffPanel } = useDiffPanel();

const props = withDefaults(
  defineProps<{
    consoleActive?: boolean;
    settingsActive?: boolean;
    sidebarCollapsed?: boolean;
  }>(),
  { consoleActive: false, settingsActive: false, sidebarCollapsed: false },
);

const emit = defineEmits<{
  "toggle-settings": [];
  "toggle-console": [];
  "toggle-sidebar": [];
}>();

onMounted(() => {
  if (!inElectron) return;
  windowIsMaximized().then((v) => {
    isMaximized.value = v;
  });
  unsubMaximize = onWindowMaximizeChange((v) => {
    isMaximized.value = v;
  });
});
onUnmounted(() => {
  unsubMaximize?.();
});

// Show a subtle dot on the settings gear when an update is ready to install.
const updateReady = computed(() => update.state.value.status === "downloaded");

const agentLabel = computed(() => {
  switch (backend.activeBackendKind.value) {
    case "zero":
      return t("welcome.agent.zero");
    case "cli-bridge":
      return "CLI Bridge";
    default:
      return t("welcome.agent.opencode");
  }
});

// Track maximize state so the toggle button shows the right glyph
// (square = currently maximized, will restore on click).
const isMaximized = ref(false);
let unsubMaximize: (() => void) | null = null;
onMounted(async () => {
  if (!inElectron) return;
  isMaximized.value = await windowIsMaximized();
  unsubMaximize = onWindowMaximizeChange((v) => {
    isMaximized.value = v;
  });
});
onUnmounted(() => {
  unsubMaximize?.();
});
</script>

<template>
  <header
    class="h-10 flex items-center justify-between px-3 bg-surface-900 border-b border-surface-800 select-none titlebar-drag"
  >
    <!-- Left: Logo + Title + Current Project -->
    <div class="flex items-center gap-2 min-w-0 titlebar-nodrag">
      <svg
        class="w-5 h-5 flex-shrink-0"
        viewBox="0 0 256 256"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="specforge-mark-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#22d3ee" />
            <stop offset="33%" stop-color="#6366f1" />
            <stop offset="66%" stop-color="#10b981" />
            <stop offset="100%" stop-color="#f59e0b" />
          </linearGradient>
        </defs>
        <circle cx="128" cy="128" r="112" fill="url(#specforge-mark-grad)" />
        <path
          d="M96 80 L48 128 L96 176"
          stroke="white"
          stroke-width="24"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <path
          d="M160 80 L208 128 L160 176"
          stroke="white"
          stroke-width="24"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <circle cx="128" cy="128" r="16" fill="white" />
        <circle cx="128" cy="128" r="8" fill="#0f172a" />
      </svg>
      <span class="text-sm font-semibold text-surface-200 flex-shrink-0">{{ t("app.title") }}</span>
    </div>

    <!-- Right: Agent label + 面板切换 + Settings + Window controls -->
    <div class="flex items-center gap-3 flex-shrink-0">
      <span
        class="px-2 py-1 text-xs text-surface-400 flex items-center gap-1 titlebar-nodrag"
        :title="t('topbar.agentLabel')"
      >
        <span
          class="w-1.5 h-1.5 rounded-full transition-colors"
          :class="{
            'bg-accent-emerald': backend.connectionState.value === 'ready',
            'bg-accent-amber animate-pulse':
              backend.connectionState.value === 'connecting' ||
              backend.connectionState.value === 'bootstrapping',
            'bg-accent-rose': backend.connectionState.value === 'error',
            'bg-surface-600': backend.connectionState.value === 'disconnected',
          }"
        />
        <span>{{ agentLabel }}</span>
      </span>
      <button
        class="px-2 py-1 text-xs rounded transition-colors titlebar-nodrag"
        :class="
          !props.sidebarCollapsed
            ? 'text-accent-cyan bg-accent-cyan/10'
            : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
        "
        :title="props.sidebarCollapsed ? '展开项目栏' : '收起项目栏'"
        :aria-pressed="!props.sidebarCollapsed"
        @click="emit('toggle-sidebar')"
      >
        <svg
          v-if="!props.sidebarCollapsed"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" />
          <line x1="9" y1="3" x2="9" y2="21" stroke-width="2" />
        </svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" />
          <line x1="7" y1="3" x2="7" y2="21" stroke-width="2" />
        </svg>
      </button>
      <button
        class="px-2 py-1 text-xs rounded transition-colors titlebar-nodrag"
        :class="
          showDiffPanel
            ? 'text-accent-cyan bg-accent-cyan/10'
            : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
        "
        :title="showDiffPanel ? '收起侧边栏 (Ctrl+Shift+D)' : '展开侧边栏 (Ctrl+Shift+D)'"
        :aria-pressed="showDiffPanel"
        @click="toggleDiffPanel"
      >
        <svg
          v-if="showDiffPanel"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" />
          <line x1="15" y1="3" x2="15" y2="21" stroke-width="2" />
        </svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke-width="2" />
          <line x1="17" y1="3" x2="17" y2="21" stroke-width="2" />
        </svg>
      </button>
      <button
        class="relative px-2 py-1 text-xs rounded transition-colors titlebar-nodrag"
        :class="
          props.settingsActive
            ? 'text-accent-cyan bg-accent-cyan/10'
            : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
        "
        :title="t('topbar.settings')"
        :aria-pressed="props.settingsActive"
        @click="emit('toggle-settings')"
      >
        <span
          v-if="updateReady"
          class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-accent-cyan"
          :title="t('update.ready')"
        />
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      <!-- Window controls (frameless mode only) -->
      <template v-if="inElectron">
        <span class="mx-1 w-px h-4 bg-surface-800" />
        <button
          class="w-8 h-7 flex items-center justify-center text-surface-400 hover:text-surface-100 hover:bg-surface-800 rounded transition-colors titlebar-nodrag"
          title="Minimize"
          @click="windowMinimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          class="w-8 h-7 flex items-center justify-center text-surface-400 hover:text-surface-100 hover:bg-surface-800 rounded transition-colors titlebar-nodrag"
          :title="isMaximized ? 'Restore' : 'Maximize'"
          @click="windowToggleMaximize"
        >
          <svg v-if="isMaximized" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect
              x="2.5"
              y="4"
              width="5"
              height="5"
              stroke="currentColor"
              stroke-width="1"
              fill="none"
            />
            <path d="M4 4 V2.5 H9 V7.5 H7.5" stroke="currentColor" stroke-width="1" fill="none" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect
              x="2.5"
              y="2.5"
              width="7"
              height="7"
              stroke="currentColor"
              stroke-width="1"
              fill="none"
            />
          </svg>
        </button>
        <button
          class="w-8 h-7 flex items-center justify-center text-surface-400 hover:text-surface-100 hover:bg-accent-rose rounded transition-colors titlebar-nodrag"
          title="Close"
          @click="windowClose"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 3 L9 9 M9 3 L3 9"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
/* Frameless-window drag region. The whole header is draggable; interactive
   children opt out via .titlebar-nodrag. -webkit-app-region is inherited
   so applying no-drag on a wrapper covers nested buttons too. */
.titlebar-drag {
  -webkit-app-region: drag;
}

.titlebar-nodrag {
  -webkit-app-region: no-drag;
}
</style>
