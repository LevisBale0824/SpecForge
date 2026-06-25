import { computed, ref, watch } from "vue";
import { DEFAULT_THEME_ID, SYSTEM_MODE_PAIRS, getThemeById, themes, type Theme } from "../themes";
import { StorageKeys, storageGet, storageSet } from "../utils/storageKeys";

// Module-level singletons — theme must persist across the app and survive HMR.
const currentThemeId = ref<string>(resolveInitialTheme());
const followSystem = ref<boolean>(resolveInitialFollowSystem());
const systemPrefersDark = ref<boolean>(resolveSystemPrefersDark());

function resolveInitialTheme(): string {
  const stored = storageGet(StorageKeys.ui.theme);
  if (stored && getThemeById(stored)) return stored;
  return DEFAULT_THEME_ID;
}

function resolveInitialFollowSystem(): boolean {
  return storageGet(StorageKeys.ui.followSystemTheme) === "1";
}

function resolveSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Wire up the media query listener once at module load.
if (typeof window !== "undefined" && window.matchMedia) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  // addEventListener is the modern API; older Safari uses addListener.
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", (e) => {
      systemPrefersDark.value = e.matches;
    });
  } else if (typeof mql.addListener === "function") {
    mql.addListener((e) => {
      systemPrefersDark.value = e.matches;
    });
  }
}

function writeThemeToDom(theme: Theme): void {
  const root = document.documentElement;
  const colorEntries = Object.entries(theme.colors) as [string, string][];
  for (const [key, value] of colorEntries) {
    root.style.setProperty(key, value);
  }
  const syntaxEntries = Object.entries(theme.syntaxTokens) as [string, string][];
  for (const [key, value] of syntaxEntries) {
    root.style.setProperty(key, value);
  }
  root.style.colorScheme = theme.mode;
}

/**
 * The theme id that actually gets applied to the DOM. When `followSystem` is
 * on, we flip between a theme and its light/dark counterpart from
 * SYSTEM_MODE_PAIRS based on the OS preference.
 */
const resolvedThemeId = computed<string>(() => {
  if (!followSystem.value) return currentThemeId.value;
  const paired = SYSTEM_MODE_PAIRS[currentThemeId.value];
  if (!paired || !getThemeById(paired)) return currentThemeId.value;
  const currentTheme = getThemeById(currentThemeId.value);
  if (!currentTheme) return currentThemeId.value;
  const wantDark = systemPrefersDark.value;
  // Only flip when the current mode doesn't match the OS preference.
  const currentIsDark = currentTheme.mode === "dark";
  if (currentIsDark === wantDark) return currentThemeId.value;
  return paired;
});

/**
 * Apply a theme by id. Falls back to the default theme if the id is unknown.
 * Updates the DOM + persists to localStorage.
 */
export function applyTheme(themeId: string): void {
  const theme = getThemeById(themeId) ?? getThemeById(DEFAULT_THEME_ID);
  if (!theme) return;
  currentThemeId.value = themeId;
  storageSet(StorageKeys.ui.theme, theme.id);
  // resolvedThemeId watcher will handle DOM writes; but write now too so
  // initial application is synchronous (no flicker before watcher runs).
  writeThemeToDom(theme);
}

/**
 * Toggle "follow system dark/light" mode. When enabled, the resolved theme
 * tracks the OS preference and flips to the paired theme automatically.
 */
export function setFollowSystem(enabled: boolean): void {
  followSystem.value = enabled;
  storageSet(StorageKeys.ui.followSystemTheme, enabled ? "1" : "0");
}

/** Apply the persisted theme at app startup (before mount) to avoid flicker. */
export function initTheme(): void {
  const theme = getThemeById(resolvedThemeId.value) ?? getThemeById(DEFAULT_THEME_ID);
  if (theme) writeThemeToDom(theme);
}

// Re-apply to DOM whenever the resolved theme changes (covers user pick,
// follow-system toggle, and OS preference change).
watch(resolvedThemeId, (id) => {
  const theme = getThemeById(id) ?? getThemeById(DEFAULT_THEME_ID);
  if (theme) writeThemeToDom(theme);
});

export function useTheme() {
  return {
    currentThemeId,
    resolvedThemeId,
    themes,
    applyTheme,
    followSystem,
    setFollowSystem,
  };
}
