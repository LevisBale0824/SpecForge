import { createI18n } from "vue-i18n";
import en from "../locales/en";
import zhCN from "../locales/zh-CN";
import { StorageKeys, storageGet } from "../utils/storageKeys";

export type Locale = "en" | "zh-CN";

function getStoredLocale(): Locale {
  // Must read through storageGet so it picks up the value hydrated from
  // specforge.config.json (see app/main.ts → hydratePrefsFromMain). The previous raw
  // key "openspec-locale" diverged from StorageKeys.ui.locale, so language
  // switches never survived a reload.
  const stored = storageGet(StorageKeys.ui.locale);
  if (stored === "en" || stored === "zh-CN") return stored;
  return navigator.language.startsWith("zh") ? "zh-CN" : "en";
}

export const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: "en",
  messages: {
    en,
    "zh-CN": zhCN,
  },
});
