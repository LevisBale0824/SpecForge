// ---------------------------------------------------------------------------
// releaseNotes — normalize update-source notes into HTML for v-html binding
// ---------------------------------------------------------------------------
// Different update sources return release notes in different formats:
//   - Raw markdown (e.g. `### 新增\n- xxx`) — run through markdown-it
//   - Pre-rendered HTML (e.g. GitHub `body_html`) — use as-is
//
// markdown-it is configured with `html: false` (see useMarkdown.ts), so
// feeding it HTML source would escape tags into entities (rendering
// "<h2>...</h2>" as visible text instead of a heading). Detect typical
// block-level tag patterns and pass HTML through untouched when matched.
// ---------------------------------------------------------------------------

import { renderMarkdown } from "../composables/useMarkdown";

export function toReleaseNotesHtml(content: string): string {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";
  const looksLikeHtml =
    /^<(\w+)(\s[^>]*)?>/.test(trimmed) ||
    /<\/(h[1-6]|ul|ol|li|div|p|pre|code)(\s[^>]*)?>/.test(trimmed);
  return looksLikeHtml ? trimmed : renderMarkdown(trimmed);
}
