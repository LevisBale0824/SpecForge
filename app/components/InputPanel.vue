<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useBackend } from "../composables/useBackend";
import { useProject } from "../composables/useProject";
import { isElectron, getPathForFile } from "../utils/electronBridge";
import CommandMenu from "./CommandMenu.vue";
import FileMenu from "./FileMenu.vue";
import ModelPicker from "./ModelPicker.vue";
import AgentPicker from "./AgentPicker.vue";
import type { CommandInfo } from "../types/command";
import { isCommandLike } from "../utils/commands";

const { t } = useI18n();
const backend = useBackend();
const project = useProject();
const inElectron = isElectron();

// Sessions are created lazily on the first message — before that,
// `selectedSessionId` is empty and the picker chips have nothing to bind to.
// Fall back to a draft sentinel; `useBackend.sendPrompt` migrates any draft
// selection onto the real session ID once `ensureSession()` creates one.
const DRAFT_SESSION_ID = "__draft__";
const pickerSessionId = computed(() => backend.selectedSessionId.value || DRAFT_SESSION_ID);

const inputText = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);

// Sub-agent sessions are driven by their parent task's tool call, not by the
// user. If the user clicks into one from the sidebar or a "↗" jump link, the
// input box must not accept messages — otherwise a user turn lands inside a
// conversation the parent agent owns, which collides with the in-flight task
// and leaves the sub-session stuck in a "running" state that never resolves.
// Detect via SessionInfo.parentID and replace the input area with a read-only
// banner + a "back to parent" jump.
const selectedSession = computed(() => {
  const id = backend.selectedSessionId.value;
  if (!id) return null;
  return backend.sessions.value.find((s) => s.id === id) ?? null;
});
const isChildSession = computed(() => !!selectedSession.value?.parentID);
const parentSessionId = computed(() => selectedSession.value?.parentID ?? null);
const parentExists = computed(() => {
  const pid = parentSessionId.value;
  if (!pid) return false;
  return backend.sessions.value.some((s) => s.id === pid);
});
function backToParent() {
  const pid = parentSessionId.value;
  if (pid && parentExists.value) backend.selectSession(pid);
}

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

  // Slash menu: only at the very start of the input, and only when the
  // text actually looks like a command (not a path like "/session/xxx/id").
  const slashOpen = isCommandLike(text) && !text.includes(" ") && pos > 0 && pos <= text.length;

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

// ── Drag & drop files/folders into the composer ────────────────────────────
// Two sources of drops are supported:
//   1. Internal — dragging a node from the sidebar FileTree. Identified by
//      the TREE_MIME payload (a {path, kind} JSON blob). Path is already
//      relative to the project root, so we just splice `@<path>` in.
//   2. External — dragging OS files into the window (Electron only). We
//      resolve each File to an absolute OS path via webUtils and convert
//      to a project-relative path so the agent can resolve it via cwd.
// Internal drops take precedence: when both MIME types are present (which
// happens because FileTree also writes text/plain), we prefer the tree node.
const TREE_MIME = "application/x-specforge-tree";
const dragCounter = ref(0);
const isDragOver = ref(false);

function hasFilePayload(e: DragEvent): boolean {
  // `types` is a frozen array-like; cast works in Chromium. We MUST allow
  // the dragover/drop default-prevent whenever Files are present, otherwise
  // Electron will navigate the window to the dropped file:// URL.
  const types = e.dataTransfer?.types as unknown as string[] | undefined;
  if (!types) return false;
  const arr = Array.from(types);
  return arr.includes("Files") || arr.includes(TREE_MIME);
}

// Window-level safety net: Electron's default behavior for file drops is to
// navigate the window to the file:// URL, which throws away the user's
// workspace and chat. Even if the drop lands outside the composer (e.g. on
// the message list or sidebar), we MUST preventDefault. The composer's own
// handler still owns the actual attach logic; this just stops the navigate.
function windowDragOver(e: DragEvent) {
  if (!e.dataTransfer) return;
  const types = Array.from(e.dataTransfer.types as unknown as string[]);
  if (types.includes("Files")) e.preventDefault();
}
function windowDrop(e: DragEvent) {
  if (!e.dataTransfer) return;
  const types = Array.from(e.dataTransfer.types as unknown as string[]);
  if (types.includes("Files")) e.preventDefault();
}
onMounted(() => {
  if (!inElectron) return;
  window.addEventListener("dragover", windowDragOver);
  window.addEventListener("drop", windowDrop);
});
onUnmounted(() => {
  if (!inElectron) return;
  window.removeEventListener("dragover", windowDragOver);
  window.removeEventListener("drop", windowDrop);
});

