// ---------------------------------------------------------------------------
// Backend Session Lifecycle
// ---------------------------------------------------------------------------
// Manages session creation, selection, and abort for both OpenCode and
// CLI Bridge backends.
// ---------------------------------------------------------------------------

import type { Ref } from "vue";
import type { BackendKind } from "../backends/types";
import { getActiveBackendAdapter } from "../backends/registry";
import type { BackendSessionInfo } from "../types/backend-domain";
import { useMessages } from "./useMessages";

export type SessionLifecycleOptions = {
  activeBackendKind: Ref<BackendKind>;
  selectedSessionId: Ref<string>;
  activeDirectory: Ref<string>;
  isAborting: Ref<boolean>;
  t: (key: string) => string;
  toErrorMessage: (error: unknown) => string;
  onSessionCreated?: (session: BackendSessionInfo) => void;
  onSessionError?: (message: string) => void;
  onSessionAborted?: (sessionId: string) => void;
};

export function useBackendSessionLifecycle(options: SessionLifecycleOptions) {
  const msgStore = useMessages();

  async function createSession(directory?: string): Promise<BackendSessionInfo | undefined> {
    try {
      const dir = directory ?? options.activeDirectory.value.trim();
      if (!dir) throw new Error(options.t("errors.sessionCreateEmptyDirectory"));

      const adapter = getActiveBackendAdapter();
      const result = await adapter.createSession(dir);
      const session = result as BackendSessionInfo | undefined;

      if (session?.id) {
        options.selectedSessionId.value = session.id;
        options.onSessionCreated?.(session);
      }
      return session;
    } catch (error) {
      console.error("[SessionLifecycle] createSession failed:", error);
      const message = options.toErrorMessage(error);
      options.onSessionError?.(message);
      return undefined;
    }
  }

  // SessionScope drops SSE events for non-active sessions, so cached state
  // goes stale while a session is backgrounded. Always reconcile with the
  // server on activation; loadHistory is idempotent so it's a no-op when
  // nothing changed.
  async function refreshSessionFromServer(
    sessionId: string,
    opts?: {
      clearBeforeLoad?: boolean;
    },
  ): Promise<void> {
    try {
      const adapter = getActiveBackendAdapter();
      if (!adapter.listSessionMessages) return;
      const messages = await adapter.listSessionMessages(sessionId, {
        directory: options.activeDirectory.value || undefined,
      });
      if (!Array.isArray(messages)) return;
      if (opts?.clearBeforeLoad) msgStore.reset();
      msgStore.loadHistory(messages);
    } catch (error) {
      console.error("[SessionLifecycle] Failed to load session:", error);
    }
  }

  async function selectSession(sessionId: string) {
    if (!sessionId) return;

    const currentId = options.selectedSessionId.value;
    if (currentId && currentId !== sessionId) {
      msgStore.saveSessionState(currentId);
    }

    if (msgStore.tryLoadFromCache(sessionId)) {
      options.selectedSessionId.value = sessionId;
      void refreshSessionFromServer(sessionId);
      return;
    }

    options.selectedSessionId.value = sessionId;
    await refreshSessionFromServer(sessionId, { clearBeforeLoad: true });
  }

  async function abortSession(sessionId?: string) {
    const id = sessionId ?? options.selectedSessionId.value;
    if (!id || options.isAborting.value) return;

    options.isAborting.value = true;
    try {
      const adapter = getActiveBackendAdapter();
      if (adapter.abortSession) {
        await adapter.abortSession(id, options.activeDirectory.value || undefined);
      }
      options.onSessionAborted?.(id);
    } catch (error) {
      console.error("[SessionLifecycle] Abort failed:", error);
    } finally {
      options.isAborting.value = false;
    }
  }

  return {
    createSession,
    selectSession,
    abortSession,
  };
}
