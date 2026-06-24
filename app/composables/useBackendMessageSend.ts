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
 * `@` in the input is only a file-picker trigger (autocomplete UI). Once a
 * file is selected, the `@path` token stays literally in the text the user
 * typed. We do NOT construct opencode `file` parts for attachments:
 *
 *   - opencode's `FilePart` schema requires `source.text` (client-inlined
 *     content), which burns tokens by resending the file every turn.
 *   - Sending a file part without `source` returns 200 but the agent gets
 *     empty content and never replies (server doesn't read `url` itself).
 *
 * Instead, all backends get a single text part. The `@` is stripped from
 * each `@path` mention so the agent sees clean filenames and reads them
 * on-demand via its `read` tool — minimal tokens, on-demand loading.
 */
function buildPromptParts(text: string, attachments: string[]): Array<Record<string, unknown>> {
  if (attachments.length === 0) {
    return [{ type: "text", text }];
  }
  // Strip the leading `@` from each `@path` mention. The `@` is just the
  // picker trigger and has no meaning to the agent; the inline path already
  // tells the agent which file to read.
  let normalized = text;
  for (const relPath of attachments) {
    normalized = normalized.split(`@${relPath}`).join(relPath);
  }
  return [{ type: "text", text: normalized }];
}
