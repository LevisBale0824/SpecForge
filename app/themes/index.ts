// ---------------------------------------------------------------------------
// Theme definitions
//
// Tailwind v4's `@theme` directive defines CSS variables on :root. We override
// these at runtime via document.documentElement.style.setProperty(), so the
// same `bg-surface-*` / `text-accent-*` utilities pick up new colors without
// touching any component code.
//
// Surface scale convention:
//   dark  → surface-950 = darkest (app background), surface-100 = lightest (text)
//   light → surface-950 = lightest (app background), surface-100 = darkest (text)
// The class names never change; only the values flip.
//
// `syntaxTokens` provides the 7 CSS variables consumed by Shiki's
// `css-variables` theme — code blocks recolor instantly when the UI theme
// changes, without re-invoking the highlighter.
// ---------------------------------------------------------------------------

export interface SyntaxTokens {
  "--shiki-background": string;
  "--shiki-foreground": string;
  "--shiki-token-constant": string;
  "--shiki-token-string": string;
  "--shiki-token-comment": string;
  "--shiki-token-keyword": string;
  "--shiki-token-function": string;
}

export interface ThemeColors {
  "--color-surface-950": string;
  "--color-surface-900": string;
  "--color-surface-800": string;
  "--color-surface-700": string;
  "--color-surface-600": string;
  "--color-surface-500": string;
  "--color-surface-400": string;
  "--color-surface-300": string;
  "--color-surface-200": string;
  "--color-surface-100": string;
  "--color-accent-cyan": string;
  "--color-accent-cyan-dim": string;
  "--color-accent-emerald": string;
  "--color-accent-amber": string;
  "--color-accent-rose": string;
  "--color-accent-indigo": string;
}

export interface Theme {
  id: string;
  name: string; // Chinese display name
  nameEn: string; // English display name
  mode: "light" | "dark";
  /** 5 preview swatches for the settings card. */
  swatches: [string, string, string, string, string];
  colors: ThemeColors;
  /** Shiki css-variables theme tokens, recolor code blocks without re-render. */
  syntaxTokens: SyntaxTokens;
}

