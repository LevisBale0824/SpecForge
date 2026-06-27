<script setup lang="ts">
import { computed } from "vue";
import type { MessageInfo, ReasoningPart } from "../types/sse";
import { useMessages } from "../composables/useMessages";

const props = defineProps<{
  message: MessageInfo;
}>();

const msgStore = useMessages();

const isUser = computed(() => props.message.role === "user");
const status = computed(() => msgStore.getStatus(props.message.id));
const textContent = computed(() => msgStore.getTextContent(props.message.id));
const parts = computed(() => msgStore.getParts(props.message.id));

const reasoningParts = computed(() =>
  parts.value.filter((p): p is ReasoningPart => p.type === "reasoning"),
);

const isStreaming = computed(() => status.value === "streaming");

// Format the message's created timestamp for the bubble header. Same ms/seconds
// heuristic as ChatView — server endpoints disagree on units, and a wrong
// guess pushes the date into the far future and renders as garbage.
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
</script>

<template>
  <div
    class="flex w-full px-5 py-2.5 md:px-10 lg:px-14"
    :class="isUser ? 'justify-end' : 'justify-start'"
  >
    <div
      class="max-w-[min(820px,calc(100%-3.5rem))] rounded-lg px-4 py-3 text-sm leading-relaxed"
      :class="isUser ? 'bg-accent-cyan/10 text-surface-100' : 'bg-surface-800/80 text-surface-200'"
    >
      <!-- Role label -->
      <div class="mb-1.5 flex items-center gap-2">
        <span
          class="text-[10px] font-semibold uppercase tracking-wider"
          :class="isUser ? 'text-accent-cyan' : 'text-accent-emerald'"
        >
          {{ isUser ? "You" : message.agent || "Assistant" }}
        </span>
        <span v-if="formatMessageTime(message.time?.created)" class="text-[10px] text-surface-500">
          {{ formatMessageTime(message.time?.created) }}
        </span>
        <span v-if="isStreaming" class="animate-pulse text-[10px] text-accent-amber">
          streaming...
        </span>
        <span v-if="status === 'error'" class="text-[10px] text-accent-rose"> error </span>
      </div>

      <!-- Reasoning blocks (collapsed by default) -->
      <details v-for="part in reasoningParts" :key="part.id" class="mb-2">
        <summary class="cursor-pointer text-[10px] text-surface-500 hover:text-surface-300">
          思考过程
        </summary>
        <pre
          class="mt-1 max-h-40 overflow-y-auto rounded bg-surface-900 p-2 font-mono text-xs whitespace-pre-wrap text-surface-400"
          >{{ part.text }}</pre
        >
      </details>

      <!-- Text content -->
      <div v-if="textContent" class="whitespace-pre-wrap text-sm leading-relaxed">
        {{ textContent }}
      </div>
      <div v-else-if="isStreaming" class="flex items-center gap-1">
        <span class="inline-block h-4 w-1.5 animate-pulse bg-accent-cyan/60" />
      </div>
    </div>
  </div>
</template>
