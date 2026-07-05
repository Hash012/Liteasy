export type DockRegionId = "left" | "main" | "right" | "bottom";

export type DockItemId =
  | "library"
  | "organization"
  | "profile"
  | "settings"
  | "reader"
  | "assistant"
  | "artifacts";

export type DockItemDescriptor = {
  allowedRegions: DockRegionId[];
  id: DockItemId;
  preferredRegion: DockRegionId;
  title: string;
};

export type DockRegionLayout = {
  activeItemId: DockItemId | null;
  itemIds: DockItemId[];
};

export type DockLayout = {
  regions: Record<DockRegionId, DockRegionLayout>;
  version: 1;
};
