<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import CommandMenu from "./CommandMenu.vue";
import FileMenu from "./FileMenu.vue";
import ModelPicker from "./ModelPicker.vue";
import AgentPicker from "./AgentPicker.vue";
import type { CommandInfo } from "../types/command";

const { t } = useI18n();
const backend = useBackend();

// Sessions are created lazily on the first message — before that,
// `selectedSessionId` is empty and the picker chips have nothing to bind to.
// Fall back to a draft sentinel; `useBackend.sendPrompt` migrates any draft
// selection onto the real session ID once `ensureSession()` creates one.
const DRAFT_SESSION_ID = "__draft__";
const pickerSessionId = computed(() => backend.selectedSessionId.value || DRAFT_SESSION_ID);

const inputText = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);

// Auto-resize the textarea to fit content. Without this, picking a long
// `@path/to/deep/file.ts` leaves the user with one visible line and a
// scroll bar — they can't tell at a glance what got attached. Cap the
// growth so a giant paste doesn't take over the layout.
const MAX_TEXTAREA_HEIGHT_PX = 480;
function autoResize() {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
}
watch(inputText, () => nextTick(autoResize));

// ── Slash command menu state ──────────────────────────────────────────────
const showMenu = ref(false);
const selectedIndex = ref(0);
// The text typed after the leading "/", used to filter the command list.
const slashQuery = computed(() => {
  const text = inputText.value;
  if (!text.startsWith("/")) return "";
  const spaceIdx = text.indexOf(" ");
  return spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
});

const commands = computed(() => backend.commands.value);
const commandsLoading = computed(() => backend.commandsLoading.value);

// ── @ file mention menu state ─────────────────────────────────────────────
const showFileMenu = ref(false);
const selectedFileIndex = ref(0);
// Character index in inputText where the current `@` token starts. -1 when no
// active token.
const atIndex = ref(-1);

const files = computed(() => backend.files.value);
const filesLoading = computed(() => backend.filesLoading.value);

// The query text after `@`, derived from inputText + caret position. We track
// caret via selectionstart on each input event (see caretPos).
const caretPos = ref(0);
const fileQuery = computed(() => {
  if (atIndex.value < 0) return "";
  return inputText.value.slice(atIndex.value + 1, caretPos.value);
});

function clampSelection(len: number) {
  if (len <= 0) {
    selectedIndex.value = 0;
    return;
  }
  if (selectedIndex.value >= len) selectedIndex.value = len - 1;
  if (selectedIndex.value < 0) selectedIndex.value = 0;
}

// Filtered list mirror of CommandMenu, used for keyboard navigation bounds.
const filteredCount = computed(() => {
  const q = slashQuery.value.trim().toLowerCase();
  if (!q) return commands.value.length;
  return commands.value.filter(
    (c) => c.id.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q),
  ).length;
});

const filteredFileCount = computed(() => {
  const q = fileQuery.value.trim().toLowerCase();
  if (!q) return Math.min(files.value.length, 100);
  return files.value.filter((f) => f.toLowerCase().includes(q)).slice(0, 100).length;
});

// ── Input handling ────────────────────────────────────────────────────────
function handleInput(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  caretPos.value = el.selectionStart ?? inputText.value.length;
  const text = inputText.value;
  const pos = caretPos.value;

  // Slash menu: only at the very start of the input.
  const slashOpen = text.startsWith("/") && !text.includes(" ") && pos > 0 && pos <= text.length;

  // @ mention: scan back from caret for an `@` preceded by whitespace or BOS,
  // with no whitespace between `@` and caret.
  let atOpen = false;
  let atIdx = -1;
  if (!slashOpen) {
    let i = pos - 1;
    for (; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        const before = i > 0 ? text[i - 1] : "";
        if (before === "" || /\s/.test(before)) {
          atIdx = i;
        }
        break;
      }
      if (/\s/.test(ch)) break;
    }
    if (atIdx >= 0) atOpen = true;
  }

  if (slashOpen) {
    if (!showMenu.value) backend.ensureCommandsLoaded();
    showMenu.value = true;
    showFileMenu.value = false;
    atIndex.value = -1;
    selectedIndex.value = 0;
  } else if (atOpen) {
    if (!showFileMenu.value) backend.ensureFilesLoaded();
    showFileMenu.value = true;
    showMenu.value = false;
    atIndex.value = atIdx;
    selectedFileIndex.value = 0;
  } else {
    showMenu.value = false;
    showFileMenu.value = false;
    atIndex.value = -1;
  }
}

function handleKeydown(e: KeyboardEvent) {
  // ── Slash menu navigation ────────────────────────────────────────────
  if (showMenu.value) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      clampSelection(filteredCount.value);
      selectedIndex.value = (selectedIndex.value + 1) % Math.max(filteredCount.value, 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      clampSelection(filteredCount.value);
      const max = Math.max(filteredCount.value, 1);
      selectedIndex.value = (selectedIndex.value - 1 + max) % max;
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      acceptSelection();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      showMenu.value = false;
      return;
    }
  }

  // ── File menu navigation ─────────────────────────────────────────────
  if (showFileMenu.value) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedFileIndex.value =
        (selectedFileIndex.value + 1) % Math.max(filteredFileCount.value, 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const max = Math.max(filteredFileCount.value, 1);
      selectedFileIndex.value = (selectedFileIndex.value - 1 + max) % max;
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      acceptFileSelection();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      showFileMenu.value = false;
      atIndex.value = -1;
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

// ── Slash command accept ──────────────────────────────────────────────────
function findSelectedCommand(): CommandInfo | undefined {
  const q = slashQuery.value.trim().toLowerCase();
  const list = q
    ? commands.value.filter(
        (c) => c.id.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q),
      )
    : commands.value;
  return list[selectedIndex.value];
}

