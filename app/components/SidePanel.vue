<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import FileSearchResults from "./FileSearchResults.vue";
import FileTree from "./FileTree.vue";
import MessageFileChanges from "./MessageFileChanges.vue";
import SessionTree from "./SessionTree.vue";
import { useFileIndex } from "../composables/useFileIndex";
import { useMessages } from "../composables/useMessages";
import { useOpenSpec } from "../composables/useOpenSpec";
import { useProject } from "../composables/useProject";
import { useWorkflow } from "../plugins/workflowPlugin";
import type { MessageDiffEntry } from "../types/message";
import type { FileDiff, SessionInfo, SessionStatusInfo } from "../types/sse";
import type { SpecTarget } from "../types/openspec";

const { t } = useI18n();
const { state: projectState } = useProject();
const fileIndex = useFileIndex();
const msgStore = useMessages();
const openspec = useOpenSpec();
const wf = useWorkflow();

const sideTab = ref<"sessions" | "spec" | "files" | "changes">("sessions");
const fileSearch = ref("");

const props = withDefaults(
  defineProps<{
    sessions?: SessionInfo[];
    activeSessionId?: string;
    workspaceDiffs?: readonly FileDiff[];
    statusOf?: (id: string) => SessionStatusInfo;
    specDetailTarget?: SpecTarget | null;
  }>(),
  {
    sessions: () => [],
    activeSessionId: "",
    workspaceDiffs: () => [],
    statusOf: () => ({ type: "idle" }) as SessionStatusInfo,
    specDetailTarget: null,
  },
);

const emit = defineEmits<{
  "select-session": [sessionId: string];
  "delete-session": [sessionId: string];
  "abort-session": [sessionId: string];
  "new-session": [];
  "open-file": [path: string];
  "open-diff": [diff: MessageDiffEntry];
  "open-folder": [];
  "open-chat": [];
  "open-workflow": [changeId?: string];
  "open-spec-detail": [target: SpecTarget];
  "open-tier-picker": [];
  "refresh-files": [];
}>();

const displayWorkflowTitle = computed(() => {
  const ch = openspec.state.activeChanges[0];
  if (ch) return ch.id;
  return wf.state.value.label || "探索中...";
});
const hasWorkflowDraft = computed(
  () => openspec.state.activeChanges.length > 0 || Boolean(wf.state.value.label?.trim()),
);

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
const rootSessionCount = computed(
  () => props.sessions.filter((session) => !session.parentID).length,
);

function openWorkflow(changeId?: string) {
  emit("open-workflow", changeId);
}

const route = useRoute();
const selectedChangeId = computed(() => (route.query.change as string | undefined) ?? "");

// 已完成 / 现有能力 走详情 dialog,选中态以 App.vue 的 specDetailTarget 为单一来源
const selectedDetail = computed<{ kind: "archived" | "capability"; key: string } | null>(() => {
  const t = props.specDetailTarget;
  if (!t) return null;
  if (t.kind === "archived") return { kind: "archived", key: t.id };
  if (t.kind === "capability") return { kind: "capability", key: t.name };
  return null;
});

// 路由进入 workflow 且指定了 change 时,自动切到 Spec tab 让选中态可见
watch(
  () => [route.name, route.query.change] as const,
  ([name, change]) => {
    if (name === "workflow" && change) {
      sideTab.value = "spec";
    }
  },
  { immediate: true },
);

function showSpecDetail(
  target: { kind: "archived"; id: string } | { kind: "capability"; name: string },
) {
  emit("open-spec-detail", target);
}

function openTierPicker() {
  emit("open-tier-picker");
}

function short(s: string | undefined, n = 220): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
void short;

function onSearchFocus() {
  if (projectState.directoryPath) {
    fileIndex.ensureLoaded(projectState.directoryPath);
  }
}

function clearSearch() {
  fileSearch.value = "";
}

function handleOpenDiff(diff: MessageDiffEntry) {
  emit("open-diff", diff);
}
</script>

