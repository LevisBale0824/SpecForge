// ---------------------------------------------------------------------------
// Generate PNG icons for Linux .desktop integration.
//
// Linux desktops (GNOME/KDE) follow the Freedesktop icon theme spec:
//   ~/.local/share/icons/hicolor/<size>x<size>/apps/<app-id>.png
//   /usr/share/icons/hicolor/<size>x<size>/apps/<app-id>.png
// 256×256 covers the modern "high-res" slot used by .desktop files; 128×128
// covers taskbars / window switchers. Older 32/64/512 slots are dropped —
// modern desktops upscale cleanly from 256.
//
// Three families of variants are emitted:
//   - solid:    single-color backgrounds (original palette)
//   - vivid:    two-stop 135° gradients — "网红款" vibrant tones
//   - frosted:  gradients with a glassy gloss overlay + inner border to
//               evoke frosted-glass / 毛玻璃 look
//
// The `dark` variant is the canonical one — it is also copied to the top-level
// `specforge.png` used by electron-builder and the default `.desktop` Icon=
// field.
//
// Usage:  pnpm gen:icons
// ---------------------------------------------------------------------------
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(ROOT, "build/icon.svg");
const OUT_DIR = resolve(ROOT, ".generated/icons");

// Modern desktops upscale cleanly from 256; 32/64/512 slots dropped by request.
const SIZES = [256, 128];

// Default 4-dot palette for dark / saturated backgrounds (bright tones).
const DEFAULT_DOTS = {
  cyan: "#22d3ee",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
};

// Softer palette for light backgrounds — keeps dots readable.
const LIGHT_DOTS = {
  cyan: "#0891b2",
  indigo: "#4f46e5",
  emerald: "#059669",
  amber: "#d97706",
};

// Variant model:
//   - bg:       "#hex"  → solid fill
//               { from, to } → 135° linear gradient
//   - bracket:  angle-bracket stroke color (must contrast with bg)
//   - dots:     4-dot palette override
//   - frosted:  true → add glassy gloss overlay + inner border
//   - canonical: true → also emit top-level `specforge.png`
//
// To add a new variant: append an entry here and re-run `pnpm gen:icons`.
const VARIANTS = [
  // ── Solid (original palette) ────────────────────────────────────────────
  {
    name: "dark",
    bg: "#0b0e14",
    bracket: "#f1f5f9",
    dots: DEFAULT_DOTS,
    canonical: true,
  },
  { name: "light", bg: "#f8fafc", bracket: "#0f172a", dots: LIGHT_DOTS },
  { name: "indigo", bg: "#1e1b4b", bracket: "#e0e7ff", dots: DEFAULT_DOTS },
  { name: "emerald", bg: "#022c22", bracket: "#d1fae5", dots: DEFAULT_DOTS },
  { name: "rose", bg: "#4c0519", bracket: "#ffe4e6", dots: DEFAULT_DOTS },
  { name: "slate", bg: "#1e293b", bracket: "#f1f5f9", dots: DEFAULT_DOTS },
  { name: "amber", bg: "#451a03", bracket: "#fef3c7", dots: DEFAULT_DOTS },

  // ── Vivid gradient ("网红款") — 135° two-stop ──────────────────────────
  // dark dots read well on these saturated gradients.
  {
    name: "sunset",
    bg: { from: "#ff512f", to: "#dd2476" },
    bracket: "#fff5f5",
    dots: DEFAULT_DOTS,
  },
  {
    name: "peach",
    bg: { from: "#ffe259", to: "#ffa751" },
    bracket: "#3b1f0a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "mango",
    bg: { from: "#f7971e", to: "#ffd200" },
    bracket: "#3b1f0a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "lavender",
    bg: { from: "#c471f5", to: "#fa71cd" },
    bracket: "#1e1b4b",
    dots: DEFAULT_DOTS,
  },
  {
    name: "ocean",
    bg: { from: "#2193b0", to: "#6dd5ed" },
    bracket: "#0b1d2a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "aurora",
    bg: { from: "#43e97b", to: "#38f9d7" },
    bracket: "#0b2a1a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "cyber",
    bg: { from: "#667eea", to: "#764ba2" },
    bracket: "#f0e7ff",
    dots: DEFAULT_DOTS,
  },
  {
    name: "sky",
    bg: { from: "#56ccf2", to: "#2f80ed" },
    bracket: "#0b1d2a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "mint",
    bg: { from: "#11998e", to: "#38ef7d" },
    bracket: "#0b2a1a",
    dots: DEFAULT_DOTS,
  },
  {
    name: "cotton",
    bg: { from: "#ee9ca7", to: "#ffdde1" },
    bracket: "#5c0f1d",
    dots: DEFAULT_DOTS,
  },

  // ── Frosted glass (毛玻璃) — gradient + glossy overlay + inner border ──
  // Gloss = soft top→bottom white wash + 1.5px inner white border, mimics
  // macOS Big Sur frosted material on top of a tinted gradient.
  {
    name: "frosted-light",
    bg: { from: "#cfd9df", to: "#e2ebf0" },
    bracket: "#0f172a",
    dots: LIGHT_DOTS,
    frosted: true,
  },
  {
    name: "frosted-rose",
    bg: { from: "#ffd1ff", to: "#fadaff" },
    bracket: "#831843",
    dots: LIGHT_DOTS,
    frosted: true,
  },
  {
    name: "frosted-sky",
    bg: { from: "#a1c4fd", to: "#c2e9fb" },
    bracket: "#0b1d2a",
    dots: LIGHT_DOTS,
    frosted: true,
  },
  {
    name: "frosted-mint",
    bg: { from: "#d4fc79", to: "#96e6a1" },
    bracket: "#0b2a1a",
    dots: LIGHT_DOTS,
    frosted: true,
  },
  {
    name: "frosted-dark",
    bg: { from: "#485563", to: "#29323c" },
    bracket: "#f1f5f9",
    dots: DEFAULT_DOTS,
    frosted: true,
  },
];

