<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import SessionTree from "./SessionTree.vue";
import { useProject } from "../composables/useProject";
import { useStageSessions } from "../composables/useStageSessions";
import { computeHiddenStageSessions } from "../utils/stageTitleEncoding";
import type { SessionInfo, SessionStatusInfo } from "../types/sse";

const { t } = useI18n();
const { state: projectState, openedDirectories, switchProject, closeProject } = useProject();

const expandedProjects = ref<Record<string, boolean>>({});

function normalizeDir(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function dirName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function toggleProject(dirPath: string): void {
  const key = normalizeDir(dirPath);
  expandedProjects.value[key] = expandedProjects.value[key] === false ? true : false;
}

const props = withDefaults(
  defineProps<{
    sessions?: SessionInfo[];
    activeSessionId?: string;
    statusOf?: (id: string) => SessionStatusInfo;
  }>(),
  {
    sessions: () => [],
    activeSessionId: "",
    statusOf: () => ({ type: "idle" }) as SessionStatusInfo,
  },
);

const emit = defineEmits<{
  "select-session": [sessionId: string];
  "delete-session": [sessionId: string];
  "abort-session": [sessionId: string];
  "new-session": [];
  "open-folder": [];
}>();

const { stageSessionIds } = useStageSessions();
const chatSessions = computed(() => {
  const hidden = computeHiddenStageSessions(props.sessions, stageSessionIds.value);
  return props.sessions.filter((s) => !hidden.has(s.id));
});

const MAX_SESSIONS_PER_PROJECT = 10;

function sessionsForDirectory(dirPath: string): SessionInfo[] {
  const normalized = normalizeDir(dirPath);
  const hidden = computeHiddenStageSessions(props.sessions, stageSessionIds.value);
  const all = chatSessions.value.filter((s) => {
    if (hidden.has(s.id)) return false;
    return normalizeDir(s.directory) === normalized;
  });
  const roots = all.filter((s) => !s.parentID).slice(0, MAX_SESSIONS_PER_PROJECT);
  const rootIds = new Set(roots.map((s) => s.id));
  const children = all.filter((s) => s.parentID && rootIds.has(s.parentID));
  return [...roots, ...children];
}

const chatActiveSessionId = computed(() => {
  const id = props.activeSessionId;
  return id && chatSessions.value.some((s) => s.id === id) ? id : "";
});
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

    <div v-else class="project-list">
      <div
        v-for="dirPath in openedDirectories"
        :key="dirPath"
        class="project-group"
        :class="{
          expanded: expandedProjects[normalizeDir(dirPath)] !== false,
          active: normalizeDir(projectState.directoryPath) === normalizeDir(dirPath),
        }"
      >
        <button class="project-group-header" @click="switchProject(dirPath)">
          <svg
            class="pg-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            @click.stop="toggleProject(dirPath)"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <svg class="pg-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
          <span class="pg-name" :title="dirPath">{{ dirName(dirPath) }}</span>
          <div class="pg-actions" @click.stop>
            <button
              v-if="normalizeDir(projectState.directoryPath) === normalizeDir(dirPath)"
              type="button"
              class="pg-action-btn"
              :title="t('sidebar.newSession', 'New session')"
              @click="emit('new-session')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              class="pg-action-btn danger"
              title="关闭项目"
              @click="closeProject(dirPath)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </button>

        <div v-show="expandedProjects[normalizeDir(dirPath)] !== false" class="project-group-body">
          <SessionTree
            :sessions="sessionsForDirectory(dirPath)"
            :active-session-id="chatActiveSessionId"
            :status-of="statusOf"
            @select="emit('select-session', $event)"
            @delete="emit('delete-session', $event)"
            @abort="emit('abort-session', $event)"
          />
        </div>
      </div>

      <button class="add-project-btn" @click="emit('open-folder')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>添加项目</span>
      </button>
    </div>
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

.project-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  padding: 6px 6px 4px;
}

.project-group {
  display: flex;
  flex-direction: column;
}

.project-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}

.project-group-header:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}

.pg-chevron {
  width: 14px;
  height: 14px;
  stroke-width: 2;
  color: var(--color-surface-500, #64748b);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.project-group:not(.expanded) .pg-chevron {
  transform: rotate(-90deg);
}

.pg-folder-icon {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
  color: var(--color-accent-cyan, #22d3ee);
  flex-shrink: 0;
}

.pg-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-surface-100, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pg-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.project-group-header:hover .pg-actions {
  opacity: 1;
}

.pg-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  transition: all 0.12s;
}

.pg-action-btn:hover {
  color: var(--color-surface-100, #f1f5f9);
  background: color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
}

.pg-action-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

.project-group-body {
  padding: 2px 0 4px;
}

.seg-control {
  display: flex;
  margin: 2px 8px 6px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
}

.seg-btn {
  flex: 1;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.seg-btn:hover {
  color: var(--color-surface-200, #e2e8f0);
}

.seg-btn.active {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 12%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}

.seg-btn:nth-child(2).active {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

.seg-count {
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  font-size: 9px;
  font-weight: 700;
  min-width: 15px;
  text-align: center;
}

.spec-divider {
  height: 1px;
  margin: 4px 10px;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
}

.spec-mini-section {
  padding: 0 4px;
}

.project-group.active > .project-group-header {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 6%, transparent);
}

.project-group:not(.active) > .project-group-header {
  opacity: 0.6;
}

.pg-action-btn.danger:hover {
  color: var(--color-accent-rose, #f43f5e);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 12%, transparent);
}

.add-project-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  margin-top: 4px;
  border: 1px dashed color-mix(in srgb, var(--color-surface-600, #475569) 40%, transparent);
  border-radius: 8px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
}

.add-project-btn:hover {
  color: var(--color-accent-cyan, #22d3ee);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 30%, transparent);
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 5%, transparent);
}

.add-project-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

/* ── Spec item styles (shared with old design) ─────────────────────────── */

.spec-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  margin: 2px 0 6px;
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 20%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 6%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}

.spec-new-btn:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 35%, transparent);
}

.spec-new-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.spec-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 12px;
}

.spec-item:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}

.spec-item.selected {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
}

.spec-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  font-size: 9px;
  border-radius: 999px;
}

.spec-marker.emerald {
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 80%, transparent);
}

.spec-marker.amber {
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 25%, transparent);
  color: var(--color-accent-amber, #f59e0b);
  font-size: 8px;
}

.spec-marker.violet {
  color: var(--color-accent-violet, #a78bfa);
}

.spec-id {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-surface-300, #cbd5e1);
}

.spec-item.selected .spec-id {
  color: var(--color-accent-violet, #a78bfa);
}

.spec-progress {
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.spec-item-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-surface-600, #475569);
  cursor: pointer;
  opacity: 0;
  transition: all 0.1s;
  flex-shrink: 0;
}

.spec-item:hover .spec-item-action {
  opacity: 1;
}

.spec-item-action:hover {
  color: var(--color-accent-rose, #f43f5e);
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 12%, transparent);
}

.spec-item-action svg {
  width: 12px;
  height: 12px;
  stroke-width: 2;
}

.spec-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--color-surface-600, #475569);
}
</style>
