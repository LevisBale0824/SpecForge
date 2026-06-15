// ---------------------------------------------------------------------------
// Backend Message Send
// ---------------------------------------------------------------------------
// Handles sending prompts to the active backend and managing the send state.
// ---------------------------------------------------------------------------

import { ref, type Ref } from "vue";
import { getActiveBackendAdapter } from "../backends/registry";
import { getActiveBackendKind } from "../backends/registry";

export type MessageSendOptions = {
  selectedSessionId: Ref<string>;
  activeDirectory: Ref<string>;
  isSending: Ref<boolean>;
  agent: Ref<string>;
  modelId: Ref<string>;
  providerId: Ref<string>;
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
      const modelId = options.modelId.value;
      const providerId = options.providerId.value;
      const model = modelId
        ? { modelID: modelId, ...(providerId ? { providerID: providerId } : {}) }
        : undefined;

      const parts = buildPromptParts(text, attachments);
      await adapter.sendPromptAsync(sessionId, {
        directory: dir ?? "",
        agent: options.agent.value || "general",
        model,
        variant: options.variant.value || undefined,
        parts,
      });

      return true;
    } catch (error) {
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
  return parts;
}
