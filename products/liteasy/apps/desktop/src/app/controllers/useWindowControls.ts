import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { flushPdfReaderPositions } from "../features/pdf/pdfReaderPersistence";

export function useWindowControls() {
  const available = isTauri();
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let closing = false;
    let revision = 0;
    const window = getCurrentWindow();
    const refresh = async () => {
      const request = ++revision;
      try {
        const value = await window.isMaximized();
        if (!disposed && request === revision) setMaximized(value);
      } catch { /* Controls remain available even if state cannot be read. */ }
    };
    void refresh();
    void window.onResized(() => { void refresh(); }).then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch(() => {});
    void window.onCloseRequested(async (event) => {
      if (closing) { event.preventDefault(); return; }
      closing = true;
      try {
        // Tauri awaits this handler before destroying the window (including Alt+F4).
        await flushPdfReaderPositions();
      } catch {
        event.preventDefault();
        if (!disposed) setError("阅读进度尚未保存，请检查存储空间后重试关闭。");
      } finally { closing = false; }
    }).then((cleanup) => {
      if (disposed) cleanup(); else unlistenClose = cleanup;
    }).catch(() => { if (!disposed) setError("退出保存未能就绪，请稍后重试。"); });
    return () => { disposed = true; unlisten?.(); unlistenClose?.(); };
  }, [available]);

  async function run(action: "minimize" | "toggleMaximize" | "close") {
    if (!available) return;
    setError("");
    try {
      const window = getCurrentWindow();
      if (action === "close") await flushPdfReaderPositions();
      await window[action]();
      if (action === "toggleMaximize") setMaximized(await window.isMaximized());
    } catch {
      setError("窗口操作未完成，请重试。");
    }
  }
  return { available, maximized, error, minimize: () => void run("minimize"), toggleMaximize: () => void run("toggleMaximize"), close: () => void run("close") };
}
