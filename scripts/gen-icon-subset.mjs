// ---------------------------------------------------------------------------
// Generate an offline subset of Lucide icons used by @iconify/vue.
//
// @iconify/vue falls back to a network fetch (api.iconify.design) for any
// icon that hasn't been pre-registered via addIcon/addCollection. On packaged
// Linux AppImage builds (sandboxed / offline / behind corporate firewalls)
// that fetch silently fails and the icon renders as the "❓" fallback.
//
// This script reads the full @iconify-json/lucide collection, keeps only the
// icons listed in USED_ICONS, and writes a compact JSON bundle that the
// renderer imports at startup to call `addCollection()`.
//
// Usage:  pnpm gen:icon-subset
//
// When you add a new `lucide:*` icon in a .vue file, append its name to
// USED_ICONS and re-run this script.
// ---------------------------------------------------------------------------
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import lucide from "@iconify-json/lucide/icons.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "app/icons/lucide-subset.json");

// Keep this list in sync with every `icon="lucide:<name>"` / `icon: "lucide:<name>"`
// reference across app/**/*.vue and app/**/*.ts.
const USED_ICONS = [
  "info",
  "server-cog",
  "palette",
  "github",
  "tag",
  "circle-alert",
  "cloud-download",
  "rotate-cw",
  "power",
  "plug-zap",
  "key-round",
  "arrow-down",
];

function main() {
  const source =
    /** @type {{ prefix: string, icons: Record<string, unknown>, aliases?: Record<string, unknown> }} */ (
      lucide
    );
  const icons = {};
  const missing = [];

  for (const name of USED_ICONS) {
    if (source.icons[name]) {
      icons[name] = source.icons[name];
    } else if (source.aliases?.[name]) {
      icons[name] = source.aliases[name];
    } else {
      missing.push(name);
    }
  }

  if (missing.length) {
    throw new Error(`Missing icons in @iconify-json/lucide: ${missing.join(", ")}`);
  }

  const subset = {
    prefix: source.prefix,
    // Lucide ships a 24×24 viewBox. Without these, @iconify/vue falls back
    // to its default 16×16 viewport and paths designed for 24 get clipped
    // (icons visibly render as "only 3/4 shown").
    width: source.width ?? 24,
    height: source.height ?? 24,
    icons,
  };

  mkdir(dirname(OUT_PATH), { recursive: true });
  writeFile(OUT_PATH, JSON.stringify(subset), "utf-8");
  console.log(`✓ wrote ${OUT_PATH} (${USED_ICONS.length} icons)`);
}

main();
