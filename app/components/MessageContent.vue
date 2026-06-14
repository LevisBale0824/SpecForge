<script setup lang="ts">
import { computed, ref } from "vue";
import { stripSystemReminder, useMessages } from "../composables/useMessages";
import { renderMarkdown } from "../composables/useMarkdown";
import {
  formatGlobToolTitle,
  formatListToolTitle,
  formatQueryToolTitle,
  formatReadLikeToolTitle,
  formatWebfetchToolTitle,
  resolveReadWritePath,
  toolColor,
} from "./ToolWindow/utils";
import type { ToolPart, ToolState } from "../types/sse";

type DisplayBlock =
  | { kind: "text"; id: string; text: string; html?: string }
  | { kind: "reasoning"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      tool: string;
      state: ToolState;
      title?: string;
      output?: string;
      error?: string;
    };

const props = defineProps<{ messageId: string }>();

const msgStore = useMessages();

const status = computed(() => msgStore.getStatus(props.messageId));
const isUser = computed(() => msgStore.get(props.messageId)?.role === "user");
const isStreaming = computed(() => status.value === "streaming");
const isError = computed(() => status.value === "error");
const error = computed(() => msgStore.getError(props.messageId));

// Resolve a human-readable title for a tool call based on its name and input.
function resolveToolTitle(tool: string, state: ToolState): string | undefined {
  const input =
    state.status === "pending" ? undefined : (state.input as Record<string, unknown> | undefined);
  const metadata =
    state.status === "completed" || state.status === "error" || state.status === "running"
      ? state.metadata
      : undefined;
  const explicitTitle =
    state.status === "running" || state.status === "completed" ? state.title : undefined;
  if (explicitTitle) return explicitTitle;
  switch (tool) {
    case "read":
      return formatReadLikeToolTitle(input);
    case "list":
      return formatListToolTitle(input);
    case "glob":
      return formatGlobToolTitle(input);
    case "webfetch":
    case "websearch":
      return formatWebfetchToolTitle(input);
    case "query":
    case "codesearch":
      return formatQueryToolTitle(input);
    case "edit":
    case "multiedit":
    case "write":
    case "apply_patch":
      return resolveReadWritePath(input, metadata, undefined);
    default:
      return undefined;
  }
}

const inlineBlocks = computed<DisplayBlock[]>(() => {
  const blocks: DisplayBlock[] = [];
  for (const part of msgStore.getParts(props.messageId)) {
    if (part.type === "text") {
      if (part.synthetic) continue;
      const text = stripSystemReminder(part.text);
      if (!text.trim()) continue;
      const html = isUser.value ? undefined : renderMarkdown(text);
      blocks.push({ kind: "text", id: part.id, text, html });
    } else if (part.type === "reasoning") {
      const text = part.text?.trim();
      if (!text) continue;
      blocks.push({ kind: "reasoning", id: part.id, text });
    } else if (part.type === "tool") {
      const toolPart = part as ToolPart;
      const state = toolPart.state;
      const title = resolveToolTitle(toolPart.tool, state);
      const block: DisplayBlock = {
        kind: "tool",
        id: toolPart.id,
        tool: toolPart.tool,
        state,
        title,
      };
      if (state.status === "completed") {
        (block as { output?: string }).output = state.output;
      } else if (state.status === "error") {
        (block as { error?: string }).error = state.error;
      }
      blocks.push(block);
    }
  }
  return blocks;
});

const hasInlineContent = computed(() => inlineBlocks.value.length > 0);
const showThinking = computed(() => isStreaming.value && !isUser.value && !hasInlineContent.value);

const expandedReasoning = ref<Record<string, boolean>>({});
function toggleReasoning(id: string) {
  expandedReasoning.value[id] = !expandedReasoning.value[id];
}

const expandedTools = ref<Record<string, boolean>>({});
function toggleTool(id: string) {
  expandedTools.value[id] = !expandedTools.value[id];
}

function toolStatusText(block: { state: ToolState }): string {
  switch (block.state.status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "done";
    case "error":
      return "error";
  }
}

function toolStatusColor(block: { state: ToolState }): string {
  switch (block.state.status) {
    case "pending":
    case "running":
      return "text-accent-amber";
    case "completed":
      return "text-accent-emerald";
    case "error":
      return "text-accent-rose";
  }
}
</script>

<template>
  <div>
    <template v-for="block in inlineBlocks" :key="block.id">
      <div v-if="block.kind === 'text' && block.html" class="md-content" v-html="block.html" />
      <div v-else-if="block.kind === 'text'" class="whitespace-pre-wrap break-words">
        {{ block.text }}
      </div>

      <div v-else-if="block.kind === 'reasoning'" class="my-1">
        <button
          class="flex items-center gap-1 text-[11px] text-surface-500 transition-colors hover:text-surface-300"
          @click="toggleReasoning(block.id)"
        >
          <span class="text-[9px]">
            {{ expandedReasoning[block.id] ? "▾" : "▸" }}
          </span>
          <span>思考过程</span>
        </button>
        <div
          v-if="expandedReasoning[block.id]"
          class="mt-1 whitespace-pre-wrap border-l border-surface-700 pl-2 text-[12px] italic text-surface-400"
        >
          {{ block.text }}
        </div>
      </div>

      <div v-else-if="block.kind === 'tool'" class="my-1.5">
        <button
          class="group flex w-full items-center gap-1.5 rounded-md border border-surface-800 bg-surface-900/60 px-2 py-1 text-left transition-colors hover:border-surface-700 hover:bg-surface-800/60"
          @click="toggleTool(block.id)"
        >
          <span
            class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
            :style="{ backgroundColor: toolColor(block.tool) }"
          />
          <span
            class="flex-shrink-0 font-mono text-[11px] font-medium"
            :style="{ color: toolColor(block.tool) }"
          >
            {{ block.tool }}
          </span>
          <span
            v-if="block.title"
            class="min-w-0 flex-1 truncate font-mono text-[11px] text-surface-300"
            :title="block.title"
          >
            {{ block.title }}
          </span>
          <span class="flex-shrink-0 text-[10px] uppercase" :class="toolStatusColor(block)">
            {{ toolStatusText(block) }}
          </span>
          <span
            v-if="block.state.status === 'completed' || block.state.status === 'error'"
            class="text-[9px] text-surface-500 transition-colors group-hover:text-surface-300"
          >
            {{ expandedTools[block.id] ? "▾" : "▸" }}
          </span>
          <span
            v-else
            class="inline-block h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border border-accent-amber/30 border-t-accent-amber"
          />
        </button>
        <div
          v-if="expandedTools[block.id] && (block.output || block.error)"
          class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-surface-800 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-surface-300"
          :class="block.error ? 'text-accent-rose' : ''"
        >
          {{ block.error || block.output }}
        </div>
      </div>
    </template>

    <div v-if="showThinking" class="flex items-center gap-1.5 py-1.5">
      <span class="thinking-dot" />
      <span class="thinking-dot" />
      <span class="thinking-dot" />
      <span class="ml-1 text-[11px] text-surface-400">正在思考...</span>
    </div>

    <div v-if="isError" class="mt-1 text-xs text-accent-rose">
      {{ error?.message || "An error occurred" }}
    </div>
  </div>
</template>

<style scoped>
.thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: var(--color-accent-emerald, #34d399);
  opacity: 0.85;
  animation: thinking-bounce 1s ease-in-out infinite;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes thinking-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-4px);
    opacity: 0.95;
  }
}
</style>
