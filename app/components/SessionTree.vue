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

// Sort helper: pinned first, then by updated descending.
function sortByDefault(list: SessionInfo[]): SessionInfo[] {
  return list.sort((a, b) => {
    if (a.time.pinned && !b.time.pinned) return -1;
    if (!a.time.pinned && b.time.pinned) return 1;
    return (b.time.updated ?? 0) - (a.time.updated ?? 0);
  });
}

// Cap the rendered list so a backlog of hundreds of historical sessions
// doesn't tank DOM performance. Sorted by recency first (sortByDefault),
// then sliced — older sessions stay in storage / backend, just not rendered.
const MAX_ROOT_SESSIONS = 100;

// Root sessions: no parentID.
const rootSessions = computed(() =>
  sortByDefault([...props.sessions].filter((s) => !s.parentID)).slice(0, MAX_ROOT_SESSIONS),
);

// Children grouped by parentID (only one level).
const childrenByParent = computed(() => {
  const map = new Map<string, SessionInfo[]>();
  const parentIds = new Set(props.sessions.map((s) => s.id));
  for (const s of props.sessions) {
    if (!s.parentID) continue;
    // Orphan: parent not loaded yet. Skip here, handled separately.
    if (!parentIds.has(s.parentID)) continue;
    const arr = map.get(s.parentID) ?? [];
    arr.push(s);
    map.set(s.parentID, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0));
  }
  return map;
});

// Orphan children: have parentID but parent session not in the list.
const orphanSessions = computed(() =>
  sortByDefault(
    props.sessions.filter((s) => s.parentID && !props.sessions.some((p) => p.id === s.parentID)),
  ),
);

// Expanded parent ids. Default empty = all collapsed. Most users don't need
// to see sub-agent sessions every time they open the sidebar — the children
// badge already tells them how many there are. Opt-in expansion via the
// toggle button keeps the list scannable.
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

