export type DockBaseRegionId = "left" | "main" | "right" | "bottom";
export type DockRegionId = DockBaseRegionId | `bar-${string}`;

export type ExtensionDockItemId = `extension:plugin.${string}/${string}/${string}`;
export type DockItemId = CoreDockItemId | ExtensionDockItemId;
export type CoreDockItemId =
  | "workflow-runs" | "extension-library"
  | "workflow-studio"
  | "library"
  | "metadata-editor"
  | "document-reader"
  | "recommendation-reader"
  | "note-file-reader"
  | "paper-note"
  | "artifact-library"
  | "organization"
  | "profile"
  | "settings"
  | "assistant"
  | "help"
  | "notes"
  | "board"
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
  horizontalOrder: DockRegionId[];
  bottomOrder: DockRegionId[];
  regionWidths: Partial<Record<DockRegionId, number>>;
  version: 2;
};
