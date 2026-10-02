import { useLayoutEffect, useRef, useState } from "react";
import type { DockRegionId } from "../features/dock/dock.types";

/** Close only panels emptied by an action; newly split or reopened panels stay usable. */
export function useEmptyDockRegionsController({ counts, bottomOrder, enabled, close }: {
  counts: Partial<Record<DockRegionId, number>>; bottomOrder: DockRegionId[];
  enabled: boolean; close(region: DockRegionId): void;
}) {
  const previous = useRef(counts);
  const previousInputs = useRef<{ counts: typeof counts; order: DockRegionId[]; enabled: boolean }>();
  const [hidden, setHidden] = useState<DockRegionId[]>([]);
  useLayoutEffect(() => {
    const last = previousInputs.current;
    // AppShell rebuilds these objects each render. Avoid scheduling even a no-op
    // layout update when panel contents did not change (including focus restoration).
    if (last && last.enabled === enabled && last.order.join("\n") === bottomOrder.join("\n")
      && Object.keys(last.counts).length === Object.keys(counts).length
      && Object.entries(counts).every(([id, count]) => last.counts[id as DockRegionId] === count)) return;
    previousInputs.current = { counts, order: bottomOrder, enabled };
    const before = previous.current;
    previous.current = counts;
    const emptied = enabled ? (Object.keys(counts) as DockRegionId[]).filter((id) => counts[id] === 0 && before[id]) : [];
    setHidden((current) => {
      const next = enabled ? [...new Set([...current.filter((id) => counts[id] === 0), ...emptied])] : [];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
    for (const region of emptied) {
      if (region === "main") continue;
      // Hiding a base bottom region must not hide siblings that still have tabs.
      if (region === "bottom" && bottomOrder.some((id) => counts[id])) continue;
      close(region);
    }
    if (enabled && bottomOrder.some((id) => before[id]) && bottomOrder.every((id) => !counts[id]) && !before.bottom) close("bottom");
  }, [counts, bottomOrder, enabled, close]);
  return { hidden: enabled ? hidden : [], reveal: (id: DockRegionId) => setHidden((current) => current.filter((value) => value !== id)) };
}
