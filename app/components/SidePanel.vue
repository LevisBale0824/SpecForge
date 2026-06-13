<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import SessionTree from "./SessionTree.vue";
import FileTree from "./FileTree.vue";
import MessageFileChanges from "./MessageFileChanges.vue";
import { useProject } from "../composables/useProject";
import { useMessages } from "../composables/useMessages";
import type { SessionInfo } from "../types/sse";

const { t } = useI18n();
const { state: projectState } = useProject();
const msgStore = useMessages();
type SideTab = "sessions" | "files" | "diff";
const activeTab = ref<SideTab>("sessions");
const tabs: SideTab[] = ["sessions", "files", "diff"];
const tabLabels: Record<SideTab, string> = {
  sessions: t("sidebar.sessions"),
  files: t("sidebar.files"),
  diff: "Diff",
};

// Auto-switch to files tab when a project is opened
watch(
  () => projectState.directoryName,
  (name) => {
    if (name) activeTab.value = "files";
  },
);

const props = withDefaults(
  defineProps<{
    sessions?: SessionInfo[];
    activeSessionId?: string;
  }>(),
  {
    sessions: () => [],
    activeSessionId: "",
  },
);

const activeDiffs = computed(() => {
  if (!props.activeSessionId) return undefined;
  return msgStore.getSessionDiffs(props.activeSessionId);
});

const activeDiffCount = computed(() => activeDiffs.value?.length ?? 0);

watch(activeDiffCount, (count) => {
  if (count > 0) activeTab.value = "diff";
});

const emit = defineEmits<{
  "select-session": [sessionId: string];
  "delete-session": [sessionId: string];
  "new-session": [];
  "open-file": [path: string];
}>();
</script>

<template>
  <aside class="flex flex-col h-full bg-surface-900">
    <!-- Tab Header -->
    <div class="flex border-b border-surface-800">
      <button
        v-for="tab in tabs"
        :key="tab"
        class="flex-1 py-2 text-xs font-medium transition-colors"
        :class="activeTab === tab
          ? 'text-accent-cyan border-b-2 border-accent-cyan'
          : 'text-surface-500 hover:text-surface-300'"
        @click="activeTab = tab"
      >
        {{ tabLabels[tab] }}
        <span
          v-if="tab === 'diff' && activeDiffCount > 0"
          class="ml-1 rounded bg-accent-cyan/15 px-1.5 py-0.5 text-[10px] text-accent-cyan"
        >
          {{ activeDiffCount }}
        </span>
      </button>
    </div>

    <!-- Tab Content -->
    <div class="flex-1 overflow-y-auto p-2">
      <template v-if="activeTab === 'sessions'">
        <SessionTree
          :sessions="sessions"
          :active-session-id="activeSessionId"
          @select="emit('select-session', $event)"
          @delete="emit('delete-session', $event)"
        />
      </template>
      <template v-else-if="activeTab === 'files'">
        <div v-if="projectState.loading" class="px-2 py-4 text-xs text-surface-600 text-center">
          Loading...
        </div>
        <div v-else-if="projectState.error" class="px-2 py-2 text-xs text-accent-rose">
          {{ projectState.error }}
        </div>
        <FileTree
          v-else-if="projectState.root"
          :node="projectState.root"
          :depth="0"
          @open-file="emit('open-file', $event)"
        />
        <div v-else class="text-center py-8 text-surface-600 text-sm">
          {{ t("welcome.openProject") }}
        </div>
      </template>
      <template v-else>
        <MessageFileChanges
          v-if="activeDiffCount > 0"
          :diffs="activeDiffs"
        />
        <div v-else class="px-2 py-8 text-center text-sm text-surface-600">
          No file changes
        </div>
      </template>
    </div>

    <!-- New Session Button -->
    <div v-if="activeTab === 'sessions'" class="p-2 border-t border-surface-800">
      <button
        class="w-full py-1.5 text-xs font-medium rounded bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors"
        @click="emit('new-session')"
      >
        + {{ t("sidebar.newSession") }}
      </button>
    </div>
  </aside>
</template>