// Auto-expand the parent when activating one of its children, so the active
// sub-agent stays visible in the sidebar instead of being hidden by the
// default-collapsed state.
watch(
  () => props.activeSessionId,
  (newId) => {
    if (!newId) return;
    const child = props.sessions.find((s) => s.id === newId);
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
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return t("sidebar.justNow");
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
  <div class="space-y-0.5">
    <template v-for="session in rootSessions" :key="session.id">
      <!-- Root session row -->
      <button
        class="w-full text-left px-2.5 py-2 rounded text-sm transition-colors group"
        :class="
          activeSessionId === session.id
            ? 'bg-accent-cyan/10 text-surface-100'
            : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
        "
        @click="emit('select', session.id)"
      >
        <div class="flex items-center gap-1.5">
          <!-- Collapse toggle (only when has children) -->
          <button
            v-if="childrenOf(session.id).length > 0"
            class="flex-shrink-0 w-3 h-3 flex items-center justify-center text-surface-500 hover:text-surface-200 transition-colors"
            :title="isExpanded(session.id) ? t('sidebar.collapse') : t('sidebar.expand')"
            @click.stop="toggleCollapse(session.id)"
          >
            <svg
              class="w-2.5 h-2.5 transition-transform"
              :class="isExpanded(session.id) ? 'rotate-90' : ''"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                clip-rule="evenodd"
                fill-rule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              />
            </svg>
          </button>
          <!-- Status dot: busy pulse > pinned/archived > empty placeholder -->
          <span
            v-if="isBusy(session.id)"
            class="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse flex-shrink-0"
          />
          <span
            v-else-if="childrenOf(session.id).length === 0 && statusIcon(session)"
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"
            :class="statusIcon(session) === 'pinned' ? 'bg-accent-amber' : 'bg-surface-600'"
          />
          <span v-else-if="childrenOf(session.id).length === 0" class="w-1.5 h-1.5 flex-shrink-0" />

          <!-- Title -->
          <span class="truncate flex-1">
            {{ session.title || session.id.slice(0, 8) }}
          </span>

          <!-- Children count badge -->
          <span
            v-if="childrenOf(session.id).length > 0"
            class="text-xs text-surface-500 bg-surface-800 rounded px-1.5 leading-tight"
          >
            {{ childrenOf(session.id).length }}
          </span>

          <!-- Time -->
          <span
            class="text-xs text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {{ formatTime(session.time.updated) }}
          </span>

          <!-- Abort button (only when busy) -->
          <button
            v-if="isBusy(session.id)"
            class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
            :title="t('sidebar.abortSession')"
            @click.stop="emit('abort', session.id)"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <!-- Delete button -->
          <button
            class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
            :title="t('sidebar.deleteSession')"
            @click.stop="emit('delete', session.id)"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
              />
            </svg>
          </button>
        </div>
      </button>

      <!-- Children list (one level deep) -->
      <div
        v-if="isExpanded(session.id) && childrenOf(session.id).length > 0"
        class="mt-0.5 space-y-0.5"
      >
        <button
          v-for="child in childrenOf(session.id)"
          :key="child.id"
          class="w-full text-left pl-7 pr-2.5 py-1.5 rounded text-sm transition-colors group"
          :class="
            activeSessionId === child.id
              ? 'bg-accent-cyan/10 text-surface-100'
              : 'text-surface-500 hover:bg-surface-800 hover:text-surface-300'
          "
          @click="emit('select', child.id)"
        >
          <div class="flex items-center gap-1.5">
            <!-- Subagent dot: busy pulse overrides the idle indigo dot -->
            <span
              v-if="isBusy(child.id)"
              class="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse flex-shrink-0"
            />
            <span v-else class="w-1.5 h-1.5 rounded-full bg-accent-indigo/70 flex-shrink-0" />

            <!-- Title -->
            <span class="truncate flex-1 text-[13px]">
              {{ child.title || child.id.slice(0, 8) }}
            </span>

            <!-- Time -->
            <span
              class="text-xs text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {{ formatTime(child.time.updated) }}
            </span>

            <!-- Abort button (only when busy) -->
            <button
              v-if="isBusy(child.id)"
              class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
              :title="t('sidebar.abortSession')"
              @click.stop="emit('abort', child.id)"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <!-- Delete button -->
            <button
              class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
              :title="t('sidebar.deleteSession')"
              @click.stop="emit('delete', child.id)"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                />
              </svg>
            </button>
          </div>
        </button>
      </div>
    </template>

    <!-- Orphan sessions (parent not loaded) -->
    <button
      v-for="session in orphanSessions"
      :key="session.id"
      class="w-full text-left px-2.5 py-2 rounded text-sm transition-colors group"
      :class="
        activeSessionId === session.id
          ? 'bg-accent-cyan/10 text-surface-100'
          : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
      "
      @click="emit('select', session.id)"
    >
      <div class="flex items-center gap-1.5">
        <span
          v-if="isBusy(session.id)"
          class="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse flex-shrink-0"
        />
        <span
          v-else-if="statusIcon(session)"
          class="w-1.5 h-1.5 rounded-full flex-shrink-0"
          :class="statusIcon(session) === 'pinned' ? 'bg-accent-amber' : 'bg-surface-600'"
        />
        <span v-else class="w-1.5 h-1.5 flex-shrink-0" />
        <span class="truncate flex-1">
          {{ session.title || session.id.slice(0, 8) }}
        </span>
        <span class="text-xs text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity">
          {{ formatTime(session.time.updated) }}
        </span>
        <button
          v-if="isBusy(session.id)"
          class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
          :title="t('sidebar.abortSession')"
          @click.stop="emit('abort', session.id)"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        <button
          class="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-accent-rose/20 hover:text-accent-rose text-surface-500 transition-all"
          :title="t('sidebar.deleteSession')"
          @click.stop="emit('delete', session.id)"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
            />
          </svg>
        </button>
      </div>
    </button>

    <div
      v-if="rootSessions.length === 0 && orphanSessions.length === 0"
      class="text-center py-8 text-surface-600 text-sm"
    >
      {{ t("sidebar.noSessions") }}
    </div>
  </div>
</template>
