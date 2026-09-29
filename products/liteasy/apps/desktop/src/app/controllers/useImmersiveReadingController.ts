import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ReadingFocusMode = "off" | "reading" | "fullscreen";
export type ReadingFocusEdge = "top" | "left" | "right" | "bottom";

/** A temporary presentation layer: never rewrites the user's saved dock layout. */
export function useImmersiveReadingController() {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ReadingFocusMode>("off");
  const [edge, setEdge] = useState<ReadingFocusEdge>();
  const [error, setError] = useState("");
  const current = useRef(mode);
  const revealed = useRef(edge);
  const transition = useRef(0);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const previousFocus = useRef<HTMLElement | null>(null);
  const openingClick = useRef<{ time: number; x: number; y: number }>();

  const reveal = useCallback((next?: ReadingFocusEdge) => {
    clearTimeout(timer.current);
    revealed.current = next;
    setEdge(next);
  }, []);
  const update = useCallback((next: ReadingFocusMode) => {
    if (current.current === "off" && next !== "off") previousFocus.current = document.activeElement as HTMLElement | null;
    current.current = next;
    setMode(next);
    reveal();
    if (next !== "off") window.dispatchEvent(new Event("liteasy:immersive-reading-enter"));
    if (next === "off") previousFocus.current?.focus({ preventScroll: true });
    else root.current?.querySelector<HTMLElement>('[data-region="main"]')?.focus({ preventScroll: true });
  }, [reveal]);

  const setFullscreen = useCallback(async (value: boolean) => {
    if (isTauri()) await getCurrentWindow().setFullscreen(value);
    else if (value) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  }, []);
  const exit = useCallback(() => {
    const wasFullscreen = current.current === "fullscreen";
    ++transition.current;
    update("off");
    setError("");
    if (wasFullscreen) void setFullscreen(false).catch(() => {
      update("fullscreen"); reveal("top"); setError("未能退出全屏，请按 F11 或 Esc 重试。");
    });
  }, [reveal, setFullscreen, update]);
  const enter = useCallback(() => {
    if (current.current === "off") { setError(""); update("reading"); }
  }, [update]);
  const toggleFullscreen = useCallback(() => {
    if (current.current === "fullscreen") { exit(); return; }
    const request = ++transition.current;
    pending.current = true;
    setError("");
    update("fullscreen");
    // Invoke synchronously within the key/click gesture for browser permission.
    void setFullscreen(true).then(async () => {
      if (request !== transition.current && current.current !== "fullscreen") await setFullscreen(false);
    }).catch(() => {
      if (request === transition.current) {
        update("reading");
        setError("未能进入全屏，已保留沉浸阅读。可按 F11 重试，Esc 退出。");
      }
    }).finally(() => { if (request === transition.current || current.current === "off") pending.current = false; });
  }, [exit, setFullscreen, update]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key === "F11") {
        event.preventDefault(); event.stopPropagation(); toggleFullscreen();
      } else if (event.key === "Escape" && current.current !== "off") {
        // Give an open dialog/menu its own Escape before leaving reading.
        if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
        event.preventDefault(); event.stopPropagation(); exit();
      }
    };
    const fullscreenChanged = () => {
      if (!document.fullscreenElement && !pending.current && current.current === "fullscreen") update("off");
    };
    window.addEventListener("keydown", keydown, true);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      const host = getCurrentWindow();
      void host.onResized(async () => {
        const request = transition.current;
        try {
          const full = await host.isFullscreen();
          if (!disposed && request === transition.current && !pending.current && !full && current.current === "fullscreen") update("off");
        } catch { /* F11 / Escape remain usable if the host cannot report state. */ }
      }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(() => {});
    }
    return () => {
      disposed = true; unlisten?.(); clearTimeout(timer.current);
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
    };
  }, [exit, toggleFullscreen, update]);

  useEffect(() => {
    if (mode === "off") return;
    const hideLater = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // Keep interactive overlays usable, including Fluent menus rendered in portals.
        if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') ||
            document.activeElement?.matches("input, textarea, [contenteditable=true]")) return;
        reveal();
      }, 450);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons || !root.current) return;
      const box = root.current.getBoundingClientRect();
      const next = event.clientY <= box.top + 6 ? "top" : event.clientY >= box.bottom - 6 ? "bottom"
        : event.clientX <= box.left + 6 ? "left" : event.clientX >= box.right - 6 ? "right" : undefined;
      if (next) { reveal(next); return; }
      const target = event.target instanceof Element ? event.target : undefined;
      const overPanel = revealed.current === "top" ? target?.closest(".workspace-command-bar, .immersive-controls, [data-region=main] .dock-region-tab-row, .pdf-reader-top, .paper-reading-toolbar, .paper-resource-tab__header, .reading-document__toolbar, .reading-library-toolbar, .external-note-editor > header, .pdf-left-sidebar, .reading-document__sidebar, .paper-reading-comments, .paper-reading-navigation")
        : revealed.current === "left" ? target?.closest(".activity-bar, [data-region=left]")
        : revealed.current === "right" ? target?.closest("[data-region=right]")
        : revealed.current === "bottom" ? target?.closest(".dock-bottom-columns, .file-status-bar") : undefined;
      if (overPanel || target?.closest('[role="menu"], [role="dialog"], [role="listbox"]')) clearTimeout(timer.current);
      else hideLater();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", hideLater);
    return () => { clearTimeout(timer.current); document.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", hideLater); };
  }, [mode, reveal]);

  const onClickCapture = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) { openingClick.current = undefined; return; }
    const entry = event.target instanceof Element && event.target.closest('[data-reading-entry="true"]');
    if (event.detail === 2 && entry) {
      openingClick.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
      return;
    }
    const previous = openingClick.current;
    openingClick.current = undefined;
    // Opening a file on click two can disable/replace its row while loading.
    // Accept the third click at that same location even when the DOM changed.
    if (event.detail === 3 && (entry || (previous && event.timeStamp - previous.time < 650 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 12))) enter();
  };
  return { root, mode, active: mode !== "off", edge, error, enter, exit, toggleFullscreen, reveal, onClickCapture };
}
