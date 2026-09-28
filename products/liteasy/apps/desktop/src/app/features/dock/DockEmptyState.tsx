import { WorkbenchWelcome } from "../workbench/WorkbenchWelcome";

export function DockEmptyState({ showActions = false }: { showActions?: boolean }) {
  return (
    <div aria-label="空 Dock 区域" className="dock-empty-state">
      <WorkbenchWelcome compact={!showActions} />
    </div>
  );
}
