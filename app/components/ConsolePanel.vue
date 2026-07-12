<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useProject } from "../composables/useProject";
import { isElectron, readDirectory } from "../utils/electronBridge";
import type { ConsoleDataEvent } from "../types/electron";

interface LogEntry {
  id: number;
  kind: "cmd" | "out" | "err" | "sys";
  text: string;
}

const props = defineProps<{
  cwd?: string;
  modelHeight?: number;
  fill?: boolean;
}>();

const emit = defineEmits<{
  minimize: [];
  "update:modelHeight": [number];
}>();

const project = useProject();
const inElectron = isElectron();

const lines = ref<LogEntry[]>([]);
const input = ref("");
const historyIdx = ref(-1);
const cmdHistory = ref<string[]>([]);
const runningPid = ref<number | null>(null);

const bodyEl = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const rootEl = ref<HTMLDivElement | null>(null);

let seq = 0;
function push(kind: LogEntry["kind"], text: string) {
  const parts = text.split(/\r?\n/);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  for (const p of parts) lines.value.push({ id: ++seq, kind, text: p });
}

function scrollToEnd() {
  nextTick(() => {
    const el = bodyEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function clear() {
  lines.value = [];
}

const cwdPath = computed(() => props.cwd || project.state.directoryPath || undefined);

const promptText = computed(() => (inElectron ? "$" : ">"));

// ── Tab completion ────────────────────────────────────────────────────────
// Client-side only: command names (BUILTIN + history + a small preset of
// common CLI tools) plus path completion against the cwd via readDirectory.
// We deliberately don't shell out — a new IPC just for completion isn't worth
// the complexity, and this covers the 80% case (typing git/npm/pnpm/cd paths).
const COMMON_COMMANDS = [
  "git",
  "pnpm",
  "npm",
  "node",
  "npx",
  "yarn",
  "bun",
  "ls",
  "cd",
  "cat",
  "grep",
  "find",
  "rm",
  "mkdir",
  "rmdir",
  "mv",
  "cp",
  "touch",
  "chmod",
  "chown",
  "tar",
  "zip",
  "unzip",
  "echo",
  "pwd",
  "date",
  "whoami",
  "hostname",
  "env",
  "which",
  "python",
  "python3",
  "pip",
  "java",
  "javac",
  "go",
  "cargo",
  "rustc",
  "docker",
  "kubectl",
  "ssh",
  "scp",
  "curl",
  "wget",
];

function commandCandidates(): string[] {
  const set = new Set<string>([...Object.keys(BUILTIN), ...COMMON_COMMANDS]);
  for (const h of cmdHistory.value) {
    const head = h.split(/\s+/)[0];
    if (head) set.add(head);
  }
  return [...set];
}

// Longest common prefix of a list — used when Tab has multiple matches to
// fill in the unambiguous portion (bash behavior).
function longestCommonPrefix(list: string[]): string {
  if (list.length === 0) return "";
  let prefix = list[0];
  for (let i = 1; i < list.length; i++) {
    const s = list[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

async function completeToken(): Promise<void> {
  const el = inputEl.value;
  if (!el) return;
  const caret = el.selectionStart ?? input.value.length;
  const left = input.value.slice(0, caret);
  const right = input.value.slice(caret);
  // Match the trailing non-space run ending at the caret.
  const m = left.match(/(\S*)$/);
  const token = m?.[1] ?? "";
  const tokenStart = caret - token.length;
  const beforeToken = input.value.slice(0, tokenStart);
  const isFirstToken = beforeToken.trim() === "";

  let candidates: string[] = [];
  let appendSlash = false;
  if (isFirstToken) {
    candidates = commandCandidates()
      .filter((c) => c.startsWith(token) && c !== token)
      .sort();
  } else if (inElectron && cwdPath.value) {
    // Split the token into a parent dir + prefix to list. "app/comp" → list
    // cwd-rooted "app" and filter by "comp"; bare "comp" → list cwd root.
    const slashIdx = token.lastIndexOf("/");
    const parentRel = slashIdx >= 0 ? token.slice(0, slashIdx) : "";
    const prefix = slashIdx >= 0 ? token.slice(slashIdx + 1) : token;
    const entries = await readDirectory(cwdPath.value, parentRel);
    if (entries) {
      appendSlash = true;
      candidates = entries
        .filter((e) => e.name.startsWith(prefix) && e.name !== prefix)
        .map((e) => (e.kind === "directory" ? `${e.name}/` : e.name))
        .sort();
      // Rebuild token path prefix (with trailing slash stripped) so we can
      // replace the [tokenStart, caret) span cleanly with the candidate.
    }
  }

  if (candidates.length === 0) return;

  // For path completion we need to keep the parent portion of the token.
  const slashIdx = token.lastIndexOf("/");
  const tokenDir = slashIdx >= 0 ? token.slice(0, slashIdx + 1) : "";

  if (candidates.length === 1) {
    const pick = appendSlash
      ? `${tokenDir}${candidates[0]}${candidates[0].endsWith("/") ? "" : ""}`
      : candidates[0];
    // Append a space after a completed command name so the user can keep
    // typing args; for paths don't auto-space (bash appends nothing for
    // directories so the user can chain another Tab).
    const suffix = isFirstToken ? " " : "";
    input.value = `${beforeToken}${pick}${suffix}${right}`;
    const newCaret = (beforeToken + pick + suffix).length;
    await nextTick();
    el.setSelectionRange(newCaret, newCaret);
    return;
  }

  // Multiple matches: fill the longest common prefix, then list candidates
  // in the output area so the user can narrow with another Tab.
  const withDir = candidates.map((c) => `${tokenDir}${c}`);
  const lcp = longestCommonPrefix(withDir);
  if (lcp.length > token.length) {
    input.value = `${beforeToken}${lcp}${right}`;
    const newCaret = (beforeToken + lcp).length;
    await nextTick();
    el.setSelectionRange(newCaret, newCaret);
  }
  // Echo the candidates the way a shell would: a single system line, names
  // separated by spaces. Cap to avoid wrapping the panel into a scroll.
  const shown = candidates.slice(0, 30).join("   ");
  push("sys", shown + (candidates.length > 30 ? `   (+${candidates.length - 30} more)` : ""));
  scrollToEnd();
}

// ── Built-in commands (always handled locally, both modes) ───────────────
const BUILTIN: Record<string, (args: string[]) => string | void> = {
  help: () =>
    [
      "Built-in commands:",
      "  help        Show this help",
      "  clear       Clear the console (also Ctrl+L)",
      "  cls         Alias for clear",
      "  echo <text> Print text back",
      "  pwd         Show current working directory",
      "  date        Show current date/time",
      "",
      inElectron
        ? "Any other input is executed via the system shell."
        : "Shell execution is only available in the desktop app — run `pnpm electron:dev`.",
    ].join("\n"),
  clear: () => clear(),
  cls: () => clear(),
  echo: (args) => args.join(" "),
  pwd: () => cwdPath.value || "(no project opened)",
  date: () => new Date().toString(),
};

// ── Real execution via Electron IPC ──────────────────────────────────────
let unsubConsole: (() => void) | null = null;

function attachConsoleListener() {
  if (!inElectron || !window.electronAPI) return;
  if (unsubConsole) return;
  unsubConsole = window.electronAPI.onConsoleData((event: ConsoleDataEvent) => {
    if (event.pid !== runningPid.value) return;
    if (event.kind === "exit") {
      runningPid.value = null;
      if (event.code !== 0) {
        push("sys", `[exit ${event.code}]`);
      }
      nextTick(() => inputEl.value?.focus());
      return;
    }
    push(event.kind === "stderr" ? "err" : "out", event.data);
    scrollToEnd();
  });
}

async function runRemote(raw: string) {
  if (!window.electronAPI) return;
  const result = await window.electronAPI.consoleExec(raw, cwdPath.value);
  if (!result.ok) {
    push("err", result.error);
    return;
  }
  runningPid.value = result.pid;
}

async function killCurrent() {
  const pid = runningPid.value;
  if (pid == null || !window.electronAPI) return;
  await window.electronAPI.consoleKill(pid);
  runningPid.value = null;
  push("sys", "^C");
}

function execute(raw: string) {
  const trimmed = raw.trim();
  // Echo the typed command (prompt + text), terminal-style.
  const cwdHint = cwdPath.value ? `${shortPath(cwdPath.value)} ` : "";
  push("cmd", `${cwdHint}${promptText.value} ${trimmed}`);

  if (!trimmed) return;
  cmdHistory.value.push(trimmed);
  historyIdx.value = -1;

  const [name, ...args] = trimmed.split(/\s+/);
  if (BUILTIN[name]) {
    const out = BUILTIN[name](args);
    if (out) push("out", out);
    scrollToEnd();
    return;
  }

  if (!inElectron || !window.electronAPI) {
    push("err", "Shell execution is unavailable in browser mode. Run the desktop app.");
    scrollToEnd();
    return;
  }
  void runRemote(raw);
  scrollToEnd();
}

function shortPath(p: string): string {
  // Keep the basename + a trailing ellipsis parent — enough context without
  // stealing horizontal space from long commands.
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-1)[0];
}

function submit() {
  if (runningPid.value != null) return; // Don't queue while busy.
  const value = input.value;
  execute(value);
  input.value = "";
  scrollToEnd();
}

function onKeydown(e: KeyboardEvent) {
  // Ctrl+C: interrupt the running process (or clear current line).
  if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (runningPid.value != null) {
      void killCurrent();
    } else {
      input.value = "";
    }
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    submit();
  } else if (e.key === "Tab") {
    e.preventDefault();
    void completeToken();
  } else if (e.key === "ArrowUp") {
    if (cmdHistory.value.length === 0) return;
    e.preventDefault();
    if (historyIdx.value === -1) historyIdx.value = cmdHistory.value.length - 1;
    else historyIdx.value = Math.max(0, historyIdx.value - 1);
    input.value = cmdHistory.value[historyIdx.value] ?? "";
  } else if (e.key === "ArrowDown") {
    if (historyIdx.value === -1) return;
    e.preventDefault();
    historyIdx.value += 1;
    if (historyIdx.value >= cmdHistory.value.length) {
      historyIdx.value = -1;
      input.value = "";
    } else {
      input.value = cmdHistory.value[historyIdx.value] ?? "";
    }
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    clear();
  }
}

function focus() {
  inputEl.value?.focus();
}

defineExpose({ focus });

// ── Resizable top edge (drag to grow/shrink) ─────────────────────────────
const dragHeight = ref(props.modelHeight ?? 220);
emit("update:modelHeight", dragHeight.value);

watch(
  () => props.modelHeight,
  (h) => {
    if (typeof h === "number") dragHeight.value = h;
  },
);

let dragging = false;
function onDragStart(e: MouseEvent) {
  e.preventDefault();
  dragging = true;
  const startY = e.clientY;
  const startH = dragHeight.value;
  const onMove = (ev: MouseEvent) => {
    if (!dragging) return;
    const delta = startY - ev.clientY;
    const next = Math.max(80, Math.min(window.innerHeight - 160, startH + delta));
    dragHeight.value = next;
    emit("update:modelHeight", next);
  };
  const onUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  document.body.style.cursor = "ns-resize";
  document.body.style.userSelect = "none";
}

onMounted(() => {
  push("sys", "SpecForge Console");
  if (inElectron) {
    push(
      "sys",
      cwdPath.value ? `cwd: ${cwdPath.value}` : "No project opened — commands run without cwd.",
    );
    push("sys", "Ctrl+C interrupts the current command. Ctrl+L clears.");
    attachConsoleListener();
  } else {
    push("sys", "Browser mode — only built-in commands available (help, clear, echo, pwd, date).");
  }
  scrollToEnd();
});

onUnmounted(() => {
  unsubConsole?.();
  // Best-effort: kill any in-flight subprocess so we don't leak on tab switch.
  if (runningPid.value != null && window.electronAPI) {
    void window.electronAPI.consoleKill(runningPid.value);
  }
});
</script>

<template>
  <div
    ref="rootEl"
    class="console-root"
    :class="{ 'console-fill': fill }"
    :style="fill ? undefined : { height: `${dragHeight}px` }"
    @click="focus"
  >
    <!-- Drag handle: top edge (hidden in fill mode) -->
    <div v-if="!fill" class="console-resize" @mousedown="onDragStart" />

    <!-- Toolbar -->
    <div class="console-toolbar">
      <div class="console-tabs">
        <span class="console-tab active">CONSOLE</span>
        <span v-if="runningPid != null" class="console-running">● running</span>
      </div>
      <div class="console-actions">
        <button
          v-if="runningPid != null"
          class="console-action console-stop"
          title="Interrupt (Ctrl+C)"
          @click.stop="killCurrent"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
        <button class="console-action" title="Clear (Ctrl+L)" @click.stop="clear">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
        <button v-if="!fill" class="console-action" title="Minimize" @click.stop="emit('minimize')">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Output body -->
    <div ref="bodyEl" class="console-body">
      <div v-for="line in lines" :key="line.id" class="console-line" :class="`kind-${line.kind}`">
        <span class="console-text">{{ line.text || "\u00A0" }}</span>
      </div>
    </div>

    <!-- Input row -->
    <div class="console-input-row" :class="{ disabled: runningPid != null }">
      <span class="console-prompt">{{ promptText }}</span>
      <input
        ref="inputEl"
        v-model="input"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        class="console-input"
        :placeholder="runningPid != null ? 'Press Ctrl+C to interrupt…' : 'Type a command…'"
        :disabled="runningPid != null"
        @keydown="onKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.console-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 80px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 85%, #000);
  border-top: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
}
.console-fill {
  border-top: 0;
  flex: 1;
  min-height: 0;
}

.console-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
  z-index: 2;
}

.console-toolbar {
  flex: 0 0 auto;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 80%, transparent);
  user-select: none;
}

.console-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
}

