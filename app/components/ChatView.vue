<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MessageContent from "./MessageContent.vue";
import TokenBarChart from "./TokenBarChart.vue";
import SessionDiffPanel from "./SessionDiffPanel.vue";
import { stripSystemReminder, useMessages } from "../composables/useMessages";
import { useAutoScroller, type ScrollMode } from "../composables/useAutoScroller";
import { useDisplayNames } from "../composables/useDisplayNames";
import { useBackend } from "../composables/useBackend";
import { useI18n } from "vue-i18n";

defineEmits<{
  "navigate-session": [sessionId: string];
}>();

const msgStore = useMessages();
const backend = useBackend();
const { t } = useI18n();
const { agentName, userName } = useDisplayNames();

// Public-dir asset URLs must be prefixed with BASE_URL so they resolve under
// any Vite `base` setting. With `base: "./"` (used for Electron file:// loads)
// a hard-coded `/avatars/...` would point at the filesystem root inside an
// AppImage and 404 — BASE_URL keeps the path relative to index.html.
const avatarBaseUrl = import.meta.env.BASE_URL;
const agentAvatarSrc = `${avatarBaseUrl}avatars/agent.png`;
const userAvatarSrc = `${avatarBaseUrl}avatars/user.png`;

// Whether a message has any content that MessageContent actually renders
// inline. Keep this aligned with MessageContent's block builder so hidden part
// types do not leave a bubble with only the agent label.
function hasRenderableParts(id: string): boolean {
  return msgStore.getParts(id).some((part) => {
    switch (part.type) {
      case "text":
        return !part.synthetic && stripSystemReminder(part.text).trim().length > 0;
      case "tool":
        return true;
      case "reasoning":
        return part.text.trim().length > 0;
      default:
        return false;
    }
  });
}

function shouldShowMessage(id: string, role: string): boolean {
  if (role === "user") return msgStore.isDisplayable(id);
  return msgStore.getStatus(id) === "streaming" || hasRenderableParts(id);
}

// Format a message timestamp for the bubble header. Tolerates both second
// and millisecond precision (opencode server is inconsistent across endpoints)
// — same heuristic as SessionTree's formatTime. Today's messages show HH:mm;
// older messages prefix the date so the timeline stays readable when scrolling
// back through history.
function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return "";
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const allMessages = computed(() => {
  return msgStore
    .list()
    .filter((message) => shouldShowMessage(message.id, message.role))
    .map((message) => ({
      id: message.id,
      role: message.role,
      sessionID: message.sessionID,
      created: message.time?.created,
    }));
});

const currentSessionId = computed(() => {
  if (backend.selectedSessionId.value) return backend.selectedSessionId.value;
  const firstAssistant = allMessages.value.find((m) => m.role === "assistant");
  return firstAssistant?.sessionID ?? "";
});

const sessionStats = computed(() => msgStore.getSessionUsageStats(currentSessionId.value).value);

const segmentTotals = computed(() => {
  const bars = sessionStats.value.bars;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cache = 0;
  for (const b of bars) {
    input += b.segments.input;
    output += b.segments.output;
    reasoning += b.segments.reasoning;
    cache += b.segments.cache;
  }
  return { input, output, reasoning, cache };
});

const tokenPanelCollapsed = ref(false);

// Session-level diff panel: toggleable right-side column showing all file
// changes in the current session. Reads from msgStore.getSessionDiffs which
// is kept in sync by useBackend's scheduleDiffRefresh (fires on file.edited,
// assistant completion, session switch).
const showDiffPanel = ref(false);
const diffCount = computed(() => {
  const sessionId = currentSessionId.value;
  if (!sessionId) return 0;
  const diffs = msgStore.getSessionDiffs(sessionId);
  if (!diffs) return 0;
  const files = new Set<string>();
  for (const d of diffs) {
    if (d.file) files.add(d.file);
  }
  return files.size;
});

const containerEl = ref<HTMLElement>();
const scrollMode = ref<ScrollMode>("follow");
const historyScrollLocked = ref(true);
const { notifyContentChange, showResumeButton, resumeFollow, pauseFollow, isFollowing } =
  useAutoScroller(containerEl, scrollMode, {
    smoothOnInitialFollow: false,
    scrollOnSetup: false,
  });

