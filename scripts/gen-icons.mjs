// ---------------------------------------------------------------------------
// Generate PNG icons for Linux .desktop integration.
//
// Linux desktops (GNOME/KDE) follow the Freedesktop icon theme spec:
//   ~/.local/share/icons/hicolor/<size>x<size>/apps/<app-id>.png
//   /usr/share/icons/hicolor/<size>x<size>/apps/<app-id>.png
// 512×512 is the canonical "high-res" size used by .desktop files; smaller
// sizes are used by taskbars, window switchers, etc.
//
// The background color is configurable — we emit multiple variants so users
// can match their desktop wallpaper. The dark variant is also copied to the
// canonical `specforge.png` used by electron-builder and the default
// `.desktop` Icon= field.
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
const OUT_DIR = resolve(ROOT, "build/icons");

// Sizes required by Freedesktop hicolor theme for app icons.
const SIZES = [512, 256, 128, 64, 32];

// Background color variants. Each variant defines:
//   bg      — background fill (hex)
//   bracket — angle bracket stroke color (must contrast with bg)
//   dots    — optional override for the 4 dot fills; defaults to the original
//             bright palette (tuned for dark backgrounds)
//
// To add a new variant: append an entry here and re-run `pnpm gen:icons`.
const DEFAULT_DOTS = {
  cyan: "#22d3ee",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
};

const VARIANTS = [
  {
    name: "dark",
    bg: "#0b0e14",
    bracket: "#f1f5f9",
    dots: DEFAULT_DOTS,
    canonical: true,
  },
  {
    name: "light",
    bg: "#f8fafc",
    bracket: "#0f172a",
    dots: {
      cyan: "#0891b2",
      indigo: "#4f46e5",
      emerald: "#059669",
      amber: "#d97706",
    },
  },
  {
    name: "indigo",
    bg: "#1e1b4b",
    bracket: "#e0e7ff",
    dots: DEFAULT_DOTS,
  },
  {
    name: "emerald",
    bg: "#022c22",
    bracket: "#d1fae5",
    dots: DEFAULT_DOTS,
  },
  {
    name: "rose",
    bg: "#4c0519",
    bracket: "#ffe4e6",
    dots: DEFAULT_DOTS,
  },
  {
    name: "slate",
    bg: "#1e293b",
    bracket: "#f1f5f9",
    dots: DEFAULT_DOTS,
  },
  {
    name: "amber",
    bg: "#451a03",
    bracket: "#fef3c7",
    dots: DEFAULT_DOTS,
  },
];

function renderSvg(variant) {
  const d = variant.dots ?? DEFAULT_DOTS;
  return `<svg width="512" height="512" title="SpecForge" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="96" fill="${variant.bg}" />
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

    // Canonical 512 for this variant
    const canonPath = resolve(variantDir, `specforge-${variant.name}.png`);
    await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(canonPath);
    console.log(`✓ [${variant.name}] ${canonPath}`);

    // The "canonical" variant also gets the top-level specforge.png used by
    // electron-builder and the default .desktop Icon= field.
    if (variant.canonical) {
      const topPath = resolve(OUT_DIR, "specforge.png");
      await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(topPath);
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
