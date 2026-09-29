import type {
  CoreDockItemId,
  ExtensionDockItemId,
  DockItemDescriptor,
  DockItemId,
  DockRegionId,
} from "./dock.types";

const sideToolRegions: DockRegionId[] = ["left", "main", "right", "bottom"];

const coreDockItems: Record<CoreDockItemId, DockItemDescriptor> = {
  "workflow-runs": { allowedRegions: sideToolRegions, id: "workflow-runs", preferredRegion: "main", title: "运行记录" },
  "extension-library": { allowedRegions: sideToolRegions, id: "extension-library", preferredRegion: "main", title: "扩展" },
  "workflow-studio": { allowedRegions: sideToolRegions, id: "workflow-studio", preferredRegion: "main", title: "制作工作台" },
  "recommendation-reader": { allowedRegions: sideToolRegions, id: "recommendation-reader", preferredRegion: "main", title: "论文详情" },
  "paper-note": { allowedRegions: sideToolRegions, id: "paper-note", preferredRegion: "main", title: "论文笔记" },
  "note-file-reader": { allowedRegions: sideToolRegions, id: "note-file-reader", preferredRegion: "main", title: "Markdown" },
  "document-reader": {
    allowedRegions: sideToolRegions,
    id: "document-reader",
    preferredRegion: "main",
    title: "阅读器",
  },
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
    preferredRegion: "main",
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

const extensionItems = new Map<ExtensionDockItemId, DockItemDescriptor>();
export function isExtensionDockItemId(value: unknown): value is ExtensionDockItemId {
  return typeof value === "string" && value.length <= 300 && /^extension:plugin\.[a-z0-9][a-z0-9.-]*\/[a-zA-Z][a-zA-Z0-9.-]*\/[a-zA-Z0-9-]{1,80}$/.test(value);
}
export function registerExtensionDockItem(descriptor: DockItemDescriptor) {
  if (!isExtensionDockItemId(descriptor.id)) throw new Error("扩展页面标识无效。");
  const key = descriptor.id;
  if (extensionItems.has(key)) throw new Error("页面已注册。");
  extensionItems.set(key, descriptor);
  return () => { if (extensionItems.get(key) === descriptor) extensionItems.delete(key); };
}
// Valid missing extensions get a placeholder descriptor so layouts/history remain intact.
export const dockItemRegistry = new Proxy(coreDockItems as Record<DockItemId, DockItemDescriptor>, {
  get(target, key) {
    if (isExtensionDockItemId(key)) return extensionItems.get(key) ?? { id: key, title: "扩展页面", preferredRegion: "main", allowedRegions: sideToolRegions };
    return Reflect.get(target, key);
  },
  ownKeys(target) { return [...Reflect.ownKeys(target), ...extensionItems.keys()]; },
  getOwnPropertyDescriptor(target, key) { return isExtensionDockItemId(key) && extensionItems.has(key) ? { configurable: true, enumerable: true, value: extensionItems.get(key) } : Reflect.getOwnPropertyDescriptor(target, key); },
});

export const dockRegionLabels: Record<DockRegionId, string> = {
  bottom: "下栏",
  left: "左栏",
  main: "主内容区",
  right: "右栏",
};

export function isDockItemId(value: unknown): value is DockItemId {
  return isExtensionDockItemId(value) || (typeof value === "string" && Object.prototype.hasOwnProperty.call(coreDockItems, value));
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
