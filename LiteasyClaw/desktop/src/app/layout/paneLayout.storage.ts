import {
  defaultPaneCollapseState,
  defaultPaneLayout,
  type PaneCollapseState,
  type PaneLayout
} from "./paneLayout.types";

type PaneLayoutPreference = {
  collapsed: PaneCollapseState;
  layout: PaneLayout;
};

const storageKey = "liteasy.ui.pane-layout.v1";

function isPaneLayout(value: unknown): value is PaneLayout {
  return (
    typeof value === "object" &&
    value !== null &&
    "left" in value &&
    typeof value.left === "number" &&
    "center" in value &&
    typeof value.center === "number" &&
    "right" in value &&
    typeof value.right === "number"
  );
}

function isPaneCollapseState(value: unknown): value is PaneCollapseState {
  return (
    typeof value === "object" &&
    value !== null &&
    "left" in value &&
    typeof value.left === "boolean" &&
    "right" in value &&
    typeof value.right === "boolean"
  );
}

export function loadPaneLayoutPreference(): PaneLayoutPreference {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return {
      collapsed: defaultPaneCollapseState,
      layout: defaultPaneLayout
    };
  }

  try {
    const parsed = JSON.parse(raw);

    if (isPaneLayout(parsed)) {
      return {
        collapsed: defaultPaneCollapseState,
        layout: parsed
      };
    }

    if (parsed && isPaneLayout(parsed.layout) && isPaneCollapseState(parsed.collapsed)) {
      return parsed;
    }
  } catch {
    // Fall back to defaults when stored data is malformed.
  }

  return {
    collapsed: defaultPaneCollapseState,
    layout: defaultPaneLayout
  };
}

export function savePaneLayoutPreference(preference: PaneLayoutPreference) {
  window.localStorage.setItem(storageKey, JSON.stringify(preference));
}
