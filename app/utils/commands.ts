// ---------------------------------------------------------------------------
// Slash command syntax detection
// ---------------------------------------------------------------------------
// Used to decide whether a piece of input text should be dispatched as a
// slash command (e.g. "/commit", "/opsx:explore topic") or as a normal
// user message.
//
// Why this exists: a naive `text.startsWith("/")` check misclassifies
// path-like strings as commands. Notably, pasted opencode session URLs
// such as "/session/<sessionId>/<messageId>" start with "/" but are NOT
// commands — sending them via sendCommand causes the backend to reject
// with "unknown command" and the user sees an error.
//
// A real slash command identifier is a single token: letters, digits,
// hyphens, underscores, and colons (the latter for namespaced commands
// like "opsx:explore"). It does NOT contain "/" — that's the dead
// giveaway that the input is a path, not a command.
// ---------------------------------------------------------------------------

const SLASH_COMMAND_RE = /^\/([a-zA-Z][a-zA-Z0-9:_-]*)(?:\s[\s\S]*)?$/;

/** Returns true iff `text` looks syntactically like a slash command. */
export function isCommandLike(text: string): boolean {
  return SLASH_COMMAND_RE.test(text);
}
