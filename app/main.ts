import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { addCollection } from "@iconify/vue";
import { i18n } from "./i18n";
import App from "./App.vue";
import { routes } from "./router";
import { initTheme } from "./composables/useTheme";
import lucideSubset from "./icons/lucide-subset.json";
import "./styles/tailwind.css";

// Pre-register the Lucide icons used in the UI so @iconify/vue never falls
// back to its network API. Without this, packaged Linux AppImage builds
// (offline / sandboxed / behind firewalls) render missing icons as "❓".
// To add new icons: append their name to scripts/gen-icon-subset.mjs and
// re-run `pnpm gen:icon-subset`.
addCollection(lucideSubset);

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