watch(
  () => msgStore.contentVersion.value,
  () => {
    if (historyScrollLocked.value) return;
    notifyContentChange(false);
  },
  { flush: "post" },
);

watch(
  () => allMessages.value[0]?.id,
  () => {
    // Session switched or first message arrived — land on the latest
    // message (bottom) instead of the top of history.
    historyScrollLocked.value = false;
    resumeFollow(false);
  },
  { flush: "post" },
);

watch(isFollowing, (following) => {
  if (following) historyScrollLocked.value = false;
});

function jumpToLatest() {
  historyScrollLocked.value = false;
  resumeFollow(false);
}

function jumpToTop() {
  historyScrollLocked.value = true;
  pauseFollow();
  const el = containerEl.value;
  // Instant (not smooth): a smooth scroll passes through the bottom
  // threshold zone where onScroll would re-set isFollowing=true and flip
  // the button back. scrollToBottom in jumpToLatest is instant too.
  if (el) el.scrollTop = 0;
}

// Copyable plaintext of a message: concatenation of non-synthetic text
// parts with system reminders stripped. Reasoning/tool output excluded —
// "copy" means the message body, not the process trace.
function messagePlainText(msgId: string): string {
  const parts = msgStore.getParts(msgId);
  let text = "";
  for (const p of parts) {
    if (p.type === "text" && !p.synthetic) {
      text += stripSystemReminder(p.text) + "\n\n";
    }
  }
  return text.trim();
}

