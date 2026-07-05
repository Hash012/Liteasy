import { useRef, useState } from "react";
import { loadPaneLayoutPreference, savePaneLayoutPreference } from "./paneLayout.storage";
import type { PaneCollapseState, PaneLayout } from "./paneLayout.types";

type PaneSide = keyof PaneCollapseState;

const minPaneRatio = 18;
const minCenterRatio = 40;

function normalizeLayout(next: PaneLayout): PaneLayout {
  let left = Math.max(minPaneRatio, next.left);
  let right = Math.max(minPaneRatio, next.right);
  let center = 100 - left - right;

  if (center < minCenterRatio) {
    const shortage = minCenterRatio - center;
    const leftReduction = Math.min(shortage / 2, left - minPaneRatio);
    const rightReduction = Math.min(shortage - leftReduction, right - minPaneRatio);

    left -= leftReduction;
    right -= rightReduction;
    center = 100 - left - right;
  }

  return {
    bottom: Number(Math.max(20, Math.min(55, next.bottom)).toFixed(2)),
    center: Number(center.toFixed(2)),
    left: Number(left.toFixed(2)),
    right: Number(right.toFixed(2))
  };
}

export function usePaneLayout() {
  const [preference, setPreference] = useState(loadPaneLayoutPreference);
  const preferenceRef = useRef(preference);

  function syncPreference(next: { collapsed: PaneCollapseState; layout: PaneLayout }) {
    preferenceRef.current = next;
    setPreference(next);
    savePaneLayoutPreference(next);
  }

  function setLayout(layout: PaneLayout) {
    syncPreference({
      ...preferenceRef.current,
      layout: normalizeLayout(layout)
    });
  }

  function setCollapsed(side: PaneSide, collapsed: boolean) {
    const current = preferenceRef.current;
    syncPreference({
      ...current,
      collapsed: {
        ...current.collapsed,
        [side]: collapsed
      }
    });
  }

  function adjustLeft(deltaPercent: number) {
    const current = preferenceRef.current;
    const nextLeft = current.layout.left + deltaPercent;
    const nextCenter = current.layout.center - deltaPercent;

    setLayout({
      ...current.layout,
      center: nextCenter,
      left: nextLeft
    });
  }

  function adjustRight(deltaPercent: number) {
    const current = preferenceRef.current;
    const nextRight = current.layout.right - deltaPercent;
    const nextCenter = current.layout.center + deltaPercent;

    setLayout({
      ...current.layout,
      center: nextCenter,
      right: nextRight
    });
  }

  function adjustBottom(deltaPercent: number) {
    const current = preferenceRef.current;
    setLayout({
      ...current.layout,
      bottom: current.layout.bottom + deltaPercent
    });
  }

  function resetLayout() {
    syncPreference(loadPaneLayoutPreference());
    syncPreference({
      collapsed: {
        bottom: true,
        left: false,
        right: false
      },
      layout: {
        bottom: 32,
        center: 52,
        left: 24,
        right: 24
      }
    });
  }

  return {
    adjustBottom,
    adjustLeft,
    adjustRight,
    collapsed: preference.collapsed,
    layout: preference.layout,
    resetLayout,
    setCollapsed,
    setLayout
  };
}
