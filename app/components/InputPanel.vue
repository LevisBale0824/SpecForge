<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import CommandMenu from "./CommandMenu.vue";
import FileMenu from "./FileMenu.vue";
import type { CommandInfo } from "../types/command";

const { t } = useI18n();
const backend = useBackend();

const inputText = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);

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
  inputText.value = "";
  showMenu.value = false;
  showFileMenu.value = false;
  atIndex.value = -1;
  if (text.startsWith("/")) {
    await backend.sendCommand(text);
  } else {
    const attachments = parseFileAttachments(text);
    await backend.sendPrompt(text, attachments);
  }
}
</script>

<template>
  <div class="relative border-t border-surface-800 bg-surface-900 px-4 py-3.5">
    <div class="flex items-end gap-2.5 max-w-4xl mx-auto">
      <textarea
        ref="textareaEl"
        v-model="inputText"
        :placeholder="t('chat.placeholder')"
        :disabled="backend.isSending.value || backend.isBusy.value"
        rows="1"
        class="flex-1 resize-none rounded-lg bg-surface-800 border border-surface-700 px-3.5 py-2.5 text-base text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-accent-cyan/50 transition-colors"
        @keydown="handleKeydown"
        @input="handleInput"
      />
      <button
        v-if="!backend.isBusy.value && !backend.isSending.value"
        :disabled="!inputText.trim()"
        class="px-3.5 py-2.5 text-base font-medium rounded-lg bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        @click="handleSend"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 19V5m0 0l-7 7m7-7l7 7"
          />
        </svg>
      </button>
      <button
        v-else
        class="px-3.5 py-2.5 text-base font-medium rounded-lg bg-accent-rose/15 text-accent-rose hover:bg-accent-rose/25 transition-colors"
        @click="backend.abortSession()"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
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
