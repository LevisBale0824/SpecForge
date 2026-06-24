<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import SessionTree from "./SessionTree.vue";
import FileTree from "./FileTree.vue";
import MessageFileChanges from "./MessageFileChanges.vue";
import SidePanelSection from "./SidePanelSection.vue";
import { useProject } from "../composables/useProject";
import { useMessages } from "../composables/useMessages";
import type { MessageDiffEntry } from "../types/message";
import type { FileDiff, SessionInfo, SessionStatusInfo } from "../types/sse";

const { t } = useI18n();
const { state: projectState } = useProject();
const msgStore = useMessages();

const props = withDefaults(
  defineProps<{
    sessions?: SessionInfo[];
    activeSessionId?: string;
    workspaceDiffs?: readonly FileDiff[];
    statusOf?: (id: string) => SessionStatusInfo;
  }>(),
  {
    sessions: () => [],
    activeSessionId: "",
    workspaceDiffs: () => [],
    statusOf: () => ({ type: "idle" }) as SessionStatusInfo,
  },
);

// Collapsible sections.
// Each section can be independently collapsed. When all expanded, they share
// the available height evenly (flex: 1 1 0). A collapsed section contributes
// only its header height.

type SectionId = "sessions" | "files" | "diff";
// All sections start collapsed; the user opts in to each one.
const collapsed = ref<Record<SectionId, boolean>>({
  sessions: true,
  files: true,
  diff: true,
});

function toggleSection(id: SectionId) {
  collapsed.value[id] = !collapsed.value[id];
}

const emit = defineEmits<{
  "select-session": [sessionId: string];
  "delete-session": [sessionId: string];
  "abort-session": [sessionId: string];
  "new-session": [];
  "open-file": [path: string];
  "open-diff": [diff: MessageDiffEntry];
  "open-folder": [];
}>();

function handleOpenDiff(diff: MessageDiffEntry) {
  emit("open-diff", diff);
}

// Diff data.

const workspaceDiffEntries = computed<MessageDiffEntry[]>(() =>
  props.workspaceDiffs
    .filter((diff) => diff.file)
    .map((diff) => ({
      file: diff.file,
      diff: diff.patch ?? "",
      before: diff.before,
      after: diff.after,
      additions: diff.additions,
      deletions: diff.deletions,
    })),
);

const activeDiffs = computed(() => {
  if (workspaceDiffEntries.value.length > 0) return workspaceDiffEntries.value;
  if (!props.activeSessionId) return undefined;
  return msgStore.getSessionDiffs(props.activeSessionId);
});

const activeDiffCount = computed(() => activeDiffs.value?.length ?? 0);

const sections = computed(() => [
  {
    id: "sessions" as const,
    title: t("sidebar.sessions"),
    // Count only root sessions (those without a parentID). Sub-agent
    // sessions are nested under their parent and shouldn't inflate the
    // top-level count; otherwise "5 sessions" might really be 1 parent
    // + 4 sub-agents.
    badge: props.sessions.filter((s) => !s.parentID).length,
    collapsed: collapsed.value.sessions,
    canCreate: true,
  },
  {
    id: "files" as const,
    title: t("sidebar.files"),
    badge: 0,
    collapsed: collapsed.value.files,
    canCreate: true,
    actionIcon: "folder" as const,
  },
  {
    id: "diff" as const,
    title: "Diff",
    badge: activeDiffCount.value,
    collapsed: collapsed.value.diff,
    canCreate: false,
  },
]);
</script>

<template>
  <aside class="side-panel">
    <SidePanelSection
      v-for="section in sections"
      :key="section.id"
      :title="section.title"
      :badge="section.badge"
      :collapsed="section.collapsed"
      :can-create="section.canCreate"
      :action-icon="section.actionIcon"
      @toggle="toggleSection(section.id)"
      @new="section.id === 'files' ? emit('open-folder') : emit('new-session')"
    >
      <!-- Sessions -->
      <template v-if="section.id === 'sessions'">
        <SessionTree
          :sessions="sessions"
          :active-session-id="activeSessionId"
          :status-of="statusOf"
          @select="emit('select-session', $event)"
          @delete="emit('delete-session', $event)"
          @abort="emit('abort-session', $event)"
        />
      </template>

      <!-- Files -->
      <template v-else-if="section.id === 'files'">
        <div v-if="projectState.loading" class="section-empty">Loading...</div>
        <div v-else-if="projectState.error" class="section-error">
          {{ projectState.error }}
        </div>
        <FileTree
          v-else-if="projectState.root"
          :node="projectState.root"
          :depth="0"
          @open-file="emit('open-file', $event)"
        />
        <div v-else class="section-empty">{{ t("welcome.openProject") }}</div>
      </template>

      <!-- Diff -->
      <template v-else-if="section.id === 'diff'">
        <MessageFileChanges
          v-if="activeDiffCount > 0"
          :diffs="activeDiffs"
          @open-diff="handleOpenDiff"
        />
        <div v-else class="section-empty">No file changes</div>
      </template>
    </SidePanelSection>
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface-900, #0f172a);
  overflow: hidden;
}

.section-empty {
  padding: 1rem 0.5rem;
  text-align: center;
  font-size: 13px;
  color: var(--color-surface-600, #475569);
}

.section-error {
  padding: 0.4rem 0.5rem;
  font-size: 13px;
  color: var(--color-accent-rose, #f43f5e);
}
</style>
