import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { addCollection } from "@iconify/vue";
import { routes } from "./router";
import lucideSubset from "./icons/lucide-subset.json";
import { hydratePrefsFromMain } from "./utils/storageKeys";
import "./styles/tailwind.css";

// Pre-register the Lucide icons used in the UI so @iconify/vue never falls
// back to its network API. Without this, packaged Linux AppImage builds
// (offline / sandboxed / behind firewalls) render missing icons as "❓".
// To add new icons: append their name to scripts/gen-icon-subset.mjs and
// re-run `pnpm gen:icon-subset`.
addCollection(lucideSubset);

// CRITICAL: hydrate localStorage from the main-process specforge.config.json BEFORE
// pulling in any module that reads localStorage at import time. Specifically
// `./i18n`, `./composables/useTheme`, and `./App.vue` (which transitively
// imports `./backends/registry`) all read localStorage synchronously when
// their modules load. Importing them statically would hoist above this
// await and read stale/empty state.
//
// We therefore:
//   1. await hydration first (top-level await, ES2022 + Vite),
//   2. then dynamically import the storage-reading modules.
//
// In Browser mode (no electronAPI) hydrate is a no-op and existing
// localStorage values remain authoritative.
await hydratePrefsFromMain();

const [{ i18n }, { initTheme }, { default: App }] = await Promise.all([
  import("./i18n"),
  import("./composables/useTheme"),
  import("./App.vue"),
]);

// Apply persisted theme before mount to avoid the default-theme flash.
initTheme();

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

const app = createApp(App);
app.use(i18n);
app.use(router);

app.config.errorHandler = (err, instance, info) => {
  console.error("[Vue Error]", err, info);
  const el = document.getElementById("app");
  if (el) {
    el.innerHTML = `<pre style="color:#fb7185;padding:20px;font-size:14px;">Vue Error: ${err}\n${info}\n${err instanceof Error ? err.stack : ""}</pre>`;
  }
};

app.mount("#app");
