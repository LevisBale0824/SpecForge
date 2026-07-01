<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MessageContent from "./MessageContent.vue";
import { stripSystemReminder, useMessages } from "../composables/useMessages";
import { useAutoScroller, type ScrollMode } from "../composables/useAutoScroller";
import { useDisplayNames } from "../composables/useDisplayNames";

defineEmits<{
  "navigate-session": [sessionId: string];
}>();

const msgStore = useMessages();
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
      created: message.time?.created,
    }));
});

const containerEl = ref<HTMLElement>();
const scrollMode = ref<ScrollMode>("follow");
const historyScrollLocked = ref(true);
const { notifyContentChange, showResumeButton, resumeFollow, pauseFollow, isFollowing } =
  useAutoScroller(containerEl, scrollMode, {
    smoothOnInitialFollow: false,
    scrollOnSetup: false,
  });

const contentSignature = computed(() => {
  return allMessages.value
    .map((message) => {
      const partSignature = msgStore
        .getParts(message.id)
        .map((part) => {
          if (part.type === "text") return `${part.id}:text:${part.text.length}`;
          if (part.type === "reasoning") return `${part.id}:reasoning:${part.text.length}`;
          if (part.type === "tool") {
            const state = part.state;
            const outputLength = state.status === "completed" ? state.output.length : 0;
            const errorLength = state.status === "error" ? state.error.length : 0;
            return `${part.id}:tool:${part.tool}:${state.status}:${outputLength}:${errorLength}`;
          }
          return `${part.id}:${part.type}`;
        })
        .join(",");
      return `${message.id}:${message.role}:${msgStore.getStatus(message.id)}:${partSignature}`;
    })
    .join("|");
});

watch(
  contentSignature,
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
      class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-10 lg:px-14 [overscroll-behavior:contain] [overflow-anchor:none]"
    >
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

            <div class="group flex min-w-0 flex-col items-start">
              <!-- Bubble -->
              <div
                class="min-w-[180px] max-w-[min(900px,calc(100%-3.5rem))] rounded-lg bg-surface-800/80 px-4 py-3 text-sm leading-relaxed text-surface-200"
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
            <div class="group flex min-w-0 flex-col items-end">
              <!-- Bubble -->
              <div
                class="min-w-[180px] max-w-[min(900px,calc(100%-3.5rem))] rounded-lg bg-accent-cyan/10 px-4 py-3 text-sm leading-relaxed text-surface-100"
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

    <div class="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5">
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
