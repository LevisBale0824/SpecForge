<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { stripSystemReminder, useMessages } from "../composables/useMessages";
import { renderMarkdown, renderStreaming } from "../composables/useMarkdown";
import { useSessions } from "../composables/useSessions";
import {
  extractCommand,
  extractEditDiffs,
  extractSubSessionId,
  formatGlobToolTitle,
  formatListToolTitle,
  formatQueryToolTitle,
  formatReadLikeToolTitle,
  formatWebfetchToolTitle,
  isSubAgentTool,
  matchChildSession,
  resolveReadWritePath,
  toolColor,
} from "./ToolWindow/utils";
import type { MessagePart, ToolState } from "../types/sse";
import type { MessageDiffEntry } from "../types/message";
import DiffViewer from "./DiffViewer.vue";

const emit = defineEmits<{
  "navigate-session": [sessionId: string];
}>();

const { t } = useI18n();
const sessionsStore = useSessions();

type DisplayBlock =
  | { kind: "text"; id: string; text: string; html?: string }
  | { kind: "reasoning"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      tool: string;
      state: ToolState;
      title?: string;
      command?: string;
      output?: string;
      error?: string;
      diffs?: MessageDiffEntry[];
      subSessionId?: string;
      subSessionInferred?: boolean;
    };

// A run of consecutive completed tool blocks gets bundled into a single
// summary chip so finished work doesn't drown the conversation. Running and
// errored tools stay as individual chips so the user can see what's
// happening right now (and what failed). Clicking the summary chip expands
// the full list inline.
type ToolBlock = Extract<DisplayBlock, { kind: "tool" }>;
type RenderItem =
  | { kind: "text"; id: string; text: string; html?: string }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; block: ToolBlock }
  | { kind: "tool-group"; id: string; blocks: ToolBlock[]; errorCount: number; hasDiffs: boolean };

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

function preview(value: unknown, max = 240): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function summarizePart(part: MessagePart) {
  if (part.type === "text") {
    return {
      id: part.id,
      type: part.type,
      synthetic: Boolean(part.synthetic),
      textLength: part.text.length,
      text: preview(stripSystemReminder(part.text)),
    };
  }
  if (part.type === "reasoning") {
    return {
      id: part.id,
      type: part.type,
      textLength: part.text.length,
      text: preview(part.text),
    };
  }
  if (part.type === "tool") {
    const state = part.state;
    return {
      id: part.id,
      type: part.type,
      tool: part.tool,
      status: state.status,
      title: resolveToolTitle(part.tool, state),
      input: state.status === "pending" ? preview(state.raw) : preview(state.input),
      output:
        state.status === "completed"
          ? { length: state.output.length, preview: preview(state.output) }
          : undefined,
      error:
        state.status === "error"
          ? { length: state.error.length, preview: preview(state.error) }
          : undefined,
    };
  }
  return { id: part.id, type: part.type };
}

// Resolve a jump target (child session id) for each sub-agent tool block.
// Main path: metadata.sessionId. Fallback: child sessions whose parentID
// matches this message's session, closest by time, excluding ids already
// claimed by an earlier block so concurrent tasks don't collide.
function resolveSubSessions(blocks: DisplayBlock[]): void {
  const parentSessionId = msgStore.get(props.messageId)?.sessionID;
  const candidates = [...sessionsStore.sessions.value.values()];
  const claimed = new Set<string>();
  for (const b of blocks) {
    if (b.kind !== "tool") continue;
    const ref = extractSubSessionId(b.tool, b.state);
    if (ref) {
      b.subSessionId = ref.sessionId;
      b.subSessionInferred = ref.inferred;
      claimed.add(ref.sessionId);
    }
  }
  if (!parentSessionId) return;
  for (const b of blocks) {
    if (b.kind !== "tool" || b.subSessionId || !isSubAgentTool(b.tool)) continue;
    const start = b.state.status === "pending" ? undefined : b.state.time.start * 1000;
    const ref = matchChildSession(parentSessionId, candidates, {
      toolTimeMs: start,
      exclude: claimed,
    });
    if (ref) {
      b.subSessionId = ref.sessionId;
      b.subSessionInferred = true;
      claimed.add(ref.sessionId);
    }
  }
}

