import type {
  DockItemDescriptor,
  DockItemId,
  DockRegionId,
} from "./dock.types";

const sideToolRegions: DockRegionId[] = ["left", "main", "right", "bottom"];

export const dockItemRegistry: Record<DockItemId, DockItemDescriptor> = {
  "artifact-library": {
    allowedRegions: sideToolRegions,
    id: "artifact-library",
    preferredRegion: "left",
    title: "产物库",
  },
  library: {
    allowedRegions: sideToolRegions,
    id: "library",
    preferredRegion: "left",
    title: "文献库",
  },
  organization: {
    allowedRegions: sideToolRegions,
    id: "organization",
    preferredRegion: "left",
    title: "组织",
  },
  profile: {
    allowedRegions: sideToolRegions,
    id: "profile",
    preferredRegion: "left",
    title: "个人中心",
  },
  settings: {
    allowedRegions: sideToolRegions,
    id: "settings",
    preferredRegion: "left",
    title: "设置",
  },
  assistant: {
    allowedRegions: sideToolRegions,
    id: "assistant",
    preferredRegion: "right",
    title: "Liteasy Chat",
  },
  help: {
    allowedRegions: ["main", "left", "right", "bottom"],
    id: "help",
    preferredRegion: "main",
    title: "帮助",
  },
  notes: {
    allowedRegions: sideToolRegions,
    id: "notes",
    preferredRegion: "left",
    title: "笔记",
  },
  board: {
    allowedRegions: sideToolRegions,
    id: "board",
    preferredRegion: "right",
    title: "研究白板",
  },
  artifacts: {
    allowedRegions: ["main", "bottom"],
    id: "artifacts",
    preferredRegion: "main",
    title: "多模态产物",
  },
};

export const dockRegionLabels: Record<DockRegionId, string> = {
  bottom: "下栏",
  left: "左栏",
  main: "主内容区",
  right: "右栏",
};

export function isDockItemId(value: unknown): value is DockItemId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(dockItemRegistry, value);
}

export function isDockRegionId(value: unknown): value is DockRegionId {
  return (
    isBaseDockRegionId(value) ||
    (typeof value === "string" && /^bar-[a-zA-Z0-9-]{1,80}$/.test(value))
  );
}

export function isBaseDockRegionId(
  value: unknown,
): value is import("./dock.types").DockBaseRegionId {
  return (
    value === "left" ||
    value === "main" ||
    value === "right" ||
    value === "bottom"
  );
}

export function canDockItemMoveTo(item: DockItemId, region: DockRegionId) {
  return (
    !isBaseDockRegionId(region) ||
    dockItemRegistry[item].allowedRegions.includes(region)
  );
}

export function dockRegionLabel(region: DockRegionId): string {
  return dockRegionLabels[region] ?? "分栏";
}
