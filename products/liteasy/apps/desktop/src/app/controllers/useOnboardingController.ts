import { useEffect, useRef, useState } from "react";
import { createOnboardingLayout, onboardingSteps, onboardingStorageKey, type OnboardingModel } from "../features/onboarding/onboarding";
import type { useDockLayout } from "../features/dock/useDockLayout";
import type { DockItemId, DockRegionId } from "../features/dock/dock.types";

export function useOnboardingController(input: {
  dock: Pick<ReturnType<typeof useDockLayout>, "layout" | "replaceLayout">;
  resetPaneSizes(): void;
  restoreVisibility(value: { collapsed: { left: boolean; right: boolean; bottom: boolean }; hiddenRegions: DockRegionId[] }): void;
  activate(region: DockRegionId, item: DockItemId): void;
  open(item: DockItemId): void;
  openManual(article: string): void;
  leaveFocus(): void;
  closeBoard(): void;
}): OnboardingModel {
  const latest = useRef(input); latest.current = input;
  const [invitation, setInvitation] = useState(() => {
    try { return !localStorage.getItem(onboardingStorageKey); } catch { return true; }
  });
  const [index, setIndex] = useState<number | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const [background, setBackground] = useState(false);
  const [error, setError] = useState("");
  function remember(status: "dismissed" | "started" | "completed") {
    setInvitation(false);
    try { localStorage.setItem(onboardingStorageKey, JSON.stringify({ version: 1, status })); } catch { /* Guide remains usable without persistence. */ }
  }
  function go(next: number) {
    const step = onboardingSteps[next];
    if (!step) return;
    if (step.article) latest.current.openManual(step.article);
    else if (step.page) latest.current.open(step.page);
    setIndex(next);
  }
  function close(completed = false) { remember(completed ? "completed" : "dismissed"); setAutomatic(false); setIndex(null); }
  function next() { if (index === onboardingSteps.length - 1) close(true); else if (index !== null) go(index + 1); }
  const advance = useRef(next); advance.current = next;
  useEffect(() => {
    const changed = () => setBackground(document.hidden);
    const blurred = () => setBackground(true);
    changed(); document.addEventListener("visibilitychange", changed);
    window.addEventListener("blur", blurred); window.addEventListener("focus", changed);
    return () => { document.removeEventListener("visibilitychange", changed); window.removeEventListener("blur", blurred); window.removeEventListener("focus", changed); };
  }, []);
  useEffect(() => {
    if (index === null || !automatic || background || index === onboardingSteps.length - 1) return;
    const timer = window.setTimeout(() => advance.current(), 12000);
    return () => window.clearTimeout(timer);
  }, [index, automatic, background]);
  function start() {
    setError(""); setAutomatic(false);
    try {
      const current = latest.current;
      current.leaveFocus(); current.closeBoard();
      current.dock.replaceLayout(createOnboardingLayout(current.dock.layout));
      current.resetPaneSizes();
      current.restoreVisibility({ collapsed: { left: false, right: false, bottom: false },
        hiddenRegions: Object.keys(current.dock.layout.regions).filter(id => !["left", "main", "right", "bottom"].includes(id)) as DockRegionId[] });
      for (const [region, item] of [["left", "library"], ["right", "assistant"], ["bottom", "workflow-runs"], ["main", "help"]] as const) current.activate(region, item);
      current.openManual("getting-started.basics");
      remember("started"); setIndex(0);
    } catch { setError("暂时无法准备导览布局，请重试。已打开的资料仍然保留。"); }
  }
  return { invitation, index, automatic, background, error, start, next, previous: () => { if (index !== null && index > 0) go(index - 1); },
    close, dismissInvitation: () => { remember("dismissed"); setError(""); }, toggleAutomatic: () => setAutomatic(value => !value) };
}
