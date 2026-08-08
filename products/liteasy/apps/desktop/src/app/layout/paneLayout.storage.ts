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

function parsePaneLayout(value: unknown): PaneLayout | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("left" in value) ||
    typeof value.left !== "number" ||
    !("center" in value) ||
    typeof value.center !== "number" ||
    !("right" in value) ||
    typeof value.right !== "number"
  ) {
    return null;
  }

  return {
    bottom:
      "bottom" in value && typeof value.bottom === "number"
        ? value.bottom
        : defaultPaneLayout.bottom,
    center: value.center,
    left: value.left,
    right: value.right
  };
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

function normalizePaneCollapseState(value: PaneCollapseState): PaneCollapseState {
  return {
    bottom: typeof value.bottom === "boolean" ? value.bottom : defaultPaneCollapseState.bottom,
    left: value.left,
    right: value.right
  };
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

    const directLayout = parsePaneLayout(parsed);
    if (directLayout) {
      return {
        collapsed: defaultPaneCollapseState,
        layout: directLayout
      };
    }

    const nestedLayout =
      parsed && typeof parsed === "object" && "layout" in parsed
        ? parsePaneLayout(parsed.layout)
        : null;
    if (
      parsed &&
      typeof parsed === "object" &&
      "collapsed" in parsed &&
      nestedLayout &&
      isPaneCollapseState(parsed.collapsed)
    ) {
      return {
        collapsed: normalizePaneCollapseState(parsed.collapsed),
        layout: nestedLayout
      };
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
