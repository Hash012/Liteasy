import { createDefaultDockLayout, normalizeDockLayout } from "./dockLayout";
import type { DockLayout } from "./dock.types";

const storageKey = "liteasy.ui.dock-layout.v1";

export function loadDockLayout(): DockLayout {
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return createDefaultDockLayout();
  }

  try {
    return normalizeDockLayout(JSON.parse(rawValue));
  } catch {
    return createDefaultDockLayout();
  }
}

export function saveDockLayout(layout: DockLayout) {
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

export function clearDockLayout() {
  window.localStorage.removeItem(storageKey);
}