const inlineBlocks = computed<DisplayBlock[]>(() => {
  const blocks: DisplayBlock[] = [];
  for (const part of msgStore.getParts(props.messageId)) {
    if (part.type === "text") {
      if (part.synthetic) continue;
      const text = stripSystemReminder(part.text);
      if (!text.trim()) continue;
      const html = isUser.value
        ? undefined
        : isStreaming.value
          ? renderStreaming(text)
          : renderMarkdown(text);
      blocks.push({ kind: "text", id: part.id, text, html });
    } else if (part.type === "reasoning") {
      const text = part.text?.trim();
      if (!text) continue;
      blocks.push({ kind: "reasoning", id: part.id, text });
    } else if (part.type === "tool") {
      const toolInput =
        part.state.status === "pending"
          ? undefined
          : (part.state.input as Record<string, unknown> | undefined);
      blocks.push({
        kind: "tool",
        id: part.id,
        tool: part.tool,
        state: part.state,
        title: resolveToolTitle(part.tool, part.state),
        command: extractCommand(toolInput),
        output: part.state.status === "completed" ? part.state.output : undefined,
        error: part.state.status === "error" ? part.state.error : undefined,
        diffs: extractEditDiffs(part.tool, toolInput),
      });
    }
  }
  resolveSubSessions(blocks);
  return blocks;
});

const hasInlineContent = computed(() => inlineBlocks.value.length > 0);
const showThinking = computed(() => isStreaming.value && !isUser.value && !hasInlineContent.value);

// Walk inlineBlocks left-to-right; bundle consecutive COMPLETED tool blocks
// into a single summary chip. Running/error tools stay standalone so live
// activity and failures remain visible. A singleton completed tool also
// becomes a group of one — uniform rendering, simpler template.
const GROUP_THRESHOLD = 2; // 2+ consecutive completed tools → bundle

const renderItems = computed<RenderItem[]>(() => {
  const out: RenderItem[] = [];
  let pending: ToolBlock[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const id = `group:${pending.map((b) => b.id).join("|")}`;
    const errorCount = pending.filter((b) => b.state.status === "error").length;
    const hasDiffs = pending.some((b) => b.diffs?.length);
    out.push({ kind: "tool-group", id, blocks: pending, errorCount, hasDiffs });
    pending = [];
  };

  for (const block of inlineBlocks.value) {
    if (block.kind === "tool") {
      const completed = block.state.status === "completed" || block.state.status === "error";
      if (completed) {
        pending.push(block);
        continue;
      }
      // Running/pending tool — flush any accumulated group first, then emit
      // this live tool as its own item so the user sees active work.
      flush();
      out.push({ kind: "tool", block });
      continue;
    }
    flush();
    if (block.kind === "text") {
      out.push({ kind: "text", id: block.id, text: block.text, html: block.html });
    } else {
      out.push({ kind: "reasoning", id: block.id, text: block.text });
    }
  }
  flush();

  // If only one completed tool ended up in a group, unwrap it back to a
  // standalone chip — bundling a singleton adds a click without saving space.
  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    if (item.kind === "tool-group" && item.blocks.length < GROUP_THRESHOLD) {
      out[i] = { kind: "tool", block: item.blocks[0] };
    }
  }
  return out;
});

