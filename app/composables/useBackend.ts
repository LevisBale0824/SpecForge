// ---------------------------------------------------------------------------
// Backend Orchestrator — top-level composable
// ---------------------------------------------------------------------------
// Wires together useGlobalEvents, useBackendActivation, useBackendSessionLifecycle,
// and useBackendMessageSend into a single reactive surface for the UI.
// ---------------------------------------------------------------------------

import { ref, readonly, watch, type Ref } from "vue";
import { useGlobalEvents } from "./useGlobalEvents";
import { useBackendActivation } from "./useBackendActivation";
import { useBackendSessionLifecycle } from "./useBackendSessionLifecycle";
import { useBackendMessageSend } from "./useBackendMessageSend";
import { useMessages } from "./useMessages";
import { useDeltaAccumulator } from "./useDeltaAccumulator";
import { useSessionStatus } from "./useSessionStatus";
import { useSessions } from "./useSessions";
import { useModels } from "./useModels";
import { useSessionModel } from "./useSessionModel";
import { useAgents } from "./useAgents";
import { useSessionAgent } from "./useSessionAgent";
import { useCommands } from "./useCommands";
import { useFileIndex } from "./useFileIndex";
import { useProject } from "./useProject";
import { isElectron as detectElectron, readWorkspaceDiff } from "../utils/electronBridge";
import {
  getActiveBackendKind,
  getActiveBackendAdapter,
  resolveBackendConfig,
  configureOpenCodeBackend,
  configureZeroBackend,
  setActiveBackendKind,
} from "../backends/registry";
import { StorageKeys, storageGet, storageSet } from "../utils/storageKeys";
import { i18n } from "../i18n";
import type { BackendKind } from "../backends/types";
import type {
  FileDiff,
  MessageUpdatedPacket,
  SessionInfo,
  SessionStatusPacket,
} from "../types/sse";

export type { ConnectionState } from "./useBackendActivation";

// ── Module-level singleton state ──────────────────────────────────────────

const electronMode = detectElectron();

// Initialise baseUrl + authHeader from the *persisted active kind* so they
// match the adapter that `getActiveBackendAdapter()` will return. Previously
// this hardcoded opencode's URL/auth, which left the SSE client pointed at
// :13284 even when the user had last selected zero (:13286) — manifesting as
// silent connection failures and stray TIME_WAIT sockets on the wrong port.
const initialBackendKind = getActiveBackendKind();
const initialConfig = resolveBackendConfig(initialBackendKind);
const baseUrl = ref(initialConfig.url);
const authHeader = ref(initialConfig.auth);
const activeBackendKind = ref<BackendKind>(initialBackendKind);

// Shared refs consumed by multiple sub-composables
const selectedSessionId = ref("");
const activeDirectory = ref("");
const isAborting = ref(false);
const isSending = ref(false);
const agent = ref("general");
const variant = ref("");
const workspaceDiffs = ref<FileDiff[]>([]);

// Sessions we have already auto-titled from the user's first prompt. Once a
// session is in this set we never overwrite its title again — the user's
// manual rename (or the backend's own title-update event) always wins.
//
// Background: opencode updates `title` to the first user message on its own,
// but zero returns a generic "New Session - <ts>" and never updates it. To
// keep the sidebar useful across all backends we mirror opencode's behaviour
// client-side: derive a short title from the first prompt and PATCH it back.
const autoTitledSessions = new Set<string>();

