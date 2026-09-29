import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
export interface FileStatus {
  recommendation?: import("../recommendations/recommendation.types").RecommendationItem;
  entry?: ReadingCatalogEntry;
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  pageCount?: number;
  itemCount?: number;
  modifiedAt?: Date;
  source?: "local" | "cloud" | "remote";
  syncState?: "synced" | "syncing" | "error";
  indexState?: "indexed" | "indexing" | "not-indexed" | "error";
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon?: "search" | "layout" | "settings";
  priority?: number;
  checked?: boolean;
  onSelect?: () => void;
  children?: ToolbarAction[];
}

export interface WorkspaceToolbarState {
  title?: string;
  breadcrumb?: { id: string; label: string }[];
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onOpenPageHistory?: () => void;
  actions?: ToolbarAction[];
  overflowActions?: ToolbarAction[];
}

/** A projection of an existing dock surface; it owns no page or pane state. */
export interface WorkspaceSurface {
  id: string;
  region: string;
  active: boolean;
  dynamic?: boolean;
  pageKey?: string;
  pageType?: string;
  pageTarget?: import("./pageHistory").WorkspacePageTarget;
  title: string;
  fileStatus?: FileStatus;
  search?: "library" | "notes" | "pdf" | "reading-catalog" | "reading-document";
  onActivate: () => void;
}

export interface WindowControlsState {
  available: boolean;
  maximized: boolean;
  error: string;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}
