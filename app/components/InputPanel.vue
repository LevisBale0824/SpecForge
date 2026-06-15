<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import CommandMenu from "./CommandMenu.vue";
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

function handleInput() {
  const text = inputText.value;
  // Open the menu only when the input looks like a command being typed:
  // starts with "/" and has no space yet (user is still typing the command id).
  if (text.startsWith("/") && !text.includes(" ")) {
    if (!showMenu.value) {
      // First "/" — make sure commands are loaded for this backend.
      backend.ensureCommandsLoaded();
    }
    showMenu.value = true;
    selectedIndex.value = 0;
  } else {
    showMenu.value = false;
  }
}

function handleKeydown(e: KeyboardEvent) {
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
    // Fall through for other keys (including Enter without menu).
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

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
  // Fill in the command id with a trailing space so the user can type arguments.
  inputText.value = `/${selected.id} `;
  showMenu.value = false;
  // Return focus to the textarea and place the caret at the end.
  void nextTick(() => {
    const el = textareaEl.value;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
}

function handleHover(index: number) {
  selectedIndex.value = index;
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text || backend.isSending.value || backend.isBusy.value) return;
  inputText.value = "";
  showMenu.value = false;
  if (text.startsWith("/")) {
    await backend.sendCommand(text);
  } else {
    await backend.sendPrompt(text);
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
  </div>
</template>