function deriveTitleFromPrompt(text: string, maxLen = 48): string {
  // First non-empty line, with leading markdown markers (#, -, *, >, •, etc.)
  // stripped. Newlines turn into spaces so multi-line prompts still produce a
  // single-line title.
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const stripped = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+•]\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/`{1,3}/g, "")
    .trim();
  const collapsed = stripped.replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1).trimEnd() + "…";
}

function t(key: string): string {
  return key;
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeFileDiffs(value: unknown): FileDiff[] {
  if (Array.isArray(value)) return value as FileDiff[];
  const rec = toRecord(value);
  const diff = rec?.diff ?? rec?.diffs;
  return Array.isArray(diff) ? (diff as FileDiff[]) : [];
}

function normalizeDirectoryPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sessionBelongsToActiveDirectory(info: SessionInfo): boolean {
  const dir = activeDirectory.value;
  if (!dir) return false;
  if (!info.directory) return info.id === selectedSessionId.value;
  return normalizeDirectoryPath(info.directory) === normalizeDirectoryPath(dir);
}

// ── Sub-composable instances ──────────────────────────────────────────────

const ge = useGlobalEvents({
  baseUrl,
  authHeader: authHeader as Ref<string | undefined>,
});

const activation = useBackendActivation({
  ge,
  baseUrl,
  authHeader: authHeader as Ref<string | undefined>,
  selectedProjectId: ref(""),
  selectedSessionId,
  activeBackendKind,
  t,
  toErrorMessage,
  fetchHomePath: async () => {},
  bootstrapSelections: async () => {},
  fetchProviders: async () => {},
  fetchAgents: async () => {},
});

const sessionsStore = useSessions();
const commandsStore = useCommands();
const fileIndexStore = useFileIndex();
const modelsStore = useModels();
const sessionModelStore = useSessionModel();
const agentsStore = useAgents();
const sessionAgentStore = useSessionAgent();

// Sentinel session ID used to hold per-session model/agent selections BEFORE
// the real session exists. SpecForge creates sessions lazily on the first
// message — until then `selectedSessionId` is "". Without a draft slot the
// ModelPicker/AgentPicker chips would be unrenderable in a brand-new session
// (no key to bind to), so we let them write to this sentinel and migrate the
// selection to the real session ID once `ensureSession()` creates one.
const DRAFT_SESSION_ID = "__draft__";

// Move any draft-slot selections onto a freshly-created real session ID.
// Called after `ensureSession()` succeeds in both the prompt and command
// send paths. Idempotent — safe to call when no draft exists.
function migrateDraftSelections(realSessionId: string): void {
  if (!realSessionId || realSessionId === DRAFT_SESSION_ID) return;
  const draftModel = sessionModelStore.getModelForSession(DRAFT_SESSION_ID);
  if (draftModel && !sessionModelStore.getModelForSession(realSessionId)) {
    sessionModelStore.setModelForSession(realSessionId, draftModel.providerId, draftModel.modelId);
    sessionModelStore.clearModelForSession(DRAFT_SESSION_ID);
  }
  const draftAgent = sessionAgentStore.getAgentForSession(DRAFT_SESSION_ID);
  if (draftAgent && !sessionAgentStore.getAgentForSession(realSessionId)) {
    sessionAgentStore.setAgentForSession(realSessionId, draftAgent);
    sessionAgentStore.clearAgentForSession(DRAFT_SESSION_ID);
  }
}

// Idle fallback timers: when the backend signals task completion via
// message.updated (finish/completed/error) but doesn't follow up with a
// `session.status=idle` event within a grace window, force the session idle.
// Covers timeout/abort/crash paths where the backend drops the idle event,
// which previously left the session stuck in RUNNING forever.
//
// Grace window is intentionally generous: the backend may still be flushing
// SSE events, persisting state, or tearing down MCP/PTY resources after the
// final assistant message. Forcing idle too early makes the UI look done
// while the session is still busy — the next prompt can then race with the
// still-running one. 30s in practice absorbs backend teardown latency on
// slower machines while still recovering from a crashed backend in
// reasonable time.
const IDLE_FALLBACK_GRACE_MS = 30000;
const idleFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIdleFallback(sessionId: string): void {
  if (!sessionId) return;
  const existing = idleFallbackTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const armedAt = Date.now();
  const timer = setTimeout(() => {
    idleFallbackTimers.delete(sessionId);
    if (sessionStatus.isBusyOf(sessionId)) {
      const elapsedMs = Date.now() - armedAt;
      sessionStatus.markIdle(sessionId);
      console.warn(
        `[useBackend] Forced session ${sessionId} idle after ${elapsedMs}ms grace — ` +
          `completion signal received without a session.status=idle event. ` +
          `If this happens often, the backend may be dropping idle events or the grace window needs tuning.`,
        { sessionId, graceMs: IDLE_FALLBACK_GRACE_MS, elapsedMs },
      );
    }
  }, IDLE_FALLBACK_GRACE_MS);
  idleFallbackTimers.set(sessionId, timer);
}

function clearIdleFallback(sessionId: string): void {
  const existing = idleFallbackTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
    idleFallbackTimers.delete(sessionId);
  }
}

// Reload commands when the backend kind changes (different backend = different commands).
// Also reset models and per-session model selections — different daemons have
// different providers and session IDs, so carrying them across would cause
// stale entries to show in the picker and be sent on the next prompt.
watch(activeBackendKind, () => {
  commandsStore.reset();
  modelsStore.resetModels();
  sessionModelStore.resetAllSessionModels();
  agentsStore.resetAgents();
  sessionAgentStore.resetAllSessionAgents();
});

// Reset the file index when the project directory changes so @ mentions
// reflect the new project on the next @ press.
watch(activeDirectory, () => {
  fileIndexStore.reset();
});

watch(activeDirectory, (dir, previousDir) => {
  if (previousDir && selectedSessionId.value) {
    msgStore.saveSessionState(selectedSessionId.value);
  }
  msgStore.reset();
  sessionsStore.reset();
  selectedSessionId.value = "";
  workspaceDiffs.value = [];
  if (dir && activation.connectionState.value === "ready") {
    void refreshSessions();
  }
});

const sessionLifecycle = useBackendSessionLifecycle({
  activeBackendKind,
  selectedSessionId,
  activeDirectory,
  isAborting,
  t,
  toErrorMessage,
  onSessionCreated: (session) => {
    // Register the freshly created session immediately so the sidebar shows it
    // without waiting for the (sometimes delayed) session.created SSE event.
    if (session?.id) {
      sessionsStore.upsert({
        id: session.id,
        projectID: session.projectID ?? "",
        directory: session.directory ?? activeDirectory.value,
        title: session.title ?? `Session ${session.id.slice(0, 8)}`,
        slug: session.slug ?? "",
        version: "",
        time: {
          created: session.time?.created ?? Date.now() / 1000,
          updated: session.time?.updated ?? Date.now() / 1000,
        },
      });
    }
  },
});

// Track sessions from the backend so the sidebar can list/switch them.
ge.on("session.created", (payload) => {
  const info = (payload as { info?: SessionInfo })?.info;
  if (info && sessionBelongsToActiveDirectory(info)) sessionsStore.upsert(info);
});
ge.on("session.updated", (payload) => {
  const info = (payload as { info?: SessionInfo })?.info;
  if (info && sessionBelongsToActiveDirectory(info)) sessionsStore.upsert(info);
});
ge.on("session.deleted", (payload) => {
  const info = (payload as { info?: SessionInfo })?.info;
  if (info?.id) sessionsStore.remove(info.id);
});

ge.on("message.updated", (payload) => {
  const info = (payload as MessageUpdatedPacket).info;
  if (!info || info.role !== "assistant") return;
  if (info.time?.completed === undefined && !info.finish && !info.error) return;
  scheduleDiffRefresh(info.sessionID);
  // Backend signaled completion — arm the idle fallback in case the
  // `session.status=idle` event never arrives (timeout / abort paths).
  scheduleIdleFallback(info.sessionID);
});

ge.on("file.edited", () => {
  if (selectedSessionId.value) scheduleDiffRefresh(selectedSessionId.value, 800);
  else scheduleWorkspaceDiffRefresh(800);
  // OpenSpec 面板也需要刷新(proposal/tasks/spec 文件可能被 agent 改了)
  void import("./useOpenSpec").then((m) => m.useOpenSpec().scheduleRefresh(800));
});

ge.on("session.status", (payload) => {
  const packet = payload as SessionStatusPacket;
  if (packet.status?.type !== "idle") return;
  // Backend sent idle — cancel any pending fallback for this session.
  clearIdleFallback(packet.sessionID);
  scheduleDiffRefresh(packet.sessionID, 250);
});

// Pull the persisted session list from the backend so previously-created
// conversations appear in the sidebar (not just ones created this run).
// Uses replace semantics (reset + upsert) so sessions removed from the
// backend disappear from the sidebar, and stale entries from a previously-
// connected backend don't linger after reconnect.
async function refreshSessions(): Promise<void> {
  try {
    const adapter = getActiveBackendAdapter();
    if (!adapter.listSessions) return;
    if (!activeDirectory.value) {
      sessionsStore.reset();
      return;
    }
    const result = (await adapter.listSessions({
      directory: activeDirectory.value,
    })) as SessionInfo[] | undefined;
    if (Array.isArray(result)) {
      sessionsStore.reset();
      for (const info of result) {
        if (sessionBelongsToActiveDirectory(info)) sessionsStore.upsert(info);
      }
    }
  } catch (error) {
    console.error("[useBackend] refreshSessions failed:", error);
  }
}

const messageSend = useBackendMessageSend({
  selectedSessionId,
  activeDirectory,
  isSending,
  agent,
  variant,
  toErrorMessage,
});

// ── SSE → Message Store binding ──────────────────────────────────────────

const msgStore = useMessages();
const acc = useDeltaAccumulator();
const sessionStatus = useSessionStatus(selectedSessionId);
// Bind once to the global SSE bus so we capture every session's status event
// (including sub-agent sessions whose sessionID differs from the active one).
sessionStatus.bindGlobal(ge);
const pendingDiffRefresh = new Map<string, number>();
let pendingWorkspaceDiffRefresh: number | undefined;

async function refreshWorkspaceDiffs(): Promise<FileDiff[]> {
  if (!activeDirectory.value) {
    workspaceDiffs.value = [];
    return [];
  }
  try {
    const diffs = ((await readWorkspaceDiff(activeDirectory.value)) ?? []) as FileDiff[];
    workspaceDiffs.value = diffs;
    return diffs;
  } catch (error) {
    console.error("[useBackend] refresh workspace diff failed:", error);
    workspaceDiffs.value = [];
    return [];
  }
}

function scheduleWorkspaceDiffRefresh(delayMs = 250): void {
  if (pendingWorkspaceDiffRefresh !== undefined) {
    window.clearTimeout(pendingWorkspaceDiffRefresh);
  }
  pendingWorkspaceDiffRefresh = window.setTimeout(() => {
    pendingWorkspaceDiffRefresh = undefined;
    void refreshWorkspaceDiffs();
  }, delayMs);
}

function scheduleDiffRefresh(sessionId: string, delayMs = 500): void {
  if (!sessionId) return;
  const existing = pendingDiffRefresh.get(sessionId);
  if (existing !== undefined) window.clearTimeout(existing);

  const timer = window.setTimeout(async () => {
    pendingDiffRefresh.delete(sessionId);
    let sessionDiffs: FileDiff[] = [];
    const adapter = getActiveBackendAdapter();
    if (adapter.getSessionDiff) {
      try {
        const result = await adapter.getSessionDiff({
          sessionID: sessionId,
          directory: activeDirectory.value || undefined,
        });
        sessionDiffs = normalizeFileDiffs(result);
      } catch (error) {
        console.error("[useBackend] refresh session diff failed:", error);
      }
    }
    const workspace = await refreshWorkspaceDiffs();
    msgStore.setSessionDiffs(sessionId, workspace.length > 0 ? workspace : sessionDiffs);
  }, delayMs);

  pendingDiffRefresh.set(sessionId, timer);
}

// Bind SSE scope to message store when session changes.
// NOTE: both `msgStore.bindScope` and `acc.listen` subscribe to delta/part
// events on the scope. We MUST unbind the previous accumulator before
// re-binding — otherwise every session switch stacks another listener on
// the same scope, and deltas get appended N times into the accumulator's
// module-level Map (which `loadHistory` later merges into the message
// store, surfacing as duplicated streamed text in the UI).
let accUnlisten: (() => void) | null = null;

watch(selectedSessionId, (newId) => {
  if (!newId) return;
  const scope = ge.session(selectedSessionId);
  msgStore.bindScope(scope);
  if (accUnlisten) accUnlisten();
  accUnlisten = acc.listen(scope);
  scheduleDiffRefresh(newId, 0);
});

// Sync project directory → activeDirectory
// Only use absolute paths (starting with / or drive letter like C:\)
function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(p) || p.startsWith("/");
}

const project = useProject();
watch(
  () => project.state.directoryPath,
  (path) => {
    if (path && isAbsolutePath(path)) {
      activeDirectory.value = path;
      scheduleWorkspaceDiffRefresh(0);
    }
    if (path && selectedSessionId.value) {
      scheduleDiffRefresh(selectedSessionId.value, 0);
    }
  },
  { immediate: true },
);

// ── Electron: auto-connect when project directory is set ──────────────────

if (electronMode) {
  // The main process starts the agent server in app.whenReady() before the
  // window is created, so by the time this module initializes the server is
  // already listening. Connect immediately rather than waiting for the user
  // to open a project — this makes the sidebar status accurate on launch and
  // avoids a confusing "disconnected" state on a healthy backend.
  activation.startInitialization();

  watch(
    () => project.state.directoryPath,
    (path) => {
      if (!path) return;
      if (activation.connectionState.value === "disconnected") {
        activation.startInitialization();
      }
    },
  );
}

// Refresh the sidebar with previously-persisted sessions once the connection
// is ready. We deliberately do NOT eagerly create a session here: agent
// switching (switchBackend → reconnect → "ready") would otherwise trigger a
// new empty session on every switch. Session creation is deferred to the
// first message (see ensureSession in the sendPrompt flow).
watch(activation.connectionState, (state) => {
  if (state === "ready") {
    void refreshSessions();
    void modelsStore.refreshModels();
    void agentsStore.refreshAgents();
  }
});

// ── Public API ────────────────────────────────────────────────────────────

export function useBackend() {
  async function ensureSession(): Promise<string> {
    if (selectedSessionId.value) return selectedSessionId.value;
    const dir = activeDirectory.value || undefined;
    const session = await sessionLifecycle.createSession(dir);
    return session?.id ?? selectedSessionId.value;
  }

  // Begin a fresh conversation in the same window: cache the current session's
  // messages, clear the transcript, and drop the active session id so the next
  // prompt lazily creates a brand-new session. Previous sessions remain in the
  // sidebar and can be switched back to.
  function startNewSession(): void {
    const currentId = selectedSessionId.value;
    if (currentId) msgStore.saveSessionState(currentId);
    msgStore.reset();
    selectedSessionId.value = "";
    // Clear any leftover draft selections from a previous new-session flow so
    // the picker chips start clean for this new session.
    sessionModelStore.clearModelForSession(DRAFT_SESSION_ID);
    sessionAgentStore.clearAgentForSession(DRAFT_SESSION_ID);
  }

  async function sendPromptWithSession(text: string, attachments: string[] = []): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Optimistically show the user message immediately
    const tempId = msgStore.addPendingUserMessage(
      selectedSessionId.value || "pending",
      trimmed,
      agent.value,
    );

    await ensureSession();
    if (!selectedSessionId.value) {
      msgStore.removeMessage(tempId);
      return false;
    }

    // If the user pre-selected a model/agent via the draft slot (before the
    // session existed), migrate those selections onto the real session ID so
    // sendPrompt picks them up.
    migrateDraftSelections(selectedSessionId.value);

    const success = await messageSend.sendPrompt(trimmed, attachments);
    if (!success) {
      msgStore.removeMessage(tempId);
      return success;
    }

    // First-prompt auto-titling. Only fires once per session and only when the
    // backend hasn't already given the session a real title (i.e. the title is
    // still the "Session xxxxxxxx" / "New Session - …" placeholder). This
    // covers zero (which never auto-titles) without fighting opencode (which
    // does).
    void maybeAutoTitleSession(selectedSessionId.value, trimmed);

    // On success, the real message arrives via SSE and auto-cleans the temp
    return success;
  }

  // Send a slash command (e.g. "/opsx:explore some topic"). The text is split
  // into command id + free-form arguments, then dispatched via adapter.sendCommand.
  async function sendCommandWithSession(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return false;
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const command = cmd.slice(1);
    if (!command) return false;
    const args = rest.join(" ");

    const tempId = msgStore.addPendingUserMessage(
      selectedSessionId.value || "pending",
      trimmed,
      agent.value,
    );

    await ensureSession();
    if (!selectedSessionId.value) {
      msgStore.removeMessage(tempId);
      return false;
    }
    migrateDraftSelections(selectedSessionId.value);

    isSending.value = true;
    try {
      const adapter = getActiveBackendAdapter();
      if (!adapter.sendCommand) {
        throw new Error("Backend does not support sending commands");
      }
      // Per-session model selection for slash-commands. The sendCommand API
      // takes a bare `model: string` (modelID only); the backend routes to
      // the matching provider itself. If the session has no explicit model
      // selection we leave it undefined and fall back to the backend default.
      const sel = useSessionModel().getModelForSession(selectedSessionId.value);
      const sessionAgent = useSessionAgent().getAgentForSession(selectedSessionId.value);
      await adapter.sendCommand(selectedSessionId.value, {
        directory: activeDirectory.value || undefined,
        command,
        arguments: args,
        agent: sessionAgent || agent.value || undefined,
        model: sel?.modelId,
        variant: variant.value || undefined,
      });
      return true;
    } catch (error) {
      msgStore.removeMessage(tempId);
      console.error("[useBackend] sendCommand failed:", error);
      return false;
    } finally {
      isSending.value = false;
    }
  }

  function ensureCommandsLoaded(): void {
    const adapter = getActiveBackendAdapter();
    commandsStore.ensureLoaded(adapter, activeDirectory.value || undefined);
  }

  function ensureFilesLoaded(): void {
    if (!activeDirectory.value) return;
    fileIndexStore.ensureLoaded(activeDirectory.value);
  }

  async function maybeAutoTitleSession(sessionId: string, promptText: string): Promise<void> {
    if (autoTitledSessions.has(sessionId)) return;
    const existing = sessionsStore.sessions.value.get(sessionId);
    if (!existing) return;

    // Skip if the session already has a meaningful title (opencode / user
    // rename). Match the "Session <id>" / "New Session …" placeholders plus
    // any title that's just an 8-char id prefix.
    const current = (existing.title ?? "").trim();
    const isPlaceholder =
      !current ||
      /^Session(\s|$)/i.test(current) ||
      /^New\s+Session/i.test(current) ||
      current === sessionId.slice(0, 8);
    if (!isPlaceholder) {
      autoTitledSessions.add(sessionId);
      return;
    }

    const title = deriveTitleFromPrompt(promptText);
    if (!title) return;
    autoTitledSessions.add(sessionId);

    // Optimistically update the sidebar so the new title shows up immediately.
    sessionsStore.upsert({
      ...existing,
      title,
      time: { ...existing.time, updated: Date.now() / 1000 },
    });

    // Persist on the backend (best-effort). If zero/opencode rejects the
    // PATCH we keep the optimistic sidebar title — it's still more useful than
    // "New Session - 1700000000".
    try {
      const adapter = getActiveBackendAdapter();
      if (adapter.updateSession) {
        await adapter.updateSession(sessionId, { title }, activeDirectory.value || undefined);
      }
    } catch (error) {
      console.warn("[useBackend] auto-title PATCH failed:", error);
    }
  }

  function setBaseUrl(url: string) {
    baseUrl.value = url;
    const kind = activeBackendKind.value;
    if (kind === "opencode") {
      storageSet(StorageKeys.auth.opencodeBaseUrl, url);
      configureOpenCodeBackend({ baseUrl: url });
    } else if (kind === "zero") {
      storageSet(StorageKeys.auth.zeroBaseUrl, url);
      configureZeroBackend({ baseUrl: url });
    }
  }

  function setAuthHeader(header: string | undefined) {
    authHeader.value = header;
    const kind = activeBackendKind.value;
    if (kind === "opencode") {
      if (header) storageSet(StorageKeys.auth.opencodeAuthorization, header);
      else storageSet(StorageKeys.auth.opencodeAuthorization, "");
      configureOpenCodeBackend({ authorization: header });
    } else if (kind === "zero") {
      if (header) storageSet(StorageKeys.auth.zeroAuthorization, header);
      else storageSet(StorageKeys.auth.zeroAuthorization, "");
      configureZeroBackend({ authorization: header });
    }
  }

  /**
   * Switch to a different backend kind. Reconfigures the new adapter with its
   * persisted URL/auth, updates the active ref, and (in Electron mode) asks
   * the main process to restart the spawned CLI with the new kind/port.
   *
   * Does NOT auto-connect — caller should invoke `reconnect()` after switch.
   */
  /**
   * Apply persisted URL/auth for a backend kind into the shared client state.
   * Factored out so switchBackend can reuse it when rolling back after a
   * failed switch.
   */
  function applyBackendConfig(kind: BackendKind): void {
    const { url, auth } = resolveBackendConfig(kind);
    baseUrl.value = url;
    authHeader.value = auth;
    if (kind === "opencode") {
      configureOpenCodeBackend({ baseUrl: url, authorization: auth });
    } else if (kind === "zero") {
      configureZeroBackend({ baseUrl: url, authorization: auth });
    }
  }

  /**
   * Restart the current agent's server (Electron only). Used to recover from
   * an externally-killed daemon (e.g. user killed opencode.exe in Task Manager).
   * Calls the main process's setAgentConfig IPC, which calls restartServer()
   * internally and returns the new server status.
   *
   * Unlike switchBackend, this does NOT change the active kind — it just
   * respawns the same CLI. On failure, writes to errorMessage so the UI can
   * surface the problem.
   */
  async function restartCurrentAgent(): Promise<boolean> {
    if (!electronMode) return false;
    const kind = activeBackendKind.value;
    if (kind !== "opencode" && kind !== "zero") return false;

    activation.errorMessage.value = "";
    try {
      const { restartAgent } = await import("../utils/electronBridge");
      const result = await restartAgent(kind);
      if (!result || !result.status.running) {
        activation.errorMessage.value = i18n.global.t("status.startFailed", {
          agent: kind,
          reason: i18n.global.t("status.serverDown"),
        });
        return false;
      }
      // Server is back up — ask activation flow to reconnect SSE/REST.
      void activation.reconnect();
      return true;
    } catch (e) {
      console.warn(`[useBackend] restart ${kind} failed:`, e);
      activation.errorMessage.value = i18n.global.t("status.startFailed", {
        agent: kind,
        reason: toErrorMessage(e),
      });
      return false;
    }
  }

  async function switchBackend(kind: BackendKind): Promise<void> {
    if (kind === activeBackendKind.value) return;
    const previousKind = activeBackendKind.value;

    activeBackendKind.value = kind;
    setActiveBackendKind(kind);
    applyBackendConfig(kind);
    activation.errorMessage.value = "";

    // Clear session/message state. The previous agent's session IDs and
    // messages belong to that agent's daemon; mixing them with the new agent
    // would show stale or invalid data. switchBackend auto-reconnects after
    // both successful switch and successful rollback.
    if (selectedSessionId.value) {
      msgStore.saveSessionState(selectedSessionId.value);
    }
    msgStore.reset();
    // Reset sessions too — otherwise the new backend's refresh would upsert
    // into a map still holding the previous backend's session IDs, causing
    // cross-backend bleed (e.g. zero sessions showing under opencode, which
    // can't be opened because opencode's daemon doesn't know about them).
    sessionsStore.reset();
    selectedSessionId.value = "";

    // In Electron, ask main process to restart the CLI with the new kind.
    // cli-bridge runs as a separate process (not spawned by main), so we only
    // restart for opencode/zero.
    if (kind === "opencode" || kind === "zero") {
      try {
        const { restartAgent } = await import("../utils/electronBridge");
        const result = await restartAgent(kind);
        // If the main process reports the server didn't come up (e.g. CLI
        // binary missing), roll back to the previous kind so the user is
        // not stuck on a dead backend.
        if (!result || !result.status.running) {
          throw new Error(i18n.global.t("status.serverDown"));
        }
        // Server is up — reconnect SSE/REST to the new backend.
        void activation.reconnect();
      } catch (e) {
        console.warn(`[useBackend] switch to ${kind} failed, rolling back:`, e);
        activeBackendKind.value = previousKind;
        setActiveBackendKind(previousKind);
        applyBackendConfig(previousKind);
        // Restore the previous backend's server process — it was stopped when
        // we attempted to start the new one. Only opencode/zero have a main-
        // process-managed lifecycle; cli-bridge runs externally.
        let rollbackOk = true;
        if (previousKind === "opencode" || previousKind === "zero") {
          try {
            const { restartAgent } = await import("../utils/electronBridge");
            const result = await restartAgent(previousKind);
            if (!result || !result.status.running) rollbackOk = false;
          } catch {
            // best-effort; previous state may have been a misconfigured backend too
            rollbackOk = false;
          }
        }
        if (rollbackOk) {
          // Previous server restored — reconnect to it so the UI reflects the
          // recovered state instead of staying "disconnected".
          void activation.reconnect();
        } else {
          // Only surface the original failure if rollback ALSO failed to
          // restore a working server. If rollback succeeded the UI is already
          // back on a healthy backend, so showing "zero failed" would be
          // misleading noise.
          activation.errorMessage.value = i18n.global.t("status.startFailed", {
            agent: kind,
            reason: toErrorMessage(e),
          });
        }
      }
    }
  }

  function setActiveDirectory(dir: string) {
    activeDirectory.value = dir;
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const adapter = getActiveBackendAdapter();
      if (adapter.deleteSession) {
        await adapter.deleteSession(sessionId, activeDirectory.value || undefined);
      }
    } catch (error) {
      console.error("[useBackend] deleteSession failed:", error);
    }
    sessionsStore.remove(sessionId);
    sessionStatus.remove(sessionId);
    sessionModelStore.clearModelForSession(sessionId);
    sessionAgentStore.clearAgentForSession(sessionId);
    // If the deleted session was active, clear the transcript so the next prompt
    // lazily creates a fresh session.
    if (selectedSessionId.value === sessionId) {
      msgStore.saveSessionState(sessionId);
      msgStore.reset();
      selectedSessionId.value = "";
    }
  }

  return {
    // State
    baseUrl: readonly(baseUrl),
    authHeader: readonly(authHeader),
    activeBackendKind: readonly(activeBackendKind),
    activeDirectory: readonly(activeDirectory),
    selectedSessionId: readonly(selectedSessionId),
    connectionState: activation.connectionState,
    errorMessage: activation.errorMessage,
    initMessage: activation.initMessage,
    isSending: readonly(isSending),
    isBusy: sessionStatus.isBusy,
    isRetrying: sessionStatus.isRetrying,
    sessionStatus: sessionStatus.status,
    statusOf: sessionStatus.statusOf,
    isBusyOf: sessionStatus.isBusyOf,
    sessions: sessionsStore.sortedSessions,
    workspaceDiffs: readonly(workspaceDiffs),
    isElectron: electronMode,

    // Actions
    connect: activation.startInitialization,
    disconnect: activation.abortInitialization,
    reconnect: activation.reconnect,
    setBaseUrl,
    setAuthHeader,
    setActiveDirectory,
    switchBackend,
    restartCurrentAgent,
    scheduleWorkspaceDiffRefresh,

    // Session
    createSession: sessionLifecycle.createSession,
    selectSession: sessionLifecycle.selectSession,
    deleteSession,
    abortSession: sessionLifecycle.abortSession,
    startNewSession,

    // Messages (with auto session creation)
    sendPrompt: sendPromptWithSession,
    sendCommand: sendCommandWithSession,

    // Slash commands
    commands: commandsStore.commands,
    commandsLoading: commandsStore.loading,
    ensureCommandsLoaded,

    // File mentions (@)
    files: fileIndexStore.files,
    filesLoading: fileIndexStore.loading,
    ensureFilesLoaded,

    // Global events (for SSE subscription)
    globalEvents: ge,
  };
}