.console-tab {
  padding: 2px 8px;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--color-surface-400, #94a3b8);
  border-bottom: 1px solid transparent;
}

.console-tab.active {
  color: var(--color-accent-cyan, #22d3ee);
  border-bottom-color: var(--color-accent-cyan, #22d3ee);
}

.console-running {
  font-size: 10px;
  color: var(--color-accent-amber, #f59e0b);
  animation: pulse-soft 1.4s ease-in-out infinite;
}

@keyframes pulse-soft {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.console-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.console-action {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  cursor: pointer;
}

.console-action:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent);
  color: var(--color-surface-200, #e2e8f0);
}

.console-stop {
  color: var(--color-accent-rose, #f43f5e);
}
.console-stop:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 22%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.console-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
  padding: 6px 10px;
  line-height: 1.5;
}

.console-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.console-text {
  display: inline;
}

.kind-cmd {
  color: var(--color-surface-100, #f1f5f9);
}
.kind-out {
  color: var(--color-surface-300, #cbd5e1);
}
.kind-err {
  color: var(--color-accent-rose, #f43f5e);
}
.kind-sys {
  color: var(--color-surface-500, #64748b);
  font-style: italic;
}

.console-input-row {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 6px;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
}

.console-input-row.disabled {
  opacity: 0.55;
}

.console-prompt {
  color: var(--color-accent-emerald, #10b981);
  font-weight: 600;
  user-select: none;
}

.console-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  caret-color: var(--color-accent-cyan, #22d3ee);
}

.console-input::placeholder {
  color: var(--color-surface-600, #475569);
}

.console-input:disabled {
  cursor: not-allowed;
}
</style>