const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
async function copyMessage(msgId: string) {
  const text = messagePlainText(msgId);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedId.value = msgId;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedId.value = null;
  }, 1500);
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1">
    <div
      ref="containerEl"
      class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 md:px-10 lg:px-14 [overscroll-behavior:contain] [overflow-anchor:none]"
    >
      <!-- Token usage sticky header (collapsible) -->
      <div
        class="sticky top-0 z-10 -mx-5 mb-3 border-b border-surface-800/80 bg-surface-950/95 px-5 backdrop-blur transition-[padding] duration-200 md:-mx-10 md:px-10 lg:-mx-14 lg:px-14"
        :class="tokenPanelCollapsed ? 'py-1.5' : 'py-3'"
      >
        <!-- Collapsed: single compact line -->
        <button
          v-if="tokenPanelCollapsed"
          type="button"
          class="flex w-full items-center justify-between"
          @click="tokenPanelCollapsed = false"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm font-bold tabular-nums text-surface-100">
              {{ sessionStats.totalTokens.toLocaleString() }}
            </span>
            <span class="text-[10px] text-surface-600">{{ t("chat.tokenUsage.tokens") }}</span>
          </div>
          <div class="flex items-center gap-3 font-mono text-[10px] tabular-nums text-surface-600">
            <span class="flex items-center gap-1">
              <span class="seg-dot seg-input" />
              {{ segmentTotals.input.toLocaleString() }}
            </span>
            <span class="flex items-center gap-1">
              <span class="seg-dot seg-output" />
              {{ segmentTotals.output.toLocaleString() }}
            </span>
            <span class="flex items-center gap-1">
              <span class="seg-dot seg-reasoning" />
              {{ segmentTotals.reasoning.toLocaleString() }}
            </span>
            <span class="flex items-center gap-1">
              <span class="seg-dot seg-cache" />
              {{ segmentTotals.cache.toLocaleString() }}
            </span>
            <svg
              class="text-surface-600 transition-transform"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>

        <!-- Expanded: full panel -->
        <div v-else class="flex items-center gap-5">
          <!-- Bar chart -->
          <div class="min-w-0 flex-1">
            <TokenBarChart :bars="sessionStats.bars" />
          </div>

          <!-- Divider -->
          <div class="h-12 w-px flex-shrink-0 bg-surface-800" />

          <!-- Stats panel (right) -->
          <div class="flex flex-shrink-0 flex-col items-end gap-1.5">
            <!-- Row 1: total + collapse toggle -->
            <div class="flex items-baseline gap-2">
              <span class="text-xs font-medium text-surface-500">{{
                t("chat.tokenUsage.sessionTotal")
              }}</span>
              <span class="font-mono text-xl font-bold leading-none tabular-nums text-surface-50">
                {{ sessionStats.totalTokens.toLocaleString() }}
              </span>
              <span class="text-[10px] text-surface-600">{{ t("chat.tokenUsage.tokens") }}</span>
              <button
                type="button"
                class="ml-1 flex items-center text-surface-600 transition-colors hover:text-surface-400"
                :title="t('chat.tokenUsage.collapse')"
                @click="tokenPanelCollapsed = true"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <!-- Row 2: input + output -->
            <div class="flex items-center gap-4 font-mono text-xs tabular-nums leading-none">
              <span class="flex items-center gap-1.5">
                <span class="seg-dot seg-input" />
                <span class="text-surface-500">{{ t("chat.tokenUsage.input") }}</span>
                <span class="seg-val seg-input-val">{{
                  segmentTotals.input.toLocaleString()
                }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span class="seg-dot seg-output" />
                <span class="text-surface-500">{{ t("chat.tokenUsage.output") }}</span>
                <span class="seg-val seg-output-val">{{
                  segmentTotals.output.toLocaleString()
                }}</span>
              </span>
            </div>
            <!-- Row 3: reasoning + cache -->
            <div class="flex items-center gap-4 font-mono text-xs tabular-nums leading-none">
              <span class="flex items-center gap-1.5">
                <span class="seg-dot seg-reasoning" />
                <span class="text-surface-500">{{ t("chat.tokenUsage.reasoning") }}</span>
                <span class="seg-val seg-reasoning-val">{{
                  segmentTotals.reasoning.toLocaleString()
                }}</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span class="seg-dot seg-cache" />
                <span class="text-surface-500">{{ t("chat.tokenUsage.cache") }}</span>
                <span class="seg-val seg-cache-val">{{
                  segmentTotals.cache.toLocaleString()
                }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="allMessages.length === 0"
        class="flex items-center justify-center h-full text-surface-600 text-sm"
      >
        Start a conversation...
      </div>

      <!-- Messages -->
      <div v-else class="w-full space-y-5">
        <div
          v-for="msg in allMessages"
          :key="msg.id"
          class="flex w-full items-start gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <template v-if="msg.role === 'assistant'">
            <!-- Avatar -->
            <img
              :src="agentAvatarSrc"
              alt="Agent"
              class="mt-0.5 h-9 w-9 flex-shrink-0 rounded-full object-cover ring-1 ring-surface-700/50"
            />

            <div class="group flex min-w-0 max-w-[85%] flex-col items-start">
              <!-- Bubble -->
              <div
                class="min-w-[180px] rounded-lg bg-surface-800/80 px-4 py-3 text-sm leading-relaxed text-surface-200"
              >
                <div class="mb-1 flex items-center gap-2">
                  <span class="text-[10px] font-semibold tracking-wider text-accent-emerald">
                    {{ agentName }}
                  </span>
                  <span
                    v-if="formatMessageTime(msg.created)"
                    class="text-[10px] text-surface-500"
                    >{{ formatMessageTime(msg.created) }}</span
                  >
                </div>
                <MessageContent
                  :message-id="msg.id"
                  @navigate-session="$emit('navigate-session', $event)"
                />
              </div>
              <button
                v-if="messagePlainText(msg.id)"
                type="button"
                class="mt-1 inline-flex items-center gap-1 self-start text-[10px] text-surface-500 opacity-0 transition-opacity hover:text-surface-300 group-hover:opacity-100"
                :title="copiedId === msg.id ? '已复制' : '复制'"
                @click="copyMessage(msg.id)"
              >
                <svg
                  v-if="copiedId === msg.id"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg
                  v-else
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{{ copiedId === msg.id ? "已复制" : "复制" }}</span>
              </button>
            </div>
          </template>

          <template v-else>
            <div class="group flex min-w-0 max-w-[85%] flex-col items-end">
              <!-- Bubble -->
              <div
                class="min-w-[180px] rounded-lg bg-accent-cyan/10 px-4 py-3 text-sm leading-relaxed text-surface-100"
              >
                <div class="mb-1 flex items-center gap-2">
                  <span class="text-[10px] font-semibold tracking-wider text-accent-cyan">
                    {{ userName }}
                  </span>
                  <span
                    v-if="formatMessageTime(msg.created)"
                    class="text-[10px] text-surface-500"
                    >{{ formatMessageTime(msg.created) }}</span
                  >
                </div>
                <MessageContent
                  :message-id="msg.id"
                  @navigate-session="$emit('navigate-session', $event)"
                />
              </div>
              <button
                v-if="messagePlainText(msg.id)"
                type="button"
                class="mt-1 inline-flex items-center gap-1 self-start text-[10px] text-surface-500 opacity-0 transition-opacity hover:text-surface-300 group-hover:opacity-100"
                :title="copiedId === msg.id ? '已复制' : '复制'"
                @click="copyMessage(msg.id)"
              >
                <svg
                  v-if="copiedId === msg.id"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg
                  v-else
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{{ copiedId === msg.id ? "已复制" : "复制" }}</span>
              </button>
            </div>

            <!-- Avatar -->
            <img
              :src="userAvatarSrc"
              alt="User"
              class="mt-0.5 h-9 w-9 flex-shrink-0 rounded-full object-cover ring-1 ring-surface-700/50"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- Session-level diff panel -->
    <SessionDiffPanel
      v-if="showDiffPanel"
      :session-id="currentSessionId"
      @close="showDiffPanel = false"
    />

    <div class="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-lg backdrop-blur transition-colors"
        :class="
          showDiffPanel
            ? 'border-accent-emerald/50 bg-accent-emerald/15 text-accent-emerald'
            : 'border-surface-700 bg-surface-900/90 text-surface-300 hover:bg-surface-800'
        "
        :title="showDiffPanel ? '关闭文件变更面板' : '查看文件变更'"
        @click="showDiffPanel = !showDiffPanel"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M16 3h5v5M8 3H3v5M21 16v5h-5M3 16v5h5M10 7l4 10M14 7l-4 10" />
        </svg>
        <span
          v-if="diffCount > 0 && !showDiffPanel"
          class="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent-emerald px-1 text-[9px] font-bold text-surface-950"
        >
          {{ diffCount }}
        </span>
      </button>
      <button
        v-if="!showResumeButton"
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-surface-700 bg-surface-900/90 text-surface-300 shadow-lg backdrop-blur transition-colors hover:bg-surface-800"
        title="Jump to top"
        @click="jumpToTop"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
      <button
        v-if="showResumeButton"
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-accent-cyan/50 bg-surface-900/90 text-accent-cyan shadow-lg backdrop-blur transition-colors hover:bg-accent-cyan/15"
        title="Jump to latest"
        @click="jumpToLatest"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.seg-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.seg-dot.seg-output {
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 95%, transparent);
}
.seg-dot.seg-reasoning {
  background: color-mix(in srgb, var(--color-accent-indigo, #818cf8) 80%, transparent);
}
.seg-dot.seg-input {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 65%, transparent);
}
.seg-dot.seg-cache {
  background: color-mix(in srgb, var(--color-surface-600, #52525b) 45%, transparent);
}
.seg-val {
  font-weight: 600;
}
.seg-output-val {
  color: color-mix(
    in srgb,
    var(--color-accent-emerald, #34d399) 85%,
    var(--color-surface-200, #e4e4e7)
  );
}
.seg-reasoning-val {
  color: color-mix(
    in srgb,
    var(--color-accent-indigo, #818cf8) 75%,
    var(--color-surface-200, #e4e4e7)
  );
}
.seg-input-val {
  color: color-mix(
    in srgb,
    var(--color-accent-cyan, #22d3ee) 70%,
    var(--color-surface-200, #e4e4e7)
  );
}
.seg-cache-val {
  color: var(--color-surface-400, #a1a1aa);
}
</style>
