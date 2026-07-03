<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import SessionTree from "./SessionTree.vue";
import FileTree from "./FileTree.vue";
import FileSearchResults from "./FileSearchResults.vue";
import MessageFileChanges from "./MessageFileChanges.vue";
import SidePanelSection from "./SidePanelSection.vue";
import { useProject } from "../composables/useProject";
import { useFileIndex } from "../composables/useFileIndex";
import { useMessages } from "../composables/useMessages";
import { useOpenSpec } from "../composables/useOpenSpec";
import { useRouter } from "vue-router";
import { useWorkflow } from "../plugins/workflowPlugin";
import type { MessageDiffEntry } from "../types/message";
import type { FileDiff, SessionInfo, SessionStatusInfo } from "../types/sse";

const { t } = useI18n();
const { state: projectState } = useProject();
const fileIndex = useFileIndex();
const msgStore = useMessages();
const openspec = useOpenSpec();
const router = useRouter();
const wf = useWorkflow();
const sideTab = ref<"sessions" | "spec">("sessions");

const displayWorkflowTitle = computed(() => {
  const ch = openspec.state.activeChanges[0];
  if (ch) return ch.id;
  return "探索中…";
});
function openWorkflow() {
  router.push({ name: "workflow" });
}

// File-tree search. Empty query keeps the regular hierarchical tree; typing
// swaps to a flat filtered list sourced from the same @ mention index. Lazy
// load on focus in case the user opens this panel before opening composer.
const fileSearch = ref("");
function onSearchFocus() {
  if (projectState.directoryPath) {
    fileIndex.ensureLoaded(projectState.directoryPath);
  }
}
function clearSearch() {
  fileSearch.value = "";
}

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
  "refresh-files": [];
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
    canRefresh: true,
    refreshTitle: t("sidebar.refreshFiles"),
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
    <div class="side-tabs">
      <button
        class="side-tab"
        :class="{ active: sideTab === 'sessions' }"
        @click="sideTab = 'sessions'"
      >
        {{ t("sidebar.sessions") }}
      </button>
      <button
        class="side-tab spec"
        :class="{ active: sideTab === 'spec' }"
        @click="sideTab = 'spec'"
      >
        Spec 探索
      </button>
    </div>
    <div v-show="sideTab === 'sessions'" class="side-tab-pane">
      <SidePanelSection
        v-for="section in sections"
        :key="section.id"
        :title="section.title"
        :badge="section.badge"
        :collapsed="section.collapsed"
        :can-create="section.canCreate"
        :can-refresh="section.canRefresh"
        :refresh-title="section.refreshTitle"
        :action-icon="section.actionIcon"
        @toggle="toggleSection(section.id)"
        @new="section.id === 'files' ? emit('open-folder') : emit('new-session')"
        @refresh="emit('refresh-files')"
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
          <template v-else-if="projectState.root">
            <!-- Search box: shown when the user has a project open. Focus lazy
               loads the flat index so the first keystroke already has data. -->
            <div class="file-search-row">
              <input
                v-model="fileSearch"
                type="text"
                class="file-search-input"
                :placeholder="t('sidebar.searchFiles', 'Search files...')"
                @focus="onSearchFocus"
              />
              <button
                v-if="fileSearch"
                type="button"
                class="file-search-clear"
                :title="t('sidebar.clearSearch', 'Clear')"
                @click="clearSearch"
              >
                ×
              </button>
            </div>
            <FileSearchResults
              v-if="fileSearch.trim()"
              :query="fileSearch"
              :files="fileIndex.files.value"
              @open-file="emit('open-file', $event)"
            />
            <FileTree
              v-else
              :node="projectState.root"
              :depth="0"
              @open-file="emit('open-file', $event)"
            />
          </template>
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
    </div>
    <div v-show="sideTab === 'spec'" class="side-tab-pane spec-pane">
      <div class="spec-section-label">探索</div>
      <div v-if="wf.enabled.value" class="spec-item active" @click="openWorkflow">
        <span class="spec-dot pulse"></span>{{ displayWorkflowTitle }}
      </div>
      <div
        v-for="change in openspec.state.activeChanges"
        :key="change.id"
        class="spec-item"
        @click="openWorkflow"
      >
        <span class="spec-dot"></span>{{ change.id }}
      </div>
      <div v-if="!openspec.state.activeChanges.length && !wf.enabled.value" class="spec-empty">
        点下方按钮开始一次新的探索
      </div>
      <button class="spec-new-btn" @click="openWorkflow">+ 新建 Spec 探索</button>
    </div>
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

.side-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 8px 6px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  flex-shrink: 0;
}
.side-tab {
  flex: 1;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-surface-500, #64748b);
  font-size: 11px;
  padding: 5px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.side-tab:hover {
  color: var(--color-surface-300, #cbd5e1);
}
.side-tab.active {
  background: var(--color-surface-800, #1e293b);
  color: var(--color-surface-100, #f1f5f9);
}
.side-tab.spec.active {
  color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
}
.side-tab-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.spec-pane {
  padding: 6px 0;
  overflow-y: auto;
}
.spec-section-label {
  padding: 8px 14px 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-surface-600, #475569);
}
.spec-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--color-surface-400, #94a3b8);
  cursor: pointer;
  font-family: var(--font-mono, monospace);
}
.spec-item:hover {
  background: var(--color-surface-800, #1e293b);
  color: var(--color-surface-100, #f1f5f9);
}
.spec-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent-emerald, #34d399);
  flex-shrink: 0;
}
.spec-dot.pulse {
  background: var(--color-accent-violet, #a78bfa);
  animation: spec-pulse 1.5s infinite;
}
@keyframes spec-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.spec-empty {
  padding: 14px 12px;
  font-size: 11px;
  color: var(--color-surface-600, #475569);
  text-align: center;
  line-height: 1.5;
}
.spec-new-btn {
  margin: 12px 10px 0;
  background: transparent;
  border: 1px dashed var(--color-surface-700, #334155);
  color: var(--color-surface-400, #94a3b8);
  font-size: 11px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.spec-new-btn:hover {
  color: var(--color-accent-violet, #a78bfa);
  border-color: var(--color-accent-violet, #a78bfa);
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

.file-search-row {
  position: relative;
  padding: 0.25rem 0.5rem 0.5rem;
}

.file-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.3rem 1.5rem 0.3rem 0.5rem;
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
  background: var(--color-surface-900, #0f172a);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 4px;
  outline: none;
}
.file-search-input:focus {
  border-color: var(--color-accent-cyan, #06b6d4);
}
.file-search-input::placeholder {
  color: var(--color-surface-600, #475569);
}

.file-search-clear {
  position: absolute;
  top: 50%;
  right: 0.75rem;
  transform: translateY(-50%);
  font-size: 16px;
  line-height: 1;
  color: var(--color-surface-500, #64748b);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}
.file-search-clear:hover {
  color: var(--color-surface-200, #e2e8f0);
}
</style>