function bgFill(variant) {
  return typeof variant.bg === "string" ? variant.bg : "url(#bgGrad)";
}

function bgDefs(variant) {
  if (typeof variant.bg === "string") return "";
  const { from, to } = variant.bg;
  return `    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${from}" />
      <stop offset="100%" stop-color="${to}" />
    </linearGradient>`;
}

function frostedLayer(variant) {
  if (!variant.frosted) return "";
  // Glassy top-down gloss + subtle inner border for the frosted look.
  return `
    <linearGradient id="gloss" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45" />
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.00" />
    </linearGradient>
    <rect width="256" height="256" rx="56" fill="url(#gloss)" />
    <rect x="1.5" y="1.5" width="253" height="253" rx="54.5" stroke="#ffffff" stroke-opacity="0.45" stroke-width="1.5" fill="none" />`;
}

function renderSvg(variant) {
  const d = variant.dots ?? DEFAULT_DOTS;
  const defs = [bgDefs(variant)].filter(Boolean).join("\n");
  return `<svg width="512" height="512" title="SpecForge" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
${defs}
  </defs>
  <rect width="256" height="256" rx="56" fill="${bgFill(variant)}" />${frostedLayer(variant)}
  <path d="M96 72 L28 128 L96 184" stroke="${variant.bracket}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M160 72 L228 128 L160 184" stroke="${variant.bracket}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="108" cy="172" r="8" fill="${d.cyan}" />
  <circle cx="124" cy="148" r="9" fill="${d.indigo}" />
  <circle cx="140" cy="124" r="10" fill="${d.emerald}" />
  <circle cx="156" cy="100" r="11" fill="${d.amber}" />
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const variant of VARIANTS) {
    const svg = Buffer.from(renderSvg(variant), "utf-8");
    const variantDir = resolve(OUT_DIR, "variants", variant.name);
    await mkdir(variantDir, { recursive: true });

    for (const size of SIZES) {
      const outPath = resolve(variantDir, `${size}x${size}.png`);
      await sharp(svg, { density: 384 }).resize(size, size).png().toFile(outPath);
      console.log(`✓ [${variant.name}] ${outPath}`);
    }

    // Canonical 256 for this variant — used by `.desktop` Icon= field and
    // electron-builder's per-variant lookup.
    const canonPath = resolve(variantDir, `specforge-${variant.name}.png`);
    await sharp(svg, { density: 384 }).resize(256, 256).png().toFile(canonPath);
    console.log(`✓ [${variant.name}] ${canonPath}`);

    // The canonical variant also gets the top-level specforge.png used by
    // electron-builder and the default .desktop Icon= field.
    if (variant.canonical) {
      const topPath = resolve(OUT_DIR, "specforge.png");
      await sharp(svg, { density: 384 }).resize(256, 256).png().toFile(topPath);
      console.log(`✓ [canonical=${variant.name}] ${topPath}`);
    }
  }

  // Persist the source SVG alongside the generated PNGs for reference.
  await writeFile(SVG_PATH, renderSvg(VARIANTS[0]), "utf-8");
  console.log(`✓ source SVG refreshed: ${SVG_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
