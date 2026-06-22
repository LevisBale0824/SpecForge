// ---------------------------------------------------------------------------
// Backend Message Send
// ---------------------------------------------------------------------------
// Handles sending prompts to the active backend and managing the send state.
// ---------------------------------------------------------------------------

import { ref, type Ref } from "vue";
import { getActiveBackendAdapter } from "../backends/registry";
import { getActiveBackendKind } from "../backends/registry";
import { useSessionModel } from "./useSessionModel";
import { useSessionAgent } from "./useSessionAgent";

export type MessageSendOptions = {
  selectedSessionId: Ref<string>;
  activeDirectory: Ref<string>;
  isSending: Ref<boolean>;
  agent: Ref<string>;
  variant: Ref<string>;
  toErrorMessage: (error: unknown) => string;
  onSendError?: (message: string) => void;
};

export function useBackendMessageSend(options: MessageSendOptions) {
  const sendError = ref<string | null>(null);

  async function sendPrompt(text: string, attachments: string[] = []): Promise<boolean> {
    const sessionId = options.selectedSessionId.value;
    if (!sessionId || !text.trim() || options.isSending.value) return false;

    options.isSending.value = true;
    sendError.value = null;

    try {
      const adapter = getActiveBackendAdapter();
      if (!adapter.sendPromptAsync) {
        throw new Error("Backend does not support sending prompts");
      }

      const dir = options.activeDirectory.value || undefined;
      // Per-session model selection — if the user picked a model for this
      // session via ModelPicker, send it; otherwise omit `model` entirely
      // and let the backend use its configured default.
      const sel = useSessionModel().getModelForSession(sessionId);
      const model = sel ? { modelID: sel.modelId, providerID: sel.providerId } : undefined;
      // Per-session agent selection — if the user picked an agent for this
      // session via AgentPicker, send it; otherwise fall back to the global
      // `agent` ref (which is "general" by default).
      const sessionAgent = useSessionAgent().getAgentForSession(sessionId);
      const agentName = sessionAgent || options.agent.value || "general";

      const parts = buildPromptParts(text, attachments);
      console.info("[useBackendMessageSend] sendPrompt", {
        backendKind: getActiveBackendKind(),
        sessionId,
        directory: dir ?? "<empty>",
        agent: agentName,
        model,
        textLength: text.length,
        attachmentsCount: attachments.length,
        attachments,
        partsCount: parts.length,
      });
      await adapter.sendPromptAsync(sessionId, {
        directory: dir ?? "",
        agent: agentName,
        model,
        variant: options.variant.value || undefined,
        parts,
      });

      return true;
    } catch (error) {
      console.error("[useBackendMessageSend] sendPrompt failed:", error, {
        backendKind: getActiveBackendKind(),
        sessionId,
        directory: options.activeDirectory.value || "<empty>",
        agent: options.agent.value,
        textLength: text.length,
        attachmentsCount: attachments.length,
        attachments,
      });
      sendError.value = options.toErrorMessage(error);
      options.onSendError?.(sendError.value);
      return false;
    } finally {
      options.isSending.value = false;
    }
  }

  return {
    sendError,
    sendPrompt,
  };
}

// ---------------------------------------------------------------------------
// Prompt parts construction
// ---------------------------------------------------------------------------

/**
 * Build the `parts` array for `/prompt_async`.
 *
 * - OpenCode / Zero: native file parts — `{type:"file", source:{type:"file",
 *   path}}`. The backend reads the file and injects its content into the
 *   agent context (this is the whole point of @ mentions).
 * - CLI Bridge: the request body shape differs and file parts aren't
 *   supported — degrade by appending the file list as plain text so the
 *   agent at least sees which files were referenced.
 */
function buildPromptParts(text: string, attachments: string[]): Array<Record<string, unknown>> {
  const kind = getActiveBackendKind();
  if (kind === "cli-bridge" || attachments.length === 0) {
    if (kind === "cli-bridge" && attachments.length > 0) {
      console.warn(
        "[useBackendMessageSend] CLI Bridge does not support file parts; attaching as text.",
        attachments,
      );
      const list = attachments.map((p) => `- @${p}`).join("\n");
      return [{ type: "text", text: `${text}\n\nAttached files:\n${list}` }];
    }
    return [{ type: "text", text }];
  }

  const parts: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const relPath of attachments) {
    parts.push({
      type: "file",
      source: { type: "file", path: relPath },
    });
  }
  console.info("[useBackendMessageSend] buildPromptParts", {
    backendKind: kind,
    attachmentsCount: attachments.length,
    attachments,
    partsCount: parts.length,
  });
  return parts;
}
