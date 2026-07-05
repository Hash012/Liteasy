import type {
  DockItemDescriptor,
  DockItemId,
  DockRegionId
} from "./dock.types";

const sideToolRegions: DockRegionId[] = ["left", "right", "bottom"];

export const dockItemRegistry: Record<DockItemId, DockItemDescriptor> = {
  library: {
    allowedRegions: sideToolRegions,
    id: "library",
    preferredRegion: "left",
    title: "文献库"
  },
  organization: {
    allowedRegions: sideToolRegions,
    id: "organization",
    preferredRegion: "left",
    title: "组织"
  },
  profile: {
    allowedRegions: sideToolRegions,
    id: "profile",
    preferredRegion: "left",
    title: "个人中心"
  },
  settings: {
    allowedRegions: sideToolRegions,
    id: "settings",
    preferredRegion: "left",
    title: "设置"
  },
  reader: {
    allowedRegions: ["main"],
    id: "reader",
    preferredRegion: "main",
    title: "Reader"
  },
  assistant: {
    allowedRegions: sideToolRegions,
    id: "assistant",
    preferredRegion: "right",
    title: "Liteasy Chat"
  },
  artifacts: {
    allowedRegions: ["main", "bottom"],
    id: "artifacts",
    preferredRegion: "bottom",
    title: "多模态产物"
  }
};

export const dockRegionLabels: Record<DockRegionId, string> = {
  bottom: "下栏",
  left: "左栏",
  main: "主内容区",
  right: "右栏"
};

export function isDockItemId(value: unknown): value is DockItemId {
  return typeof value === "string" && value in dockItemRegistry;
}

export function isDockRegionId(value: unknown): value is DockRegionId {
  return value === "left" || value === "main" || value === "right" || value === "bottom";
}
