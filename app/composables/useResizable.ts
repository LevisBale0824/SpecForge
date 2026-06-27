// Reusable drag-to-resize logic for panels that need user-adjustable size.
// One instance per panel — keeps the gesture state isolated. The composable
// exposes a single `start` callback to bind on pointerdown of a drag handle,
// plus reactive `size` and `isDragging` refs. Clamping happens on every move
// so the user never sees out-of-range sizes.
//
// Orientation:
//   - "horizontal": drag handle moves left/right, size = width (sidebar).
//   - "vertical":   drag handle moves up/down,   size = height (bottom panel).
//
// The size is also persisted to localStorage under `storageKey` when provided,
// so the layout survives reloads. Callers can pass `min`/`max`/`defaultSize`
// to tweak constraints per panel.

import { onUnmounted, ref, type Ref } from "vue";

export type ResizeOrientation = "horizontal" | "vertical";

export interface UseResizableOptions {
  orientation: ResizeOrientation;
  storageKey?: string;
  defaultSize: number;
  min: number;
  max: number;
  // When "vertical" with a max in pixels, the panel can outgrow small windows.
  // Set maxRatio (0..1) to clamp max by viewport height instead — e.g. 0.5
  // means "never taller than half the viewport".
  maxRatio?: number;
}

export function useResizable(options: UseResizableOptions): {
  size: Ref<number>;
  isDragging: Ref<boolean>;
  start: (e: PointerEvent) => void;
} {
  const { orientation, storageKey, defaultSize, min, max, maxRatio } = options;

  function resolveMax(): number {
    if (maxRatio && typeof window !== "undefined") {
      const viewport = orientation === "horizontal" ? window.innerWidth : window.innerHeight;
      return Math.max(min, Math.min(max, Math.floor(viewport * maxRatio)));
    }
    return max;
  }

  function loadInitial(): number {
    if (!storageKey) return defaultSize;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return defaultSize;
      const n = Number(raw);
      if (!Number.isFinite(n)) return defaultSize;
      return Math.max(min, Math.min(resolveMax(), n));
    } catch {
      return defaultSize;
    }
  }

  const size = ref<number>(loadInitial());
  const isDragging = ref(false);

  function persist() {
    if (!storageKey) return;
    // Window-local layout state — deliberately NOT routed through storageSet,
    // so it stays out of specforge.config.json. Per-window layouts shouldn't
    // sync across instances.
    try {
      localStorage.setItem(storageKey, String(size.value));
    } catch {
      /* quota — non-fatal */
    }
  }

  let startPos = 0;
  let startSize = 0;

  function onMove(e: PointerEvent) {
    const current = orientation === "horizontal" ? e.clientX : e.clientY;
    const delta = current - startPos;
    // For a left sidebar, dragging right grows width → size + delta.
    // For a bottom panel, dragging UP shrinks height → start - delta (because
    // moving up means clientY decreases, delta negative, and we want bigger).
    const next = orientation === "horizontal" ? startSize + delta : startSize - delta;
    const hi = resolveMax();
    size.value = Math.max(min, Math.min(hi, next));
  }

  function onUp() {
    isDragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("resize-active");
    delete document.body.dataset.resize;
    persist();
  }

  function start(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging.value = true;
    startPos = orientation === "horizontal" ? e.clientX : e.clientY;
    startSize = size.value;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Disable text selection + iframes' pointer capture while dragging so the
    // whole gesture goes to our move handler. The data-resize attribute lets
    // the global stylesheet set the right cursor (col/row-resize) for the
    // duration of the drag.
    document.body.classList.add("resize-active");
    document.body.dataset.resize = orientation;
  }

  onUnmounted(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("resize-active");
    delete document.body.dataset.resize;
  });

  return { size, isDragging, start };
}