<template>
  <aside class="side-panel">
    <div v-if="!projectState.directoryPath && !projectState.rootHandle" class="no-project">
      <div class="project-empty-card">
        <span class="project-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
            />
          </svg>
        </span>
        <div class="project-empty-copy">
          <span class="project-empty-title">选择项目</span>
          <span class="project-empty-text">打开一个本地文件夹后开始工作</span>
        </div>
        <button class="open-folder-btn" type="button" @click="emit('open-folder')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{{ t("welcome.openProject", "Open project") }}</span>
        </button>
      </div>
    </div>

    <template v-else>
      <div class="side-content-shell">
        <nav class="side-rail" aria-label="Sidebar navigation">
          <button
            type="button"
            class="rail-button"
            :class="{ active: sideTab === 'sessions' }"
            title="会话"
            @click="
              sideTab = 'sessions';
              emit('open-chat');
            "
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
            <span v-if="rootSessionCount > 0" class="rail-badge">{{ rootSessionCount }}</span>
          </button>
          <button
            type="button"
            class="rail-button spec"
            :class="{ active: sideTab === 'spec' }"
            title="Spec 探索"
            @click="
              sideTab = 'spec';
              openWorkflow();
            "
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
            </svg>
            <span v-if="openspec.state.activeChanges.length > 0" class="rail-badge violet">{{
              openspec.state.activeChanges.length
            }}</span>
          </button>
          <button
            type="button"
            class="rail-button"
            :class="{ active: sideTab === 'files' }"
            title="文件"
            @click="sideTab = 'files'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
              />
            </svg>
          </button>
          <button
            type="button"
            class="rail-button"
            :class="{ active: sideTab === 'changes' }"
            title="修改（Diff）"
            @click="sideTab = 'changes'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M16 3h5v5M8 3H3v5M21 16v5h-5M3 16v5h5M10 7l4 10M14 7l-4 10" />
            </svg>
            <span v-if="activeDiffCount > 0" class="rail-badge">{{ activeDiffCount }}</span>
          </button>
        </nav>

        <div class="side-pane-host">
          <div v-show="sideTab === 'sessions'" class="side-tab-pane">
            <div class="pane-header">
              <div class="pane-title-group">
                <span class="section-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </span>
                <div class="pane-title-copy">
                  <span class="section-kicker">最近会话</span>
                  <span class="section-subtitle">按更新时间排序</span>
                </div>
              </div>
              <div class="pane-actions">
                <span v-if="rootSessionCount > 0" class="count-pill">{{ rootSessionCount }}</span>
                <button
                  type="button"
                  class="header-icon-button"
                  :title="t('sidebar.newSession', 'New session')"
                  @click="emit('new-session')"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="pane-body">
              <SessionTree
                :sessions="sessions"
                :active-session-id="activeSessionId"
                :status-of="statusOf"
                @select="emit('select-session', $event)"
                @delete="emit('delete-session', $event)"
                @abort="emit('abort-session', $event)"
              />
            </div>
          </div>

          <div v-show="sideTab === 'spec'" class="side-tab-pane">
            <div class="pane-header">
              <div class="pane-title-group">
                <span class="section-icon spec" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
                  </svg>
                </span>
                <div class="pane-title-copy">
                  <span class="section-kicker">Spec 探索</span>
                  <span class="section-subtitle">需求、方案与任务</span>
                </div>
              </div>
            </div>

            <div class="pane-body spec-pane">
              <button type="button" class="spec-new-btn" @click="openTierPicker">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path
                    d="M12 2.5l1.9 5.6a4 4 0 0 0 2 2l5.6 1.9-5.6 1.9a4 4 0 0 0-2 2L12 21.5l-1.9-5.6a4 4 0 0 0-2-2L2.5 12l5.6-1.9a4 4 0 0 0 2-2L12 2.5z"
                  />
                </svg>
                <span>开始新的探索</span>
              </button>

              <!-- 探索中草稿 -->
              <div
                v-if="wf.enabled.value && !openspec.state.activeChanges.length && hasWorkflowDraft"
                class="spec-section"
              >
                <div class="spec-group-label"><span>探索中</span></div>
                <div class="spec-item ongoing" @click="openTierPicker">
                  <span class="spec-marker violet">◆</span>
                  <span class="spec-id">{{ displayWorkflowTitle }}</span>
                </div>
              </div>

              <!-- 活跃探索 -->
              <div v-if="openspec.state.activeChanges.length" class="spec-section">
                <div class="spec-group-label">
                  <span>活跃探索</span>
                  <span class="spec-group-count">{{ openspec.state.activeChanges.length }}</span>
                </div>
                <div
                  v-for="change in openspec.state.activeChanges"
                  :key="change.id"
                  class="spec-item active"
                  :class="{ selected: selectedChangeId === change.id }"
                  @click="openWorkflow(change.id)"
                >
                  <span class="spec-marker emerald"></span>
                  <span class="spec-id">{{ change.id }}</span>
                  <span v-if="change.taskStats?.total" class="spec-progress">
                    {{ change.taskStats.completed }}/{{ change.taskStats.total }}
                  </span>
                </div>
              </div>

              <!-- 已完成（归档） -->
              <div v-if="openspec.state.archivedChanges.length" class="spec-section">
                <div class="spec-group-label">
                  <span>已完成</span>
                  <span class="spec-group-count">{{ openspec.state.archivedChanges.length }}</span>
                </div>
                <div
                  v-for="change in openspec.state.archivedChanges"
                  :key="`archived-${change.id}`"
                  class="spec-item archived"
                  :class="{
                    selected:
                      selectedDetail?.kind === 'archived' && selectedDetail.key === change.id,
                  }"
                  @click="showSpecDetail({ kind: 'archived', id: change.id })"
                >
                  <span class="spec-marker amber">✓</span>
                  <span class="spec-id">{{ change.id }}</span>
                  <span v-if="change.archivedAt" class="spec-progress">{{
                    change.archivedAt
                  }}</span>
                </div>
              </div>

              <!-- 现有能力 -->
              <div v-if="openspec.state.capabilities.length" class="spec-section">
                <div class="spec-group-label">
                  <span>现有能力</span>
                  <span class="spec-group-count">{{ openspec.state.capabilities.length }}</span>
                </div>
                <div
                  v-for="cap in openspec.state.capabilities"
                  :key="cap.name"
                  class="spec-item cap"
                  :class="{
                    selected:
                      selectedDetail?.kind === 'capability' && selectedDetail.key === cap.name,
                  }"
                  @click="showSpecDetail({ kind: 'capability', name: cap.name })"
                >
                  <span class="spec-marker violet">◆</span>
                  <span class="spec-id">{{ cap.name }}</span>
                  <span v-if="cap.requirements?.length" class="spec-progress">
                    {{ cap.requirements.length }} reqs
                  </span>
                </div>
              </div>

              <!-- 全空 -->
              <div
                v-if="
                  !openspec.state.activeChanges.length &&
                  !openspec.state.archivedChanges.length &&
                  !openspec.state.capabilities.length &&
                  !hasWorkflowDraft
                "
                class="spec-empty"
              >
                <span>暂无探索记录,点击上方按钮开始</span>
              </div>
            </div>
          </div>

          <div v-show="sideTab === 'files'" class="side-tab-pane">
            <div class="pane-header">
              <div class="pane-title-group">
                <span class="section-icon file" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
                    />
                  </svg>
                </span>
                <div class="pane-title-copy">
                  <span class="section-kicker">文件</span>
                  <span class="section-subtitle">浏览并拖拽引用</span>
                </div>
              </div>
              <div class="pane-actions">
                <button
                  type="button"
                  class="header-icon-button"
                  :title="projectState.directoryName || t('welcome.openProject', 'Open project')"
                  @click="emit('open-folder')"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="header-icon-button"
                  :title="t('sidebar.refreshFiles')"
                  @click="emit('refresh-files')"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M4 4v6h6M20 20v-6h-6M5 10a8 8 0 0 1 14-3M19 14a8 8 0 0 1-14 3" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="pane-body">
              <div v-if="projectState.loading" class="section-empty">Loading...</div>
              <div v-else-if="projectState.error" class="section-error">
                {{ projectState.error }}
              </div>
              <template v-else-if="projectState.root">
                <div class="file-search-row">
                  <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
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
                    x
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
            </div>
          </div>

          <div v-show="sideTab === 'changes'" class="side-tab-pane">
            <div class="pane-header">
              <div class="pane-title-group">
                <span class="section-icon changes" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M16 3h5v5M8 3H3v5M21 16v5h-5M3 16v5h5M10 7l4 10M14 7l-4 10" />
                  </svg>
                </span>
                <div class="pane-title-copy">
                  <span class="section-kicker">修改</span>
                  <span class="section-subtitle">当前工作区 Diff</span>
                </div>
              </div>
              <span v-if="activeDiffCount > 0" class="count-pill">{{ activeDiffCount }}</span>
            </div>

            <div class="pane-body">
              <MessageFileChanges
                v-if="activeDiffCount > 0"
                :diffs="activeDiffs"
                @open-diff="handleOpenDiff"
              />
              <div v-else class="section-empty">No file changes</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-surface-800, #1e293b) 64%, transparent),
      var(--color-surface-900, #0f172a)
    ),
    var(--color-surface-900, #0f172a);
}

