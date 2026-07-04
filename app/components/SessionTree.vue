<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SessionInfo, SessionStatusInfo } from "../types/sse";

const { t } = useI18n();

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
  select: [sessionId: string];
  delete: [sessionId: string];
  abort: [sessionId: string];
}>();

function sortByDefault(list: SessionInfo[]): SessionInfo[] {
  return list.sort((a, b) => {
    if (a.time.pinned && !b.time.pinned) return -1;
    if (!a.time.pinned && b.time.pinned) return 1;
    return (b.time.updated ?? 0) - (a.time.updated ?? 0);
  });
}

const MAX_ROOT_SESSIONS = 100;

const rootSessions = computed(() =>
  sortByDefault([...props.sessions].filter((session) => !session.parentID)).slice(
    0,
    MAX_ROOT_SESSIONS,
  ),
);

const childrenByParent = computed(() => {
  const map = new Map<string, SessionInfo[]>();
  const parentIds = new Set(props.sessions.map((session) => session.id));
  for (const session of props.sessions) {
    if (!session.parentID || !parentIds.has(session.parentID)) continue;
    const arr = map.get(session.parentID) ?? [];
    arr.push(session);
    map.set(session.parentID, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0));
  }
  return map;
});

const orphanSessions = computed(() =>
  sortByDefault(
    props.sessions.filter(
      (session) =>
        session.parentID && !props.sessions.some((parent) => parent.id === session.parentID),
    ),
  ),
);

const expandedParents = ref(new Set<string>());

function toggleCollapse(parentId: string) {
  const next = new Set(expandedParents.value);
  if (next.has(parentId)) next.delete(parentId);
  else next.add(parentId);
  expandedParents.value = next;
}

function isExpanded(parentId: string): boolean {
  return expandedParents.value.has(parentId);
}

watch(
  () => props.activeSessionId,
  (newId) => {
    if (!newId) return;
    const child = props.sessions.find((session) => session.id === newId);
    if (child?.parentID && !expandedParents.value.has(child.parentID)) {
      const next = new Set(expandedParents.value);
      next.add(child.parentID);
      expandedParents.value = next;
    }
  },
);

function childrenOf(sessionId: string): SessionInfo[] {
  return childrenByParent.value.get(sessionId) ?? [];
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60000) return t("sidebar.justNow");
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function isBusy(sessionId: string): boolean {
  return props.statusOf(sessionId)?.type === "busy";
}

function statusIcon(session: SessionInfo): string {
  if (session.time.archived) return "archived";
  if (session.time.pinned) return "pinned";
  return "";
}
</script>

<template>
  <div class="session-tree">
    <template v-for="session in rootSessions" :key="session.id">
      <div
        role="button"
        tabindex="0"
        class="session-row"
        :class="{ active: activeSessionId === session.id }"
        @click="emit('select', session.id)"
        @keydown.enter.space.prevent="emit('select', session.id)"
      >
        <button
          v-if="childrenOf(session.id).length > 0"
          type="button"
          class="session-disclosure"
          :class="{ expanded: isExpanded(session.id) }"
          :title="isExpanded(session.id) ? t('sidebar.collapse') : t('sidebar.expand')"
          @click.stop="toggleCollapse(session.id)"
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path
              clip-rule="evenodd"
              fill-rule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
            />
          </svg>
        </button>
        <span
          v-else
          class="session-dot"
          :class="{
            busy: isBusy(session.id),
            pinned: !isBusy(session.id) && statusIcon(session) === 'pinned',
            archived: !isBusy(session.id) && statusIcon(session) === 'archived',
          }"
        />

        <span class="session-title">{{ session.title || session.id.slice(0, 8) }}</span>

        <span v-if="childrenOf(session.id).length > 0" class="child-count">
          {{ childrenOf(session.id).length }}
        </span>
        <span class="session-time">{{ formatTime(session.time.updated) }}</span>

        <button
          v-if="isBusy(session.id)"
          type="button"
          class="row-action danger"
          :title="t('sidebar.abortSession')"
          @click.stop="emit('abort', session.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <button
          type="button"
          class="row-action danger"
          :title="t('sidebar.deleteSession')"
          @click.stop="emit('delete', session.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
            />
          </svg>
        </button>
      </div>

      <div
        v-if="isExpanded(session.id) && childrenOf(session.id).length > 0"
        class="subthread-list"
      >
        <div
          v-for="child in childrenOf(session.id)"
          :key="child.id"
          role="button"
          tabindex="0"
          class="subthread-row"
          :class="{ active: activeSessionId === child.id }"
          @click="emit('select', child.id)"
          @keydown.enter.space.prevent="emit('select', child.id)"
        >
          <span class="session-dot subagent" :class="{ busy: isBusy(child.id) }" />
          <span class="session-title">{{ child.title || child.id.slice(0, 8) }}</span>
          <span class="session-time">{{ formatTime(child.time.updated) }}</span>

          <button
            v-if="isBusy(child.id)"
            type="button"
            class="row-action danger"
            :title="t('sidebar.abortSession')"
            @click.stop="emit('abort', child.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <button
            type="button"
            class="row-action danger"
            :title="t('sidebar.deleteSession')"
            @click.stop="emit('delete', child.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
              />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <div
      v-for="session in orphanSessions"
      :key="session.id"
      role="button"
      tabindex="0"
      class="session-row"
      :class="{ active: activeSessionId === session.id }"
      @click="emit('select', session.id)"
      @keydown.enter.space.prevent="emit('select', session.id)"
    >
      <span
        class="session-dot"
        :class="{
          busy: isBusy(session.id),
          pinned: !isBusy(session.id) && statusIcon(session) === 'pinned',
          archived: !isBusy(session.id) && statusIcon(session) === 'archived',
        }"
      />
      <span class="session-title">{{ session.title || session.id.slice(0, 8) }}</span>
      <span class="session-time">{{ formatTime(session.time.updated) }}</span>
      <button
        v-if="isBusy(session.id)"
        type="button"
        class="row-action danger"
        :title="t('sidebar.abortSession')"
        @click.stop="emit('abort', session.id)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <button
        type="button"
        class="row-action danger"
        :title="t('sidebar.deleteSession')"
        @click.stop="emit('delete', session.id)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
          />
        </svg>
      </button>
    </div>

    <div v-if="rootSessions.length === 0 && orphanSessions.length === 0" class="session-empty">
      {{ t("sidebar.noSessions") }}
    </div>
  </div>
