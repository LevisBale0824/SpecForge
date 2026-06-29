// ---------------------------------------------------------------------------
// Lightweight Markdown Renderer (main-thread)
// ---------------------------------------------------------------------------
// Synchronous markdown-it render for chat message text. The full Shiki-based
// worker pipeline (render-worker.ts) is overkill for inline chat content and
// is async, which complicates streaming reactivity. Here we keep it simple:
// markdown-it with safe defaults + target-blank links. Code fences get a
// generic monospace block (no syntax highlighting) — acceptable for prose.
// ---------------------------------------------------------------------------

import MarkdownIt from "markdown-it";

let instance: MarkdownIt | null = null;
let copyDelegationInstalled = false;

function getInstance(): MarkdownIt {
  if (instance) return instance;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });

  // Open links in a new tab safely.
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Wrap fenced and indented code blocks in a container carrying a copy
  // button. The rendered button is inert by itself — a single document-level
  // click delegate (installed below) reads the sibling <pre><code> text and
  // writes it to the clipboard. Vue listeners can't bind inside v-html, so
  // document delegation is the lightweight way to make every rendered code
  // block copyable, no matter which component hosts the HTML.
  md.renderer.rules.fence = (tokens, idx, options) => {
    const token = tokens[idx];
    const lang = token.info ? token.info.trim().split(/\s+/)[0] : "";
    const langClass = lang ? `${options.langPrefix}${md.utils.escapeHtml(lang)}` : "";
    return wrapCodeBlock(langClass, md.utils.escapeHtml(token.content));
  };
  md.renderer.rules.code_block = (tokens, idx) =>
    wrapCodeBlock("", md.utils.escapeHtml(tokens[idx].content));

  instance = md;
  installCopyDelegation();
  return md;
}

function wrapCodeBlock(langClass: string, code: string): string {
  return (
    '<div class="code-block-wrapper">' +
    '<button type="button" class="code-copy-btn" aria-label="复制代码">复制</button>' +
    `<pre><code class="${langClass}">${code}</code></pre>` +
    "</div>\n"
  );
}

function installCopyDelegation(): void {
  if (copyDelegationInstalled || typeof document === "undefined") return;
  copyDelegationInstalled = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLElement>(".code-copy-btn");
    if (!btn) return;
    const wrapper = btn.closest(".code-block-wrapper");
    const codeEl = wrapper?.querySelector("code");
    if (!codeEl) return;
    const text = codeEl.textContent ?? "";
    navigator.clipboard?.writeText(text).then(
      () => {
        btn.textContent = "已复制";
        btn.classList.add("copied");
        window.setTimeout(() => {
          btn.textContent = "复制";
          btn.classList.remove("copied");
        }, 1200);
      },
      () => {},
    );
  });
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return getInstance().render(text);
}

export function useMarkdown() {
  return { render: renderMarkdown };
}
