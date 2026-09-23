export interface FileStatus {
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
  actions?: ToolbarAction[];
  overflowActions?: ToolbarAction[];
}

/** A projection of an existing dock surface; it owns no page or pane state. */
export interface WorkspaceSurface {
  id: string;
  region: string;
  active: boolean;
  dynamic?: boolean;
  title: string;
  fileStatus?: FileStatus;
  search?: "library" | "notes" | "pdf" | "reading-catalog" | "reading-document";
  onActivate: () => void;
}