function acceptSelection(command?: CommandInfo) {
  const selected = command ?? findSelectedCommand();
  if (!selected) {
    showMenu.value = false;
    return;
  }
  inputText.value = `/${selected.id} `;
  showMenu.value = false;
  void nextTick(() => {
    const el = textareaEl.value;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    caretPos.value = len;
  });
}

function handleHover(index: number) {
  selectedIndex.value = index;
}

// ── File mention accept ───────────────────────────────────────────────────
function findSelectedFile(): string | undefined {
  const q = fileQuery.value.trim().toLowerCase();
  const list = q ? files.value.filter((f) => f.toLowerCase().includes(q)) : files.value;
  return list.slice(0, 100)[selectedFileIndex.value];
}

function acceptFileSelection(file?: string) {
  const selected = file ?? findSelectedFile();
  if (!selected) {
    showFileMenu.value = false;
    atIndex.value = -1;
    return;
  }

  // Replace the `@query` token (from atIndex to caret) with `@<path> `.
  // Must read atIndex BEFORE clearing it.
  const start = atIndex.value >= 0 ? atIndex.value : caretPos.value;
  const before = inputText.value.slice(0, start);
  const after = inputText.value.slice(caretPos.value);
  const inserted = `@${selected} `;
  inputText.value = `${before}${inserted}${after}`;
  showFileMenu.value = false;
  atIndex.value = -1;

  void nextTick(() => {
    const el = textareaEl.value;
    if (!el) return;
    el.focus();
    const newCaret = (before + inserted).length;
    el.setSelectionRange(newCaret, newCaret);
    caretPos.value = newCaret;
  });
}

function handleFileHover(index: number) {
  selectedFileIndex.value = index;
}

// ── Send ───────────────────────────────────────────────────────────────────
// Extract @<rel/path> tokens from text. Only matches an @ at line start or
// after whitespace; path charset excludes spaces so the token terminates at
// the next space. Mirrors the menu's @ detection so what you see is what
// gets sent.
const ATTACHMENT_RE = /(^|\s)@([a-zA-Z0-9._\-/]+)/g;

function parseFileAttachments(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = ATTACHMENT_RE.exec(text))) {
    out.push(m[2]);
  }
  return out;
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || backend.isSending.value || backend.isBusy.value) return;
  // Keep the original text so we can restore it if the backend rejects the
  // send. Previously the input was cleared unconditionally, which made send
  // failures look like the message had been "swallowed" — the user lost
  // their text and saw no error. Clear only after a successful dispatch.
  inputText.value = "";
  showMenu.value = false;
  showFileMenu.value = false;
  atIndex.value = -1;
  let ok = true;
  try {
    if (text.startsWith("/")) {
      ok = await backend.sendCommand(text);
    } else {
      const attachments = parseFileAttachments(text);
      ok = await backend.sendPrompt(text, attachments);
    }
  } catch (e) {
    console.error("[InputPanel] send threw:", e);
    ok = false;
  }
  if (!ok) {
    // Restore the user's text so they can edit + retry instead of retyping.
    inputText.value = text;
  }
}
</script>

<template>
  <div class="relative border-t border-surface-800 bg-surface-900 px-4 py-4">
    <div class="flex items-center gap-2 max-w-5xl mx-auto mb-2.5">
      <ModelPicker :session-id="pickerSessionId" />
      <AgentPicker :session-id="pickerSessionId" />
    </div>
    <div class="flex items-stretch gap-2.5 max-w-5xl mx-auto">
      <textarea
        ref="textareaEl"
        v-model="inputText"
        :placeholder="t('chat.placeholder')"
        :disabled="backend.isSending.value || backend.isBusy.value"
        rows="3"
        class="flex-1 resize-none rounded-lg bg-surface-800 border border-surface-700 px-4 py-3 text-base text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-accent-cyan/50 transition-colors"
        @keydown="handleKeydown"
        @input="handleInput"
      />
      <button
        v-if="!backend.isBusy.value && !backend.isSending.value"
        :disabled="!inputText.trim()"
        class="flex items-center justify-center self-stretch px-5 rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        :title="t('chat.send')"
        @click="handleSend"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
          />
        </svg>
      </button>
      <button
        v-else
        class="flex items-center justify-center self-stretch px-5 rounded-lg bg-accent-rose/15 text-accent-rose hover:bg-accent-rose/25 transition-colors"
        :title="t('chat.abort')"
        @click="backend.abortSession()"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="1.5"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
      </button>
    </div>

    <CommandMenu
      v-if="showMenu"
      :commands="commands"
      :query="slashQuery"
      :selected-index="selectedIndex"
      :loading="commandsLoading"
      @select="acceptSelection"
      @hover="handleHover"
    />
    <FileMenu
      v-else-if="showFileMenu"
      :files="files"
      :query="fileQuery"
      :selected-index="selectedFileIndex"
      :loading="filesLoading"
      @select="acceptFileSelection"
      @hover="handleFileHover"
    />
  </div>
</template>