</template>

<style scoped>
.session-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-row,
.subthread-row {
  position: relative;
  width: 100%;
  min-height: 42px;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto auto auto;
  align-items: center;
  column-gap: 8px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}

.session-row:hover,
.subthread-row:hover {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}

.session-row.active,
.subthread-row.active {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 18%, transparent),
      color-mix(in srgb, var(--color-accent-indigo, #6366f1) 8%, transparent)
    ),
    color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 4%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 21%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}

.session-row.active::before,
.subthread-row.active::before {
  content: "";
  position: absolute;
  left: -1px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 999px;
  background: var(--color-accent-cyan, #06b6d4);
  box-shadow: 0 0 14px color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 58%, transparent);
}

.session-disclosure {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.session-disclosure svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s ease;
}

.session-disclosure.expanded svg {
  transform: rotate(90deg);
}

.session-dot {
  width: 7px;
  height: 7px;
  justify-self: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-500, #64748b) 55%, transparent);
}

.session-dot.busy {
  background: var(--color-accent-emerald, #10b981);
  box-shadow: 0 0 11px color-mix(in srgb, var(--color-accent-emerald, #10b981) 70%, transparent);
}

.session-dot.pinned {
  background: var(--color-accent-amber, #f59e0b);
}

.session-dot.archived {
  background: var(--color-surface-600, #475569);
}

.session-dot.subagent {
  background: color-mix(in srgb, var(--color-accent-indigo, #6366f1) 70%, transparent);
}

.session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.25;
}

.session-time {
  color: var(--color-surface-600, #475569);
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.session-row:hover .session-time,
.subthread-row:hover .session-time,
.session-row.active .session-time,
.subthread-row.active .session-time {
  opacity: 1;
}

.child-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-indigo, #6366f1) 15%, transparent);
  color: color-mix(in srgb, var(--color-accent-indigo, #6366f1) 72%, var(--color-surface-100));
  font-size: 10px;
  font-weight: 800;
}

.row-action {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    background-color 0.12s ease,
    color 0.12s ease;
}

.session-row:hover .row-action,
.subthread-row:hover .row-action {
  opacity: 1;
}

.row-action svg {
  width: 12px;
  height: 12px;
  stroke-width: 2;
}

.row-action.danger:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 17%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.subthread-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 1px 0 1px 22px;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--color-surface-600, #475569) 28%, transparent);
}

.subthread-row {
  min-height: 34px;
  grid-template-columns: 7px minmax(0, 1fr) auto auto auto;
  padding: 6px 8px;
  border-radius: 0 10px 10px 0;
  color: var(--color-surface-500, #64748b);
}

.subthread-row .session-title {
  font-size: 12px;
}

.session-empty {
  padding: 28px 8px;
  text-align: center;
  color: var(--color-surface-600, #475569);
  font-size: 13px;
}
</style>
