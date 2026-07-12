<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MessageContent from "./MessageContent.vue";
import TokenBarChart from "./TokenBarChart.vue";
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

const tokenPanelCollapsed = ref(true);

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
  <div class="relative flex min-h-0 flex-1 flex-col bg-white">
    <!-- Token usage header (collapsible, pinned above the scroll area) -->
    <div
      class="chat-padding mb-3 flex-shrink-0 transition-[padding] duration-200"
      :class="tokenPanelCollapsed ? 'py-1.5' : 'py-3'"
    >
      <!-- Collapsed: single compact line -->
      <button
        v-if="tokenPanelCollapsed"
        type="button"
        class="flex w-full items-center justify-between"
        @click="tokenPanelCollapsed = false"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium text-zinc-500">{{
            t("chat.tokenUsage.sessionTotal")
          }}</span>
          <span class="font-mono text-sm font-bold tabular-nums text-zinc-800">
            {{ sessionStats.totalTokens.toLocaleString() }}
          </span>
        </div>
        <div class="flex items-center gap-3 font-mono text-[11px] tabular-nums">
          <span class="flex items-center gap-1">
            <span class="font-semibold text-sky-500">{{ t("chat.tokenUsage.input") }}</span>
            <span class="seg-val seg-input-val">{{ segmentTotals.input.toLocaleString() }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="font-semibold text-emerald-500">{{ t("chat.tokenUsage.output") }}</span>
            <span class="seg-val seg-output-val">{{ segmentTotals.output.toLocaleString() }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="font-semibold text-indigo-500">{{ t("chat.tokenUsage.reasoning") }}</span>
            <span class="seg-val seg-reasoning-val">{{
              segmentTotals.reasoning.toLocaleString()
            }}</span>
          </span>
          <span class="flex items-center gap-1">
            <span class="font-semibold text-zinc-500">{{ t("chat.tokenUsage.cache") }}</span>
            <span class="seg-val seg-cache-val">{{ segmentTotals.cache.toLocaleString() }}</span>
          </span>
          <svg
            class="text-zinc-400 transition-transform"
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
        <div class="h-12 w-px flex-shrink-0 bg-zinc-200" />

        <!-- Stats panel (right) -->
        <div class="flex flex-shrink-0 flex-col items-end gap-1.5">
          <!-- Row 1: total + collapse toggle -->
          <div class="flex items-baseline gap-2">
            <span class="text-xs font-medium text-zinc-400">{{
              t("chat.tokenUsage.sessionTotal")
            }}</span>
            <span class="font-mono text-xl font-bold leading-none tabular-nums text-zinc-900">
              {{ sessionStats.totalTokens.toLocaleString() }}
            </span>
            <span class="text-[10px] text-zinc-500">{{ t("chat.tokenUsage.tokens") }}</span>
            <button
              type="button"
              class="ml-1 flex items-center text-zinc-500 transition-colors hover:text-zinc-600"
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
          <div class="flex items-center gap-4 font-mono text-[13px] tabular-nums leading-none">
            <span class="flex items-center gap-1.5">
              <span class="seg-dot seg-input" />
              <span class="font-semibold text-sky-500">{{ t("chat.tokenUsage.input") }}</span>
              <span class="seg-val seg-input-val">{{ segmentTotals.input.toLocaleString() }}</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="seg-dot seg-output" />
              <span class="font-semibold text-emerald-500">{{ t("chat.tokenUsage.output") }}</span>
              <span class="seg-val seg-output-val">{{
                segmentTotals.output.toLocaleString()
              }}</span>
            </span>
          </div>
          <!-- Row 3: reasoning + cache -->
          <div class="flex items-center gap-4 font-mono text-[13px] tabular-nums leading-none">
            <span class="flex items-center gap-1.5">
              <span class="seg-dot seg-reasoning" />
              <span class="font-semibold text-indigo-500">{{
                t("chat.tokenUsage.reasoning")
              }}</span>
              <span class="seg-val seg-reasoning-val">{{
                segmentTotals.reasoning.toLocaleString()
              }}</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="seg-dot seg-cache" />
              <span class="font-semibold text-zinc-500">{{ t("chat.tokenUsage.cache") }}</span>
              <span class="seg-val seg-cache-val">{{ segmentTotals.cache.toLocaleString() }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div
      ref="containerEl"
      class="chat-padding min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white pb-5 [overscroll-behavior:contain] [overflow-anchor:none]"
    >
      <!-- Empty state -->
      <div
        v-if="allMessages.length === 0"
        class="flex items-center justify-center h-full text-slate-500 text-sm"
      >
        开始对话...
      </div>

      <!-- Messages -->
      <div v-else class="w-full space-y-1.5">
        <div
          v-for="msg in allMessages"
          :key="msg.id"
          class="relative flex w-full items-start gap-2"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <template v-if="msg.role === 'assistant'">
            <img
              :src="agentAvatarSrc"
              alt="Agent"
              class="mt-0.5 h-10 w-10 flex-shrink-0 rounded-full object-cover ring-1 ring-surface-700/50"
            />

            <div class="group flex w-[70%] min-w-0 flex-col items-start">
              <div
                class="msg-bubble min-w-0 w-full rounded-xl border border-black/5 bg-white/70 px-4 py-3 text-sm leading-relaxed text-zinc-800 shadow-sm backdrop-blur-md"
              >
                <div class="mb-0.5 flex items-center gap-2">
                  <span class="text-[10px] font-semibold tracking-wider text-emerald-600">
                    {{ agentName }}
                  </span>
                  <span v-if="formatMessageTime(msg.created)" class="text-[10px] text-zinc-400">{{
                    formatMessageTime(msg.created)
                  }}</span>
                </div>
                <MessageContent
                  :message-id="msg.id"
                  @navigate-session="$emit('navigate-session', $event)"
                />
              </div>
              <button
                v-if="messagePlainText(msg.id)"
                type="button"
                class="mt-1 inline-flex items-center gap-1 self-start text-[10px] text-zinc-400 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100"
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
            <div class="group flex max-w-[70%] min-w-0 flex-col items-end">
              <div
                class="msg-bubble min-w-0 rounded-xl border border-sky-500/20 bg-sky-500/8 px-4 py-3 text-sm leading-relaxed text-zinc-800 shadow-sm backdrop-blur-md"
              >
                <div class="mb-0.5 flex items-center gap-2">
                  <span class="text-[10px] font-semibold tracking-wider text-sky-600">
                    {{ userName }}
                  </span>
                  <span v-if="formatMessageTime(msg.created)" class="text-[10px] text-zinc-400">{{
                    formatMessageTime(msg.created)
                  }}</span>
                </div>
                <MessageContent
                  :message-id="msg.id"
                  @navigate-session="$emit('navigate-session', $event)"
                />
              </div>
              <button
                v-if="messagePlainText(msg.id)"
                type="button"
                class="mt-1 inline-flex items-center gap-1 self-start text-[10px] text-zinc-400 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100"
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

            <img
              :src="userAvatarSrc"
              alt="User"
              class="mt-0.5 h-10 w-10 flex-shrink-0 rounded-full object-cover ring-1 ring-surface-700/50"
            />
          </template>
        </div>
      </div>
    </div>

    <div class="jump-nav">
      <button
        v-if="!showResumeButton"
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-500 shadow-sm backdrop-blur transition-colors hover:bg-zinc-100"
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
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-500/30 bg-white/90 text-sky-500 shadow-sm backdrop-blur transition-colors hover:bg-sky-50"
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
.jump-nav {
  position: absolute;
  right: 80px;
  bottom: 1rem;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
@media (min-width: 768px) {
  .jump-nav {
    right: 120px;
  }
}
@media (min-width: 1024px) {
  .jump-nav {
    right: min(540px, calc((100% - 640px) / 2));
  }
}

.seg-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.seg-dot.seg-output {
  background: #10b981;
}
.seg-dot.seg-reasoning {
  background: #6366f1;
}
.seg-dot.seg-input {
  background: #0ea5e9;
}
.seg-dot.seg-cache {
  background: #71717a;
}

.seg-val {
  font-weight: 600;
}
.seg-output-val {
  color: #10b981;
}
.seg-reasoning-val {
  color: #6366f1;
}
.seg-input-val {
  color: #0ea5e9;
}
.seg-cache-val {
  color: #71717a;
}
</style>
