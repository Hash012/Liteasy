import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";
import type {
  SettingsState,
  UpdateSettingCommand,
} from "../features/settings/settings.types";
import {
  normalizeDisplayScale,
  normalizeViewFontSize,
  stepDisplayScale,
} from "../features/settings/viewSettings";
import "../features/settings/applicationView.css";

type ApplicationViewOptions = {
  settings: Pick<SettingsState, "view.display_scale" | "view.font_size">;
  onUpdateSetting: (command: UpdateSettingCommand) => void;
};

let nativeZoomQueue: Promise<void> = Promise.resolve();

function setNativeZoom(scale: number) {
  const next = nativeZoomQueue.then(() => getCurrentWebview().setZoom(scale));
  nativeZoomQueue = next.catch(() => {});
  return next;
}

export function useApplicationViewController({
  settings,
  onUpdateSetting,
}: ApplicationViewOptions) {
  const displayScale = normalizeDisplayScale(settings["view.display_scale"]);
  const fontSize = normalizeViewFontSize(settings["view.font_size"]);
  const scaleRef = useRef(displayScale);
  const updateRef = useRef(onUpdateSetting);
  updateRef.current = onUpdateSetting;

  useEffect(() => {
    const root = document.documentElement;
    const previousZoom = root.style.zoom;
    const previousScale = root.style.getPropertyValue("--app-display-scale");
    const previousFontRatio = root.style.getPropertyValue("--app-font-ratio");
    const previousFontSize = root.style.getPropertyValue("--app-font-size");
    const previousCssZoom = root.getAttribute("data-app-css-zoom");
    return () => {
      root.style.zoom = previousZoom;
      root.style.setProperty("--app-display-scale", previousScale);
      root.style.setProperty("--app-font-ratio", previousFontRatio);
      root.style.setProperty("--app-font-size", previousFontSize);
      if (previousCssZoom === null) root.removeAttribute("data-app-css-zoom");
      else root.setAttribute("data-app-css-zoom", previousCssZoom);
      if (isTauri()) void setNativeZoom(1).catch(() => {});
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-ratio",
      String(Number(fontSize) / 14),
    );
    document.documentElement.style.setProperty(
      "--app-font-size",
      `${fontSize}px`,
    );
  }, [fontSize]);

  useEffect(() => {
    scaleRef.current = displayScale;
    const root = document.documentElement;
    const scale = Number(displayScale) / 100;
    let active = true;
    const applyCssZoom = () => {
      if (!active) return;
      root.style.zoom = String(scale);
      root.style.setProperty("--app-display-scale", String(scale));
      root.setAttribute("data-app-css-zoom", "true");
      window.dispatchEvent(new Event("resize"));
    };
    if (isTauri()) {
      void setNativeZoom(scale)
        .then(() => {
          if (!active) return;
          root.style.zoom = "1";
          root.style.setProperty("--app-display-scale", "1");
          root.removeAttribute("data-app-css-zoom");
        })
        .catch(applyCssZoom);
    } else {
      applyCssZoom();
    }
    return () => {
      active = false;
    };
  }, [displayScale]);

  useEffect(() => {
    const handleZoom = (event: KeyboardEvent) => {
      if (
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.isComposing
      )
        return;
      const increase =
        event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
      const decrease =
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract";
      const reset = event.key === "0" || event.code === "Numpad0";
      if (!increase && !decrease && !reset) return;
      event.preventDefault();
      event.stopPropagation();
      const value = reset
        ? "100"
        : stepDisplayScale(scaleRef.current, increase ? 1 : -1);
      scaleRef.current = value;
      updateRef.current({
        intent: "update_setting",
        target: "view.display_scale",
        value,
      });
    };
    window.addEventListener("keydown", handleZoom, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleZoom, { capture: true });
  }, []);
}