const lastDebugSnapshot = ref("");
watchEffect(() => {
  const parts = msgStore.getParts(props.messageId);
  if (parts.length === 0 && !isStreaming.value && !isError.value) return;
  const snapshot = {
    messageId: props.messageId,
    role: isUser.value ? "user" : "assistant",
    status: status.value,
    parts: parts.map(summarizePart),
    inlineBlocks: inlineBlocks.value.map((block) =>
      block.kind === "tool"
        ? {
            kind: block.kind,
            id: block.id,
            tool: block.tool,
            status: block.state.status,
            title: block.title,
            hasOutput: Boolean(block.output),
            hasError: Boolean(block.error),
          }
        : {
            kind: block.kind,
            id: block.id,
            textLength: block.text.length,
            text: preview(block.text),
          },
    ),
    renderItems: renderItems.value.map((item) =>
      item.kind === "tool"
        ? {
            kind: item.kind,
            id: item.block.id,
            tool: item.block.tool,
            status: item.block.state.status,
          }
        : item.kind === "tool-group"
          ? {
              kind: item.kind,
              id: item.id,
              count: item.blocks.length,
              errorCount: item.errorCount,
              hasDiffs: item.hasDiffs,
              tools: item.blocks.map((block) => ({
                id: block.id,
                tool: block.tool,
                status: block.state.status,
              })),
            }
          : {
              kind: item.kind,
              id: item.id,
              textLength: item.text.length,
            },
    ),
  };
  const key = JSON.stringify(snapshot);
  if (key === lastDebugSnapshot.value) return;
  lastDebugSnapshot.value = key;
  console.info("[SpecForge message debug]", snapshot);
});

