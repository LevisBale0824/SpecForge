<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { stripSystemReminder, useMessages } from "../composables/useMessages";
import { useAutoScroller, type ScrollMode } from "../composables/useAutoScroller";
import ThreadBlock from "./ThreadBlock.vue";

const props = defineProps<{
  sessionId: string;
}>();

const msgStore = useMessages();
function hasVisibleText(id: string): boolean {
  return msgStore.getParts(id).some((part) => {
    if (part.type !== "text" || part.synthetic) return false;
    return stripSystemReminder(part.text).trim().length > 0;
  });
}

const thread = computed(() =>
  msgStore.getThread(props.sessionId).filter((message) => {
    if (message.role === "user") return msgStore.isDisplayable(message.id);
    return msgStore.getStatus(message.id) === "streaming" || hasVisibleText(message.id);
  }),
);

// ── Auto-scroll-to-bottom ────────────────────────────────────────────────
// The browser's default `overflow-anchor: auto` is unreliable once the user
// has scrolled away from the bottom — after scrolling back down, newly
// appended content can still pull the viewport away from the bottom because
// the anchor element is somewhere in the middle. We drive scroll explicitly
// via useAutoScroller, which pauses follow on user scroll-up and resumes when
// the user returns to the bottom.
const containerEl = ref<HTMLElement>();
const scrollMode = ref<ScrollMode>("follow");
const { notifyContentChange, showResumeButton, resumeFollow, resetFollow } = useAutoScroller(
  containerEl,
  scrollMode,
);

// Signature that changes whenever the visible content grows: thread length,
// last message id, and the current character count of the last message. This
// fires both on new messages and on every streaming token batch, which is
// exactly when we want to follow.
const contentSignature = computed(() => {
  const last = thread.value[thread.value.length - 1];
  const lastTextLen = last ? msgStore.getTextContent(last.id).length : 0;
  return `${thread.value.length}:${last?.id ?? ""}:${lastTextLen}`;
});

watch(contentSignature, () => {
  notifyContentChange(true);
});

// When switching sessions, snap to the bottom instantly (no smooth scroll
// across the old content).
watch(
  () => props.sessionId,
  () => {
    resetFollow();
    notifyContentChange(false);
  },
);
</script>

<template>
  <div class="message-viewer">
    <div ref="containerEl" class="message-viewer-scroll flex-1 overflow-y-auto py-4">
      <div
        v-if="thread.length === 0"
        class="flex items-center justify-center h-full text-surface-600 text-sm"
      >
        Start a conversation...
      </div>
      <div v-else class="space-y-2">
        <ThreadBlock v-for="message in thread" :key="message.id" :message="message" />
      </div>
    </div>

    <!-- Resume button: shown when follow is paused (user scrolled up).
         Positioned absolutely over the scroll container so it stays put. -->
    <button
      v-if="showResumeButton"
      type="button"
      class="resume-btn"
      title="回到最新输出"
      @click="resumeFollow(true)"
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
      <span>最新</span>
    </button>
  </div>
</template>

<style scoped>
.message-viewer {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.message-viewer-scroll {
  flex: 1;
  min-height: 0;
}

.resume-btn {
  position: absolute;
  left: 50%;
  bottom: 0.75rem;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 50%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 88%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
  cursor: pointer;
  backdrop-filter: blur(4px);
  z-index: 10;
  transition:
    background 0.15s ease,
    transform 0.15s ease;
}
.resume-btn:hover {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 22%, transparent);
}
</style>