function onDragEnter(e: DragEvent) {
  if (!hasFilePayload(e)) return;
  e.preventDefault();
  dragCounter.value += 1;
  isDragOver.value = true;
}
function onDragOver(e: DragEvent) {
  if (!hasFilePayload(e)) return;
  // CRITICAL: must preventDefault on dragover, otherwise the drop event
  // never fires (HTML5 DnD spec) and Electron falls back to file:// nav.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}
function onDragLeave(e: DragEvent) {
  e.preventDefault();
  dragCounter.value = Math.max(0, dragCounter.value - 1);
  if (dragCounter.value === 0) isDragOver.value = false;
}

// Splice `@token` strings into inputText at the caret position. Each token is
// separated by a single space; the run is followed by a trailing space so the
// user can keep typing after the attachment.
function insertTokensAtCaret(tokens: string[]) {
  if (tokens.length === 0) return;
  const sep = inputText.value && !/\s$/.test(inputText.value) ? " " : "";
  const pos = caretPos.value >= 0 ? caretPos.value : inputText.value.length;
  const before = inputText.value.slice(0, pos);
  const after = inputText.value.slice(pos);
  const insert = `${sep}${tokens.join(" ")} `;
  inputText.value = `${before}${insert}${after}`;
  void nextTick(() => {
    const el = textareaEl.value;
    if (!el) return;
    el.focus();
    const newCaret = (before + insert).length;
    el.setSelectionRange(newCaret, newCaret);
    caretPos.value = newCaret;
  });
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragCounter.value = 0;
  isDragOver.value = false;
  if (!e.dataTransfer) return;

  // ── 1. Internal drag from the sidebar FileTree. Path is already relative
  // to the project root, so just wrap it as an `@path` token. Directories get
  // a trailing `/` so ATTACHMENT_RE matches even without an extension.
  const treePayload = e.dataTransfer.getData(TREE_MIME);
  if (treePayload) {
    try {
      const parsed = JSON.parse(treePayload) as { path?: string; kind?: string };
      if (parsed.path) {
        let p = parsed.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (parsed.kind === "directory" && !/\./.test(p)) p += "/";
        insertTokensAtCaret([`@${p}`]);
        return;
      }
    } catch {
      // fall through to external File handling
    }
  }

  // ── 2. External OS file drop. Electron only — needs webUtils to recover
  // the absolute path. Skip silently in browser mode.
  if (!inElectron) return;
  const fileList = Array.from(e.dataTransfer.files ?? []);
  if (fileList.length === 0) return;

  const cwd = (project.state.directoryPath || "").replace(/\\/g, "/");
  const tokens: string[] = [];
  for (const f of fileList) {
    const abs = getPathForFile(f).replace(/\\/g, "/");
    if (!abs) continue;
    // Convert to a path the agent understands. If the file is under the cwd,
    // use the relative path; otherwise fall back to the absolute path. The
    // regex below is permissive enough for either form (matches `[./]` in
    // the body), but drive-letter prefixes (`D:/...`) include `:` which
    // ATTACHMENT_RE rejects — strip the leading `X:` so the token parses.
    let relPath = abs;
    if (cwd && abs.toLowerCase().startsWith(cwd.toLowerCase() + "/")) {
      relPath = abs.slice(cwd.length + 1);
    } else {
      // Strip Windows drive prefix so the attachment regex can match.
      relPath = relPath.replace(/^([a-zA-Z]:)/, "");
    }
    // Folders dropped from the OS may have no extension; ensure a trailing
    // `/` so the path contains a separator and matches ATTACHMENT_RE.
    const isDir = f.type === "" || f.size === 0;
    if (isDir && !/[/.]$/.test(relPath)) relPath += "/";
    tokens.push(`@${relPath}`);
  }
  insertTokensAtCaret(tokens);
}

// ── Send ───────────────────────────────────────────────────────────────────
// Extract @<rel/path> tokens from text. Only matches an @ at line start or
// after whitespace, AND requires the token to contain "." or "/" — a file
// path always has an extension or a separator, whereas code annotations and
// mentions (@Override, @Autowired, @username) are bare identifiers. This
// keeps pasted Java/Spring/Python/TS code from being parsed as file refs.
const ATTACHMENT_RE = /(^|\s)@([a-zA-Z0-9._\-/]*[./][a-zA-Z0-9._\-/]*)/g;

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
    if (isCommandLike(text)) {
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
    <!-- Sub-agent session: replace the input area with a read-only banner.
         The composer (textarea + ModelPicker + AgentPicker + menus) is hidden
         entirely, because none of those controls make sense for a session the
         user can't write to. -->
    <div
      v-if="isChildSession"
      class="max-w-5xl mx-auto rounded-lg border border-surface-700 bg-surface-800/60 px-4 py-4 flex items-center gap-3"
    >
      <svg
        class="w-5 h-5 shrink-0 text-surface-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8 7h8M8 12h5M8 17h8M4 4v16"
        />
      </svg>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-surface-200">
          {{ t("chat.childSession.title") }}
        </p>
        <p class="text-xs text-surface-500 mt-0.5">
          {{ parentExists ? t("chat.childSession.hint") : t("chat.childSession.orphanHint") }}
        </p>
      </div>
      <button
        v-if="parentExists"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-cyan/15 text-accent-cyan text-sm hover:bg-accent-cyan/25 transition-colors whitespace-nowrap"
        @click="backToParent"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        {{ t("chat.childSession.backToParent") }}
      </button>
    </div>

    <template v-else>
      <div class="flex items-center gap-2 max-w-5xl mx-auto mb-2.5">
        <ModelPicker :session-id="pickerSessionId" />
        <AgentPicker :session-id="pickerSessionId" />
      </div>
      <div
        class="relative flex items-stretch gap-2.5 max-w-5xl mx-auto"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <textarea
          ref="textareaEl"
          v-model="inputText"
          :placeholder="t('chat.placeholder')"
          rows="3"
          class="flex-1 resize-none rounded-lg bg-surface-800 border px-4 py-3 text-base text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-accent-cyan/50 transition-colors"
          :class="isDragOver ? 'border-accent-cyan' : 'border-surface-700'"
          @keydown="handleKeydown"
          @input="handleInput"
        />
        <div
          v-if="isDragOver"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-cyan/60 bg-surface-900/80 backdrop-blur-sm"
        >
          <div class="flex items-center gap-2 text-sm text-accent-cyan">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1A5.5 5.5 0 0118 17H7zM9 13l3-3 3 3M12 10v7"
              />
            </svg>
            <span>{{ t("chat.dropHint") }}</span>
          </div>
        </div>
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
    </template>
  </div>
</template>