// Per-group summary counts: e.g. { read: 3, bash: 2, edit: 1 }
function summarizeGroup(blocks: ToolBlock[]): { tool: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    counts.set(b.tool, (counts.get(b.tool) ?? 0) + 1);
  }
  return Array.from(counts, ([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count);
}

const expandedReasoning = ref<Record<string, boolean>>({});
function toggleReasoning(id: string) {
  expandedReasoning.value[id] = !expandedReasoning.value[id];
}

function isReasoningExpanded(id: string): boolean {
  if (expandedReasoning.value[id] !== undefined) return expandedReasoning.value[id];
  // Default to collapsed for all reasoning blocks. Previously, a message
  // whose sole item was reasoning was auto-expanded to avoid looking empty,
  // but user feedback was that thinking output should always start folded —
  // the collapsed preview already shows the first line + line count, which
  // is enough to signal "there's reasoning here, click to expand".
  return false;
}

function reasoningPreview(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return firstLine.length > 90 ? `${firstLine.slice(0, 90)}...` : firstLine;
}

function reasoningLineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

// A reasoning block is "live" (actively streaming new tokens) when the
// message is streaming and this block is the last item in the render list.
// Collapsed by default, a live reasoning block shows a pulsing indicator so
// the user can tell thinking output is being produced without expanding it.
function isReasoningLive(index: number): boolean {
  if (!isStreaming.value) return false;
  return index === renderItems.value.length - 1;
}

// undefined = never toggled, fall back to isToolExpanded's default.
// true/false = explicit user override that persists across re-renders.
const expandedTools = ref<Record<string, boolean | undefined>>({});

function isToolExpanded(block: ToolBlock): boolean {
  const stored = expandedTools.value[block.id];
  if (stored !== undefined) return stored;
  // Default: expand only what carries signal — failures (to see the error)
  // and edits/writes (code diffs matter even when successful). Successful
  // read-only tools (read/grep/bash/list/…) collapse to reduce noise. Same
  // rule for standalone chips and chips nested in a tool group.
  return block.state.status === "error" || Boolean(block.diffs?.length);
}

function toggleTool(block: ToolBlock) {
  expandedTools.value[block.id] = !isToolExpanded(block);
}

const expandedGroups = ref<Record<string, boolean | undefined>>({});
function isGroupExpanded(item: { id: string; errorCount: number; hasDiffs: boolean }): boolean {
  const stored = expandedGroups.value[item.id];
  if (stored !== undefined) return stored;
  // Default: expand groups containing errors (to see failures) or code diffs
  // (edits/writes — code changes matter). Pure read-only successful groups
  // stay collapsed as bulk-history summaries.
  return item.errorCount > 0 || item.hasDiffs;
}
function toggleGroup(item: { id: string; errorCount: number; hasDiffs: boolean }) {
  expandedGroups.value[item.id] = !isGroupExpanded(item);
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

function onJump(sessionId: string): void {
  emit("navigate-session", sessionId);
}
</script>

<template>
  <div>
    <template
      v-for="(item, itemIdx) in renderItems"
      :key="item.kind === 'tool' ? item.block.id : item.id"
    >
      <!-- Text -->
      <div v-if="item.kind === 'text' && item.html" class="md-content" v-html="item.html" />
      <div v-else-if="item.kind === 'text'" class="whitespace-pre-wrap break-words">
        {{ item.text }}
      </div>

      <!-- Reasoning -->
      <div v-else-if="item.kind === 'reasoning'" class="my-1">
        <button
          class="flex w-full min-w-0 items-center gap-1.5 text-left text-[11px] text-surface-500 transition-colors hover:text-surface-300"
          @click="toggleReasoning(item.id)"
        >
          <span v-if="isReasoningLive(itemIdx)" class="flex flex-shrink-0 items-center">
            <span class="thinking-dot" />
          </span>
          <span v-else class="flex-shrink-0 text-[10px]">
            {{ isReasoningExpanded(item.id) ? "-" : "+" }}
          </span>
          <span class="hidden flex-shrink-0 text-[9px]">
            {{ expandedReasoning[item.id] ? "▾" : "▸" }}
          </span>
          <span
            class="flex-shrink-0 whitespace-nowrap"
            :class="isReasoningLive(itemIdx) ? 'text-surface-300' : ''"
            >思考过程</span
          >
          <span
            class="flex-shrink-0 whitespace-nowrap tabular-nums"
            :class="isReasoningLive(itemIdx) ? 'text-accent-emerald' : 'text-surface-600'"
          >
            {{ reasoningLineCount(item.text) }} lines
          </span>
          <span
            v-if="isReasoningLive(itemIdx)"
            class="flex-shrink-0 whitespace-nowrap text-[10px] text-accent-emerald/80"
          >
            输出中…
          </span>
          <span
            v-if="!isReasoningExpanded(item.id)"
            class="min-w-0 flex-1 truncate italic text-surface-400"
          >
            {{ reasoningPreview(item.text) }}
          </span>
        </button>
        <div
          v-if="isReasoningExpanded(item.id)"
          class="mt-1 whitespace-pre-wrap rounded-md border border-surface-800 bg-surface-900/35 px-2.5 py-2 text-[12px] italic text-surface-400"
        >
          {{ item.text }}
          <div class="mt-2 flex justify-end not-italic">
            <button
              @click="toggleReasoning(item.id)"
              class="text-[11px] text-surface-500 transition-colors hover:text-surface-300"
            >
              收起 ↑
            </button>
          </div>
        </div>
      </div>

      <!-- Single tool chip (running / pending / standalone completed) -->
      <div v-else-if="item.kind === 'tool'" class="my-1.5">
        <button
          class="group flex w-full items-center gap-1.5 rounded-md border border-surface-800 bg-surface-900/60 px-2 py-1 text-left transition-colors hover:border-surface-700 hover:bg-surface-800/60"
          @click="toggleTool(item.block)"
        >
          <span
            class="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full"
            :style="{ backgroundColor: toolColor(item.block.tool) }"
          />
          <span
            class="flex-shrink-0 font-mono text-[11px] font-medium"
            :style="{ color: toolColor(item.block.tool) }"
          >
            {{ item.block.tool }}
          </span>
          <span
            v-if="item.block.subSessionId"
            class="flex min-w-0 flex-1 items-center truncate font-mono text-[11px]"
          >
            <span
              role="button"
              tabindex="0"
              class="cursor-pointer truncate text-accent-cyan underline decoration-dotted underline-offset-2 hover:decoration-solid"
              :title="
                item.block.subSessionInferred
                  ? t('chat.subSessionInferred')
                  : t('chat.openSubSession')
              "
              @click.stop="onJump(item.block.subSessionId!)"
              @keydown.enter.stop.prevent="onJump(item.block.subSessionId!)"
              >{{ item.block.title || item.block.tool }}</span
            >
            <span class="ml-0.5 text-accent-cyan/80">↗</span>
          </span>
          <span
            v-else-if="item.block.title"
            class="min-w-0 flex-1 truncate font-mono text-[11px] text-surface-300"
            :title="item.block.title"
          >
            {{ item.block.title }}
          </span>
          <span
            class="flex-shrink-0 whitespace-nowrap text-[10px] uppercase"
            :class="toolStatusColor(item.block)"
          >
            {{ toolStatusText(item.block) }}
          </span>
          <span
            v-if="item.block.state.status === 'completed' || item.block.state.status === 'error'"
            class="text-[9px] text-surface-500 transition-colors group-hover:text-surface-300"
          >
            {{ isToolExpanded(item.block) ? "▾" : "▸" }}
          </span>
          <span
            v-else
            class="inline-block h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border border-accent-amber/30 border-t-accent-amber"
          />
        </button>
        <div
          v-if="
            isToolExpanded(item.block) &&
            (item.block.command || item.block.output || item.block.error)
          "
          class="mt-1 max-h-64 overflow-auto rounded-md border border-surface-800 bg-black/30 px-2 py-1.5 font-mono text-[11px]"
        >
          <div v-if="item.block.command" class="whitespace-pre-wrap break-all text-surface-200">
            <span class="select-none text-accent-emerald/70">$</span> {{ item.block.command }}
          </div>
          <div
            v-if="item.block.output || item.block.error"
            class="whitespace-pre-wrap text-surface-300"
            :class="[
              item.block.error ? 'text-accent-rose' : '',
              item.block.command ? 'mt-1.5 border-t border-surface-800 pt-1.5' : '',
            ]"
          >
            {{ item.block.error || item.block.output }}
          </div>
        </div>
        <div v-if="isToolExpanded(item.block) && item.block.diffs?.length" class="mt-1 space-y-2">
          <div v-for="(d, idx) in item.block.diffs" :key="idx" class="tool-inline-diff">
            <div class="tool-inline-diff-header">{{ d.file }}</div>
            <DiffViewer :diff="d" />
          </div>
        </div>
      </div>

      <!-- Tool group (summary of consecutive completed tools) -->
      <div v-else-if="item.kind === 'tool-group'" class="my-1.5">
        <button
          class="group flex w-full items-center gap-1.5 rounded-md border border-surface-800 bg-surface-900/40 px-2 py-1 text-left transition-colors hover:border-surface-700 hover:bg-surface-800/60"
          @click="toggleGroup(item)"
        >
          <span
            class="flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
            :class="item.errorCount > 0 ? 'bg-accent-rose' : 'bg-accent-emerald/80'"
          >
            {{ item.errorCount > 0 ? "!" : "✓" }}
          </span>
          <span
            class="flex-shrink-0 whitespace-nowrap font-mono text-[11px] text-surface-300 tabular-nums"
          >
            {{ item.blocks.length }} tools<span v-if="item.errorCount > 0" class="text-accent-rose"
              >&nbsp;· {{ item.errorCount }} err</span
            >
          </span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-surface-500">
            <span
              v-for="(s, i) in summarizeGroup(item.blocks)"
              :key="s.tool"
              class="font-mono"
              :style="{ color: toolColor(s.tool) }"
            >
              <span v-if="i > 0" class="text-surface-600"> · </span>{{ s.tool
              }}<span v-if="s.count > 1" class="text-surface-500">×{{ s.count }}</span>
            </span>
          </span>
          <span
            class="flex-shrink-0 whitespace-nowrap text-[9px] text-surface-500 transition-colors group-hover:text-surface-300"
          >
            {{ isGroupExpanded(item) ? "▾" : "▸" }}
          </span>
        </button>
        <!-- Expanded: render each tool as a sub-chip -->
        <div v-if="isGroupExpanded(item)" class="mt-1 space-y-1 border-l border-surface-800 pl-2">
          <div v-for="block in item.blocks" :key="block.id">
            <button
              class="group flex w-full items-center gap-1.5 rounded-md border border-surface-800 bg-surface-900/60 px-2 py-1 text-left transition-colors hover:border-surface-700 hover:bg-surface-800/60"
              @click="toggleTool(block)"
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
                v-if="block.subSessionId"
                class="flex min-w-0 flex-1 items-center truncate font-mono text-[11px]"
              >
                <span
                  role="button"
                  tabindex="0"
                  class="cursor-pointer truncate text-accent-cyan underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  :title="
                    block.subSessionInferred
                      ? t('chat.subSessionInferred')
                      : t('chat.openSubSession')
                  "
                  @click.stop="onJump(block.subSessionId!)"
                  @keydown.enter.stop.prevent="onJump(block.subSessionId!)"
                  >{{ block.title || block.tool }}</span
                >
                <span class="ml-0.5 text-accent-cyan/80">↗</span>
              </span>
              <span
                v-else-if="block.title"
                class="min-w-0 flex-1 truncate font-mono text-[11px] text-surface-300"
                :title="block.title"
              >
                {{ block.title }}
              </span>
              <span class="flex-shrink-0 text-[10px] uppercase" :class="toolStatusColor(block)">
                {{ toolStatusText(block) }}
              </span>
              <span
                class="text-[9px] text-surface-500 transition-colors group-hover:text-surface-300"
              >
                {{ isToolExpanded(block) ? "▾" : "▸" }}
              </span>
            </button>
            <div
              v-if="isToolExpanded(block) && (block.command || block.output || block.error)"
              class="mt-1 max-h-64 overflow-auto rounded-md border border-surface-800 bg-black/30 px-2 py-1.5 font-mono text-[11px]"
            >
              <div v-if="block.command" class="whitespace-pre-wrap break-all text-surface-200">
                <span class="select-none text-accent-emerald/70">$</span> {{ block.command }}
              </div>
              <div
                v-if="block.output || block.error"
                class="whitespace-pre-wrap text-surface-300"
                :class="[
                  block.error ? 'text-accent-rose' : '',
                  block.command ? 'mt-1.5 border-t border-surface-800 pt-1.5' : '',
                ]"
              >
                {{ block.error || block.output }}
              </div>
            </div>
            <div v-if="isToolExpanded(block) && block.diffs?.length" class="mt-1 space-y-2">
              <div v-for="(d, idx) in block.diffs" :key="idx" class="tool-inline-diff">
                <div class="tool-inline-diff-header">{{ d.file }}</div>
                <DiffViewer :diff="d" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="showThinking" class="flex items-center gap-1.5 py-1.5">
      <span class="thinking-dot" />
      <span class="thinking-dot" />
      <span class="thinking-dot" />
      <span class="ml-1 text-[11px] text-surface-400">正在思考</span>
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

.tool-inline-diff {
  border: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 60%, transparent);
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.tool-inline-diff-header {
  padding: 0.3rem 0.55rem;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--color-surface-400, #94a3b8);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 90%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* DiffViewer defaults to height:100% for its full-window use case; inside a
   fixed-height inline container we want it to fill that container instead. */
.tool-inline-diff :deep(.diff-viewer) {
  height: auto;
  max-height: 288px;
}

.tool-inline-diff :deep(.diff-grid) {
  max-height: 288px;
}
</style>