export const themes: Theme[] = [
  // ── Dark: default (balanced neutral, project default) ───────────────────
  // Near-black neutral with cyan accent. Easy on the eyes, default choice.
  {
    id: "default_dark",
    name: "平衡",
    nameEn: "Default",
    mode: "dark",
    swatches: ["#09090b", "#27272a", "#22d3ee", "#34d399", "#818cf8"],
    colors: {
      "--color-surface-950": "#09090b",
      "--color-surface-900": "#18181b",
      "--color-surface-800": "#27272a",
      "--color-surface-700": "#3f3f46",
      "--color-surface-600": "#52525b",
      "--color-surface-500": "#71717a",
      "--color-surface-400": "#a1a1aa",
      "--color-surface-300": "#d4d4d8",
      "--color-surface-200": "#e4e4e7",
      "--color-surface-100": "#f4f4f5",
      "--color-accent-cyan": "#22d3ee",
      "--color-accent-cyan-dim": "#0e7490",
      "--color-accent-emerald": "#34d399",
      "--color-accent-amber": "#fbbf24",
      "--color-accent-rose": "#fb7185",
      "--color-accent-indigo": "#818cf8",
    },
    syntaxTokens: {
      "--shiki-background": "#0b0d10",
      "--shiki-foreground": "#e4e4e7",
      "--shiki-token-constant": "#22d3ee",
      "--shiki-token-string": "#34d399",
      "--shiki-token-comment": "#71717a",
      "--shiki-token-keyword": "#fb7185",
      "--shiki-token-function": "#818cf8",
    },
  },
  // ── Dark: ocean (深海, blue-cyan accent) ────────────────────────────────
  // Inspired by opencode-visualizer-cn's ocean preset. Deep blue with cyan glow.
  {
    id: "ocean_dark",
    name: "深海",
    nameEn: "Ocean",
    mode: "dark",
    swatches: ["#0b1f33", "#13293d", "#4cc9f0", "#76e4f7", "#56cfe1"],
    colors: {
      "--color-surface-950": "#0a192d",
      "--color-surface-900": "#0b1f33",
      "--color-surface-800": "#102542",
      "--color-surface-700": "#13293d",
      "--color-surface-600": "#1a3556",
      "--color-surface-500": "#3b6080",
      "--color-surface-400": "#6f9bbb",
      "--color-surface-300": "#a8c8de",
      "--color-surface-200": "#d3e4f1",
      "--color-surface-100": "#eef6fb",
      "--color-accent-cyan": "#4cc9f0",
      "--color-accent-cyan-dim": "#2ec4ff",
      "--color-accent-emerald": "#76e4f7",
      "--color-accent-amber": "#fbbf24",
      "--color-accent-rose": "#fb7185",
      "--color-accent-indigo": "#56cfe1",
    },
    syntaxTokens: {
      "--shiki-background": "#0b1f33",
      "--shiki-foreground": "#d3e4f1",
      "--shiki-token-constant": "#4cc9f0",
      "--shiki-token-string": "#76e4f7",
      "--shiki-token-comment": "#5b7a96",
      "--shiki-token-keyword": "#a78bfa",
      "--shiki-token-function": "#56cfe1",
    },
  },
  // ── Dark: forest (林境, Everforest-inspired) ────────────────────────────
  // Deep neutral green-gray base with warm gold accent — avoids the flat
  // all-green look by keeping the bg desaturated and using amber as the
  // primary accent for real contrast.
  {
    id: "forest_dark",
    name: "林境",
    nameEn: "Forest",
    mode: "dark",
    swatches: ["#1e2520", "#2b352e", "#d3c6aa", "#a7c080", "#e69875"],
    colors: {
      "--color-surface-950": "#1e2520",
      "--color-surface-900": "#272e29",
      "--color-surface-800": "#2b352e",
      "--color-surface-700": "#364039",
      "--color-surface-600": "#4a554e",
      "--color-surface-500": "#6b7872",
      "--color-surface-400": "#9aa39e",
      "--color-surface-300": "#c4ccc7",
      "--color-surface-200": "#e0e4e1",
      "--color-surface-100": "#f2f4f2",
      "--color-accent-cyan": "#a7c080",
      "--color-accent-cyan-dim": "#87a35e",
      "--color-accent-emerald": "#a7c080",
      "--color-accent-amber": "#dbbc7f",
      "--color-accent-rose": "#e67e80",
      "--color-accent-indigo": "#d3c6aa",
    },
    syntaxTokens: {
      "--shiki-background": "#1e2520",
      "--shiki-foreground": "#d3c6aa",
      "--shiki-token-constant": "#dbbc7f",
      "--shiki-token-string": "#a7c080",
      "--shiki-token-comment": "#7a8079",
      "--shiki-token-keyword": "#e67e80",
      "--shiki-token-function": "#d3c6aa",
    },
  },
  // ── Dark: sakura (樱粉, Tokyo-night inspired pink) ───────────────────────
  // Neutral deep aubergine base (not muddy plum) with sakura pink + soft
  // lavender accents — cleaner than the literal pink-on-pink approach.
  {
    id: "sakura_dark",
    name: "樱粉",
    nameEn: "Sakura",
    mode: "dark",
    swatches: ["#1a1420", "#241a2c", "#ff9ec7", "#c4a7e7", "#9ece6a"],
    colors: {
      "--color-surface-950": "#16121d",
      "--color-surface-900": "#1a1420",
      "--color-surface-800": "#241a2c",
      "--color-surface-700": "#2f2440",
      "--color-surface-600": "#3e3354",
      "--color-surface-500": "#5b5274",
      "--color-surface-400": "#87809e",
      "--color-surface-300": "#b4aec3",
      "--color-surface-200": "#dcd6e6",
      "--color-surface-100": "#f3eff7",
      "--color-accent-cyan": "#ff9ec7",
      "--color-accent-cyan-dim": "#e679a8",
      "--color-accent-emerald": "#9ece6a",
      "--color-accent-amber": "#e0af68",
      "--color-accent-rose": "#f7768e",
      "--color-accent-indigo": "#c4a7e7",
    },
    syntaxTokens: {
      "--shiki-background": "#1a1420",
      "--shiki-foreground": "#dcd6e6",
      "--shiki-token-constant": "#e0af68",
      "--shiki-token-string": "#9ece6a",
      "--shiki-token-comment": "#5b5274",
      "--shiki-token-keyword": "#c4a7e7",
      "--shiki-token-function": "#ff9ec7",
    },
  },
  // ── Light: slate gray (GitHub inspired) ─────────────────────────────────
  // Neutral gray-blue, clean and professional. Great default for daytime.
  {
    id: "slate_gray_light",
    name: "石板灰",
    nameEn: "Slate Gray",
    mode: "light",
    swatches: ["#f8fafc", "#e2e8f0", "#0ea5e9", "#10b981", "#64748b"],
    colors: {
      "--color-surface-950": "#f8fafc",
      "--color-surface-900": "#f1f5f9",
      "--color-surface-800": "#e2e8f0",
      "--color-surface-700": "#cbd5e1",
      "--color-surface-600": "#94a3b8",
      "--color-surface-500": "#64748b",
      "--color-surface-400": "#475569",
      "--color-surface-300": "#334155",
      "--color-surface-200": "#1e293b",
      "--color-surface-100": "#0f172a",
      "--color-accent-cyan": "#0ea5e9",
      "--color-accent-cyan-dim": "#0369a1",
      "--color-accent-emerald": "#10b981",
      "--color-accent-amber": "#d97706",
      "--color-accent-rose": "#e11d48",
      "--color-accent-indigo": "#6366f1",
    },
    syntaxTokens: {
      "--shiki-background": "#f8fafc",
      "--shiki-foreground": "#0f172a",
      "--shiki-token-constant": "#0ea5e9",
      "--shiki-token-string": "#10b981",
      "--shiki-token-comment": "#64748b",
      "--shiki-token-keyword": "#e11d48",
      "--shiki-token-function": "#6366f1",
    },
  },
  // ── Light: Solarized Light ──────────────────────────────────────────────
  // Warm cream background, classic dev palette. Low strain for long reading.
  {
    id: "solarized_light",
    name: "暖砂",
    nameEn: "Solarized Light",
    mode: "light",
    swatches: ["#fdf6e3", "#eee8d5", "#268bd2", "#859900", "#d33682"],
    colors: {
      "--color-surface-950": "#fdf6e3",
      "--color-surface-900": "#f5efdc",
      "--color-surface-800": "#eee8d5",
      "--color-surface-700": "#d6cfb6",
      "--color-surface-600": "#b3ac8e",
      "--color-surface-500": "#8b8670",
      "--color-surface-400": "#657b83",
      "--color-surface-300": "#586e75",
      "--color-surface-200": "#3f5260",
      "--color-surface-100": "#073642",
      "--color-accent-cyan": "#2aa198",
      "--color-accent-cyan-dim": "#268bd2",
      "--color-accent-emerald": "#859900",
      "--color-accent-amber": "#b58900",
      "--color-accent-rose": "#dc322f",
      "--color-accent-indigo": "#6c71c4",
    },
    syntaxTokens: {
      "--shiki-background": "#fdf6e3",
      "--shiki-foreground": "#073642",
      "--shiki-token-constant": "#268bd2",
      "--shiki-token-string": "#859900",
      "--shiki-token-comment": "#8b8670",
      "--shiki-token-keyword": "#dc322f",
      "--shiki-token-function": "#6c71c4",
    },
  },
];

export const DEFAULT_THEME_ID = "default_dark";

/**
 * Light/dark pairing for follow-system mode. Each dark theme maps to a light
 * counterpart; themes missing a pair fall back to themselves (no flip).
 */
export const SYSTEM_MODE_PAIRS: Record<string, string> = {
  default_dark: "slate_gray_light",
  slate_gray_light: "default_dark",
  ocean_dark: "solarized_light",
  solarized_light: "ocean_dark",
  // forest_dark and sakura_dark have no natural light counterpart — keep as-is.
};

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}