.no-project {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 72px 12px 16px;
}

.project-empty-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 18px 14px 16px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
  border-radius: 16px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-surface-800, #1e293b) 45%, transparent),
      color-mix(in srgb, var(--color-surface-950, #020617) 28%, transparent)
    ),
    color-mix(in srgb, var(--color-surface-900, #0f172a) 72%, transparent);
}

.project-empty-icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 12%, transparent);
  color: var(--color-accent-amber, #f59e0b);
}

.project-empty-icon svg {
  width: 19px;
  height: 19px;
  stroke-width: 1.8;
}

.project-empty-copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.project-empty-title {
  color: var(--color-surface-100, #f1f5f9);
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}

.project-empty-text {
  color: var(--color-surface-600, #475569);
  font-size: 11px;
  line-height: 1.4;
}

.open-folder-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 18%, transparent);
  color: var(--color-surface-200, #e2e8f0);
  font-size: 13px;
  padding: 10px 20px;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
}

.open-folder-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

.open-folder-btn:hover {
  color: var(--color-accent-cyan, #22d3ee);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 30%, transparent);
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 13%, transparent);
}

.side-content-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  border-top: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 24%, transparent);
}

.side-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 6px;
  border-right: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 28%, transparent);
  background: color-mix(in srgb, var(--color-surface-950, #020617) 24%, transparent);
}

.rail-button {
  position: relative;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.rail-button:hover {
  color: var(--color-surface-100, #f1f5f9);
  background: color-mix(in srgb, var(--color-surface-700, #334155) 20%, transparent);
}

.rail-button.active {
  color: var(--color-accent-cyan, #06b6d4);
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 20%, transparent);
}

.rail-button.spec.active {
  color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 20%, transparent);
}

.rail-button.active::before {
  content: "";
  position: absolute;
  left: -7px;
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 12px currentColor;
}

.rail-button svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
}

.rail-badge {
  position: absolute;
  top: -3px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border: 1px solid var(--color-surface-900, #0f172a);
  border-radius: 999px;
  background: var(--color-accent-cyan, #06b6d4);
  color: var(--color-surface-950, #020617);
  font-size: 9px;
  font-weight: 800;
}

.rail-badge.violet {
  background: var(--color-accent-violet, #a78bfa);
}

.side-pane-host {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.side-tab-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 9px 9px 6px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 28%, transparent);
  border-radius: 12px;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-surface-800, #1e293b) 44%, transparent),
      color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 5%, transparent)
    ),
    color-mix(in srgb, var(--color-surface-900, #0f172a) 66%, transparent);
  flex: 0 0 auto;
}

.pane-title-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 12%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.section-icon.spec {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

.section-icon.file {
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 12%, transparent);
  color: var(--color-accent-amber, #f59e0b);
}

.section-icon.changes {
  background: color-mix(in srgb, var(--color-accent-emerald, #10b981) 12%, transparent);
  color: var(--color-accent-emerald, #10b981);
}

.section-icon svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.8;
}

.pane-title-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.section-kicker {
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  color: var(--color-surface-100, #f1f5f9);
}

.section-subtitle {
  overflow: hidden;
  color: var(--color-surface-600, #475569);
  font-size: 10px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 28%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 32%, transparent);
}

.count-pill {
  min-width: 22px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 18%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
  font-size: 10px;
  font-weight: 800;
}

.header-icon-button {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.header-icon-button:hover {
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 12%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.header-icon-button svg {
  width: 13px;
  height: 13px;
  stroke-width: 2;
}

.pane-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 9px 9px;
}

.spec-pane {
  padding-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spec-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spec-group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 9px 6px 3px;
  padding-top: 7px;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--color-surface-500, #64748b);
  text-transform: uppercase;
}

.spec-section:first-child .spec-group-label {
  margin-top: 2px;
  padding-top: 0;
  border-top: 0;
}

.spec-group-count {
  min-width: 18px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-600, #475569) 22%, transparent);
  color: var(--color-surface-400, #94a3b8);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0;
}

.spec-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 9px;
  font-size: 12px;
  color: var(--color-surface-300, #cbd5e1);
  cursor: pointer;
  font-family: var(--font-mono, monospace);
  flex-wrap: wrap;
  border: 1px solid transparent;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.spec-item:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}

.spec-item.selected {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 14%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 50%, transparent);
  color: var(--color-surface-100, #f1f5f9);
  box-shadow: inset 2px 0 0 var(--color-accent-violet, #a78bfa);
}

.spec-item.active:hover {
  border-color: color-mix(in srgb, var(--color-accent-emerald, #34d399) 24%, transparent);
}

.spec-item.cap:hover {
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 24%, transparent);
}

.spec-item.archived:hover {
  border-color: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 24%, transparent);
}

.spec-item.expanded {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}

.spec-item.ongoing {
  color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
}

.spec-marker {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  font-family: inherit;
  border-radius: 4px;
  line-height: 1;
}

.spec-marker.emerald {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-emerald, #34d399);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent-emerald, #34d399) 60%, transparent);
}

.spec-marker.violet {
  color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 14%, transparent);
}

.spec-marker.amber {
  color: var(--color-accent-amber, #f59e0b);
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent-amber, #f59e0b) 32%, transparent);
}

.spec-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spec-progress {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-sans, inherit);
}

.header-icon-button.accent-violet {
  color: var(--color-accent-violet, #a78bfa);
}

.header-icon-button.accent-violet:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 14%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

/* ── Detail styles已移至 SpecDetailDialog.vue ─────────────────── */

.spec-new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 12px;
  margin-bottom: 12px;
  border-radius: 10px;
  border: 1px dashed color-mix(in srgb, var(--color-accent-violet, #a78bfa) 45%, transparent);
  background: transparent;
  color: var(--color-accent-violet, #a78bfa);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.spec-new-btn svg {
  width: 12px;
  height: 12px;
}
.spec-new-btn:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 70%, transparent);
}

.spec-empty,
.section-empty {
  padding: 1rem 0.5rem;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-surface-600, #475569);
}

.section-error {
  padding: 0.4rem 0.5rem;
  font-size: 13px;
  color: var(--color-accent-rose, #f43f5e);
}

.file-search-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  margin-bottom: 8px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-surface-600, #475569) 26%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 48%, transparent);
}

.search-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--color-surface-500, #64748b);
  stroke-width: 1.8;
}

.file-search-input {
  min-width: 0;
  flex: 1;
  box-sizing: border-box;
  padding: 0;
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
  background: transparent;
  border: 0;
  outline: none;
}

.file-search-input::placeholder {
  color: var(--color-surface-600, #475569);
}

.file-search-clear {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--color-surface-500, #64748b);
  background: transparent;
  cursor: pointer;
}

.file-search-clear:hover {
  color: var(--color-surface-100, #f1f5f9);
  background: color-mix(in srgb, var(--color-surface-600, #475569) 24%, transparent);
}
</style>
