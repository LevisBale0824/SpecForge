/**
 * Shiki ships a built-in `css-variables` theme: highlight HTML uses
 * `var(--shiki-*)` tokens instead of literal colors. Each UI theme in
 * `app/themes/index.ts` defines its own `--shiki-*` values, so code blocks
 * recolor instantly when the UI theme changes — no re-render needed.
 */
export const DEFAULT_SYNTAX_THEME = "css-variables";
