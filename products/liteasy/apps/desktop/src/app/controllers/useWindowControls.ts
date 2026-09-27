import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowControls() {
  const available = isTauri();
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
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
    return () => { disposed = true; unlisten?.(); };
  }, [available]);

  async function run(action: "minimize" | "toggleMaximize" | "close") {
    if (!available) return;
    setError("");
    try {
      const window = getCurrentWindow();
      await window[action]();
      if (action === "toggleMaximize") setMaximized(await window.isMaximized());
    } catch {
      setError("窗口操作未完成，请重试。");
    }
  }
  return { available, maximized, error, minimize: () => void run("minimize"), toggleMaximize: () => void run("toggleMaximize"), close: () => void run("close") };
}
