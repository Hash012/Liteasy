import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactElement,
  type ReactNode
} from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowClockwiseRegular,
  ArrowImportRegular,
  ArrowResetRegular,
  BookmarkRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteDismissRegular,
  DeleteRegular,
  DocumentPdfRegular,
  DocumentTextRegular,
  EditRegular,
  FolderAddRegular,
  FolderOpenRegular,
  FolderRegular,
  LightbulbRegular,
  LockClosedRegular,
  LockOpenRegular,
  OrganizationRegular,
  OpenRegular,
  DocumentArrowUpRegular,
  SearchRegular
} from "@fluentui/react-icons";
import type { ImportJob } from "../import/import.types";
import type { PaperResourceKind } from "../import/paperResource.types";
import type {
  RecommendationItem,
  RecommendationStatus
} from "../recommendations/recommendation.types";
import type { Paper, WorkspaceSourceType } from "../workspace/workspace.types";
import {
  createCloudLibraryStorageClient,
  type CloudLibraryEntry,
  type CloudLibraryFolder,
  type CloudLibraryScope,
  type CloudLibraryTree
} from "./cloudLibraryStorageClient";
import type { ExternalPdfDragPayload } from "./externalPdfDownload";
import {
  createLocalLibraryFolder,
  emptyLocalLibraryTrash,
  purgeLocalLibraryTrashItem,
  restoreLocalLibraryTrashItem,
  trashLocalLibraryResource,
  trashLocalMetadataEntry
} from "./libraryFileSystemClient";
import type {
  LibraryResourceArea,
  LibraryResourceEntrySource,
  LibraryResourceFolderOrigin,
  LibraryResourceFolderSource,
  LibraryResourceFolderTree,
  LibraryResourceTransferSource,
  LibraryResourceTransferTarget
} from "./libraryResourceTransfer.types";
import type {
  LocalLibraryEntry,
  LocalLibraryFolder,
  LocalLibrarySnapshot,
  LocalLibraryTrashEntry
} from "./localLibrary.types";
import { LibraryLocationPanel } from "./LibraryLocationPanel";
import {
  canExportFromOrganization,
  canManageOrganizationLibrary,
  canUploadToOrganization,
  type OrganizationStorageAccess
} from "../organization/organizationStoragePolicy";
import { useCloudLibraryTree } from "./useCloudLibraryTree";
import "./library.css";

export type LibraryPaperChildItem = {
  id: string;
  kind: "artifact" | "note" | PaperResourceKind;
  label: string;
  meta?: string;
};

type LibraryPaneProps = {
  accountScopeId?: string;
  accountSessionAvailable?: boolean;
  activePaperId?: string | null;
  canOpenOrganizationWorkspace: boolean;
  cloudEndpoint: string;
  cloudTreeRevision?: number;
  importJobs: Record<string, ImportJob>;
  localLibrarySnapshot: LocalLibrarySnapshot | null;
  localLibraryError?: string | null;
  loadLegacyLibraryRoots?: () => Promise<string[]>;
  organizationId?: string;
  organizationStorageAccess?: OrganizationStorageAccess;
  organizationWorkspaceLabel?: string;
  paperChildren?: Record<string, LibraryPaperChildItem[]>;
  papers: Paper[];
  recommendationItems: RecommendationItem[];
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  selectedPaperIds: string[];
  selectionLocked: boolean;
  workspaceLabel: string;
  workspaceSourceType: WorkspaceSourceType;
  onAddDroppedPdfFiles?: (files: File[], targetFolderPath?: string) => void | Promise<void>;
  onAddExternalPdf?: (item: ExternalPdfDragPayload) => void | Promise<void>;
  onClearRecommendations: () => void;
  onDismissRecommendation: (recommendation: RecommendationItem) => void;
  onImportSelectedSet: () => void;
  onImportZoteroDirectory?: (files: File[]) => string | Promise<string>;
  onLoginRequired?: () => void;
  onSelectLegacyLibraryRoot?: (legacyRootPath: string) => Promise<void>;
  onMoveFolder?: (folderPath: string, targetFolderPath: string) => Promise<string>;
  onMovePaper?: (paperId: string, targetFolderPath: string) => Promise<string>;
  onOpenCloudEntry?: (scope: CloudLibraryScope, entry: CloudLibraryEntry) => void | Promise<void>;
  onOpenOrganizationWorkspace: () => void;
  onOpenPaper?: (paperId: string) => void;
  onOpenPaperChild?: (item: LibraryPaperChildItem, paper: Paper) => void;
  onRefreshLocalLibrary?: () => Promise<void>;
  onRenameFolder?: (folderPath: string, requestedName: string) => Promise<string>;
  onRenamePaper?: (paperId: string, requestedName: string) => Promise<string>;
  onResourceTransfer?: (
    source: LibraryResourceTransferSource,
    target: LibraryResourceTransferTarget
  ) => void | Promise<void>;
  onReturnToLocalWorkspace: () => void;
  onToggleLock: () => void;
  onToggleSelection: (paperId: string) => void;
};

type ExplorerEntry = {
  bodyAvailable: boolean;
  id: string;
  label: string;
  source: LibraryResourceEntrySource;
};

type ExplorerFolder = {
  children: ExplorerFolder[];
  entries: ExplorerEntry[];
  id: string;
  label: string;
  localPath?: string;
  sourceFolder?: LibraryResourceFolderOrigin;
  virtual?: boolean;
};

type ExplorerTree = {
  entries: ExplorerEntry[];
  folders: ExplorerFolder[];
};

type CreateFolderTarget = {
  area: "local" | "collection" | "organization";
  parent?: ExplorerFolder;
};

const resourceTransferMimeType = "application/x-liteasy-library-resource-v2";
const sectionIds: LibraryResourceArea[] = ["local", "collection", "recommendation", "organization"];

export function personalLibraryScopeId(accountScopeId?: string) {
  if (!accountScopeId) return "";
  return accountScopeId.startsWith("user:") ? accountScopeId : `user:${accountScopeId}`;
}

function dirname(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "" : normalized.slice(0, separator);
}

function localExplorerTree(snapshot: LocalLibrarySnapshot | null): ExplorerTree {
  if (!snapshot) return { entries: [], folders: [] };
  const byPath = new Map<string, ExplorerFolder>();
  for (const folder of snapshot.folders) {
    byPath.set(folder.path, {
      children: [],
      entries: [],
      id: folder.path,
      label: folder.name,
      localPath: folder.path,
      sourceFolder: { area: "local", folder }
    });
  }
  const roots: ExplorerFolder[] = [];
  for (const folder of snapshot.folders) {
    const node = byPath.get(folder.path)!;
    const parent = folder.parentPath ? byPath.get(folder.parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rootEntries: ExplorerEntry[] = [];
  const metadataEntries: ExplorerEntry[] = [];
  for (const entry of snapshot.entries) {
    const explorerEntry: ExplorerEntry = {
      bodyAvailable: entry.path !== null,
      id: entry.id,
      label: entry.title,
      source: { area: "local", entry }
    };
    if (!entry.path) {
      metadataEntries.push(explorerEntry);
      continue;
    }
    const parent = byPath.get(dirname(entry.path));
    if (parent) parent.entries.push(explorerEntry);
    else rootEntries.push(explorerEntry);
  }
  if (metadataEntries.length > 0) {
    roots.unshift({
      children: [],
      entries: metadataEntries,
      id: "local-metadata-only",
      label: "仅元数据",
      virtual: true
    });
  }
  return sortTree({ entries: rootEntries, folders: roots });
}

function cloudExplorerTree(
  area: "collection" | "organization",
  scope: CloudLibraryScope,
  tree: CloudLibraryTree | null
): ExplorerTree {
  if (!tree) return { entries: [], folders: [] };
  const byId = new Map<string, ExplorerFolder>(tree.folders.map((folder) => [
    folder.folderId,
    {
      children: [],
      entries: [],
      id: folder.folderId,
      label: folder.name,
      sourceFolder: { area, folder, scope }
    }
  ]));
  const roots: ExplorerFolder[] = [];
  for (const folder of tree.folders) {
    const node = byId.get(folder.folderId)!;
    const parent = folder.parentFolderId ? byId.get(folder.parentFolderId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const rootEntries: ExplorerEntry[] = [];
  for (const entry of tree.entries) {
    const explorerEntry: ExplorerEntry = {
      bodyAvailable: entry.entryKind === "pdf",
      id: entry.documentId,
      label: entry.title,
      source: { area, entry, scope }
    };
    const parent = entry.folderId ? byId.get(entry.folderId) : undefined;
    if (parent) parent.entries.push(explorerEntry);
    else rootEntries.push(explorerEntry);
  }
  return sortTree({ entries: rootEntries, folders: roots });
}

function sortTree(tree: ExplorerTree): ExplorerTree {
  const sortFolders = (folders: ExplorerFolder[]): ExplorerFolder[] => folders
    .map((folder) => ({
      ...folder,
      children: sortFolders(folder.children),
      entries: [...folder.entries].sort((left, right) => left.label.localeCompare(right.label))
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return {
    entries: [...tree.entries].sort((left, right) => left.label.localeCompare(right.label)),
    folders: sortFolders(tree.folders)
  };
}

function filterTree(tree: ExplorerTree, query: string): ExplorerTree {
  if (!query) return tree;
  const filterFolders = (folders: ExplorerFolder[]): ExplorerFolder[] => folders.flatMap((folder) => {
    const children = filterFolders(folder.children);
    const entries = folder.entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query));
    return folder.label.toLocaleLowerCase().includes(query) || children.length > 0 || entries.length > 0
      ? [{ ...folder, children, entries }]
      : [];
  });
  return {
    entries: tree.entries.filter((entry) => entry.label.toLocaleLowerCase().includes(query)),
    folders: filterFolders(tree.folders)
  };
}

function readTransfer(event: ReactDragEvent): LibraryResourceTransferSource | null {
  const serialized = event.dataTransfer.getData(resourceTransferMimeType);
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as LibraryResourceTransferSource;
  } catch {
    return null;
  }
}

function folderTransferTree(folder: ExplorerFolder): LibraryResourceFolderTree {
  return {
    children: folder.children.map(folderTransferTree),
    entries: folder.entries.map((entry) => entry.source),
    name: folder.label
  };
}

function folderTransferSource(folder: ExplorerFolder): LibraryResourceFolderSource | null {
  return folder.sourceFolder
    ? { ...folder.sourceFolder, tree: folderTransferTree(folder) } as LibraryResourceFolderSource
    : null;
}

function SectionHeader(props: {
  actions?: ReactNode;
  count: number;
  expanded: boolean;
  icon: ReactNode;
  onToggle: () => void;
  title: string;
}) {
  return (
    <div className="library-section-header-row">
      <button
        aria-label={`${props.expanded ? "收起" : "展开"}${props.title}`}
        aria-expanded={props.expanded}
        className="library-section-header"
        onClick={props.onToggle}
        type="button"
      >
        <span aria-hidden="true" className="library-section-disclosure">
          {props.expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </span>
        <span aria-hidden="true" className="library-section-icon">{props.icon}</span>
        <span className="library-section-title">{props.title}</span>
        <span className="library-section-count">{props.count}</span>
      </button>
      {props.actions ? <div className="library-section-actions">{props.actions}</div> : null}
    </div>
  );
}

export function LibraryPane({
  accountScopeId,
  accountSessionAvailable = false,
  activePaperId,
  cloudEndpoint,
  cloudTreeRevision,
  localLibrarySnapshot,
  localLibraryError,
  loadLegacyLibraryRoots,
  onAddDroppedPdfFiles,
  onClearRecommendations,
  onDismissRecommendation,
  onImportSelectedSet,
  onImportZoteroDirectory,
  onLoginRequired,
  onSelectLegacyLibraryRoot,
  onMoveFolder,
  onMovePaper,
  onOpenCloudEntry,
  onOpenPaper,
  onRefreshLocalLibrary,
  onRenameFolder,
  onRenamePaper,
  onResourceTransfer,
  onToggleLock,
  onToggleSelection,
  organizationId,
  organizationStorageAccess,
  organizationWorkspaceLabel = "组织文献库",
  recommendationItems,
  recommendationMessage,
  recommendationPending,
  recommendationStatus,
  selectedPaperIds,
  selectionLocked
}: LibraryPaneProps) {
  const collectionScope = useMemo<CloudLibraryScope>(() => ({
    scopeId: personalLibraryScopeId(accountScopeId),
    scopeType: "user"
  }), [accountScopeId]);
  const organizationScope = useMemo<CloudLibraryScope | undefined>(() => organizationId
    ? { scopeId: organizationId, scopeType: "organization" }
    : undefined, [organizationId]);
  const collection = useCloudLibraryTree({
    enabled: accountSessionAvailable && Boolean(collectionScope.scopeId),
    endpoint: cloudEndpoint,
    refreshKey: cloudTreeRevision,
    scopeId: collectionScope.scopeId,
    scopeType: "user"
  });
  const organization = useCloudLibraryTree({
    enabled: accountSessionAvailable && Boolean(organizationScope),
    endpoint: cloudEndpoint,
    refreshKey: cloudTreeRevision,
    scopeId: organizationScope?.scopeId,
    scopeType: "organization"
  });
  const [collapsedSections, setCollapsedSections] = useState<LibraryResourceArea[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<LibraryResourceArea, string[]>>({
    collection: [],
    local: [],
    organization: [],
    recommendation: []
  });
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [createFolderTarget, setCreateFolderTarget] = useState<CreateFolderTarget | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderDialogError, setFolderDialogError] = useState("");
  const [folderDialogPending, setFolderDialogPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localImportTargetPathRef = useRef<string | undefined>(undefined);
  const zoteroDirectoryInputRef = useRef<HTMLInputElement | null>(null);
  const attachPdfInputRef = useRef<HTMLInputElement | null>(null);
  const [attachTarget, setAttachTarget] = useState<{
    area: "collection" | "organization";
    entry: CloudLibraryEntry;
    scope: CloudLibraryScope;
  } | null>(null);
  const [pendingNodeIds, setPendingNodeIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Record<
    "local" | "collection" | "organization",
    string | null
  >>({ collection: null, local: null, organization: null });
  const query = search.trim().toLocaleLowerCase();
  const localTree = useMemo(
    () => filterTree(localExplorerTree(localLibrarySnapshot), query),
    [localLibrarySnapshot, query]
  );
  const collectionTree = useMemo(
    () => filterTree(cloudExplorerTree("collection", collectionScope, collection.tree), query),
    [collection.tree, collectionScope, query]
  );
  const organizationTree = useMemo(
    () => filterTree(organizationScope
      ? cloudExplorerTree("organization", organizationScope, organization.tree)
      : { entries: [], folders: [] }, query),
    [organization.tree, organizationScope, query]
  );

  useEffect(() => {
    const read = (key: string) => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    setExpandedFolders((current) => ({
      ...current,
      collection: read(`liteasy.library.expanded.collection.v1:${accountScopeId ?? "guest"}`),
      local: read(`liteasy.library.expanded.local.v1:${localLibrarySnapshot?.libraryId ?? "none"}`),
      organization: read(`liteasy.library.expanded.organization.v1:${accountScopeId ?? "guest"}:${organizationId ?? "none"}`)
    }));
    setSelectedFolderIds({ collection: null, local: null, organization: null });
  }, [accountScopeId, localLibrarySnapshot?.libraryId, organizationId]);

  function expandedStorageKey(area: LibraryResourceArea) {
    if (area === "local") {
      return `liteasy.library.expanded.local.v1:${localLibrarySnapshot?.libraryId ?? "none"}`;
    }
    if (area === "collection") {
      return `liteasy.library.expanded.collection.v1:${accountScopeId ?? "guest"}`;
    }
    if (area === "organization") {
      return `liteasy.library.expanded.organization.v1:${accountScopeId ?? "guest"}:${organizationId ?? "none"}`;
    }
    return null;
  }

  function toggleFolder(area: LibraryResourceArea, id: string) {
    const current = expandedFolders[area];
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setExpandedFolders((state) => ({ ...state, [area]: next }));
    const storageKey = expandedStorageKey(area);
    if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function toggleSection(area: LibraryResourceArea) {
    setCollapsedSections((current) => current.includes(area)
      ? current.filter((item) => item !== area)
      : [...current, area]);
  }

  function selectFolder(
    area: "local" | "collection" | "organization",
    folderId: string | null
  ) {
    setSelectedFolderIds((current) => ({
      ...current,
      [area]: current[area] === folderId ? null : folderId
    }));
  }

  function openLocalPdfPicker() {
    const selectedPath = selectedFolderIds.local;
    localImportTargetPathRef.current = selectedPath && localLibrarySnapshot?.folders.some(
      (folder) => folder.path === selectedPath
    )
      ? selectedPath
      : localLibrarySnapshot?.rootPath;
    fileInputRef.current?.click();
  }

  async function transfer(source: LibraryResourceTransferSource, target: LibraryResourceTransferTarget) {
    try {
      await onResourceTransfer?.(source, target);
      setMessage("资源已复制到目标位置。");
      await Promise.all([collection.refresh(), organization.refresh()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "资源操作失败。");
    }
  }

  async function saveRecommendation(recommendation: RecommendationItem) {
    if (pendingNodeIds.includes(recommendation.id)) return;
    setPendingNodeIds((current) => [...current, recommendation.id]);
    try {
      await transfer({ area: "recommendation", recommendation }, targetFor("collection"));
    } finally {
      setPendingNodeIds((current) => current.filter((id) => id !== recommendation.id));
    }
  }

  async function runNodeAction(nodeId: string, pendingMessage: string, action: () => Promise<void>) {
    if (pendingNodeIds.includes(nodeId)) return;
    setPendingNodeIds((current) => [...current, nodeId]);
    setMessage(pendingMessage);
    try {
      await action();
      setMessage("操作已完成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "资源操作失败，原有内容未改变。");
    } finally {
      setPendingNodeIds((current) => current.filter((id) => id !== nodeId));
    }
  }

  function cloudRevision(area: "collection" | "organization") {
    return area === "collection" ? collection.tree?.revision ?? 0 : organization.tree?.revision ?? 0;
  }

  async function trashEntry(area: "local" | "collection" | "organization", entry: ExplorerEntry) {
    if (entry.source.area === "local") {
      if (entry.source.entry.path) await trashLocalLibraryResource(entry.source.entry.path);
      else await trashLocalMetadataEntry(entry.source.entry.id);
      await onRefreshLocalLibrary?.();
      return;
    }
    const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
    await client.trashDocument(
      entry.source.scope,
      entry.source.entry.documentId,
      cloudRevision(entry.source.area)
    );
    await (entry.source.area === "collection" ? collection.refresh() : organization.refresh());
  }

  async function renameEntry(area: "local" | "collection" | "organization", entry: ExplorerEntry) {
    const requested = window.prompt("文献名称", entry.label)?.trim();
    if (!requested || requested === entry.label) return;
    if (entry.source.area === "local") {
      if (!onRenamePaper) throw new Error("当前本地文献无法重命名。");
      setMessage(await onRenamePaper(entry.source.entry.id, requested));
      await onRefreshLocalLibrary?.();
      return;
    }
    const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
    await client.updateDocument(entry.source.scope, entry.source.entry.documentId, {
      expectedRevision: cloudRevision(entry.source.area),
      ...(entry.source.entry.entryKind === "pdf" ? { fileName: `${requested}.pdf` } : {}),
      title: requested
    });
    await (entry.source.area === "collection" ? collection.refresh() : organization.refresh());
  }

  async function renameFolder(area: "local" | "collection" | "organization", folder: ExplorerFolder) {
    if (folder.virtual) return;
    const requested = window.prompt("目录名称", folder.label)?.trim();
    if (!requested || requested === folder.label) return;
    if (area === "local") {
      if (!folder.localPath || !onRenameFolder) throw new Error("当前本地目录无法重命名。");
      setMessage(await onRenameFolder(folder.localPath, requested));
      await onRefreshLocalLibrary?.();
      return;
    }
    if (!folder.sourceFolder || folder.sourceFolder.area === "local") return;
    const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
    await client.updateFolder(folder.sourceFolder.scope, folder.sourceFolder.folder.folderId, {
      expectedRevision: cloudRevision(area),
      name: requested
    });
    await (area === "collection" ? collection.refresh() : organization.refresh());
  }

  async function trashFolder(area: "local" | "collection" | "organization", folder: ExplorerFolder) {
    if (folder.virtual) return;
    if (area === "local") {
      if (!folder.localPath) return;
      await trashLocalLibraryResource(folder.localPath);
      await onRefreshLocalLibrary?.();
      return;
    }
    if (!folder.sourceFolder || folder.sourceFolder.area === "local") return;
    const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
    await client.trashFolder(folder.sourceFolder.scope, folder.sourceFolder.folder.folderId, cloudRevision(area));
    await (area === "collection" ? collection.refresh() : organization.refresh());
  }

  function targetFor(area: Exclude<LibraryResourceArea, "recommendation">, folder?: ExplorerFolder) {
    if (area === "local") {
      return {
        area,
        localFolderPath: folder?.localPath ?? localLibrarySnapshot?.rootPath
      } satisfies LibraryResourceTransferTarget;
    }
    return {
      area,
      expectedRevision: area === "collection"
        ? collection.tree?.revision
        : organization.tree?.revision,
      folderId: folder?.id,
      scope: area === "collection" ? collectionScope : organizationScope
    } satisfies LibraryResourceTransferTarget;
  }

  function transferPermissionMessage(
    source: LibraryResourceTransferSource,
    target: LibraryResourceTransferTarget
  ) {
    const sourceOrganizationId = source.area === "organization"
      ? source.scope.scopeId
      : undefined;
    const targetOrganizationId = target.area === "organization"
      ? target.scope?.scopeId
      : undefined;
    const sameOrganization = Boolean(
      sourceOrganizationId && sourceOrganizationId === targetOrganizationId
    );
    if (sourceOrganizationId) {
      if (!organizationStorageAccess || organizationId !== sourceOrganizationId) {
        return "组织权限状态不可用，请刷新组织空间后重试。";
      }
      if (sameOrganization && !canManageOrganizationLibrary(organizationStorageAccess.role)) {
        return "当前组织角色不能移动组织文献库内容。";
      }
      if (!sameOrganization && !canExportFromOrganization(organizationStorageAccess)) {
        return "当前组织策略不允许将文献复制出组织库。";
      }
    }
    if (targetOrganizationId && !sameOrganization) {
      if (!organizationStorageAccess || organizationId !== targetOrganizationId) {
        return "组织权限状态不可用，请刷新组织空间后重试。";
      }
      if (!canUploadToOrganization(organizationStorageAccess)) {
        return "当前组织策略不允许向组织文献库新增内容。";
      }
    }
    return "";
  }

  function canStartResourceDrag(source: LibraryResourceTransferSource) {
    if (source.area !== "organization") return true;
    return Boolean(
      organizationStorageAccess &&
      organizationId === source.scope.scopeId &&
      (
        canManageOrganizationLibrary(organizationStorageAccess.role) ||
        canExportFromOrganization(organizationStorageAccess)
      )
    );
  }

  function dropOnTarget(
    event: ReactDragEvent,
    area: Exclude<LibraryResourceArea, "recommendation">,
    folder?: ExplorerFolder
  ) {
    event.preventDefault();
    event.stopPropagation();
    const source = readTransfer(event);
    if (source) {
      const target = targetFor(area, folder);
      const permissionMessage = transferPermissionMessage(source, target);
      if (permissionMessage) {
        setMessage(permissionMessage);
        return;
      }
      if ("folder" in source) {
        if (source.area === "local" && area === "local") {
          const targetPath = folder?.localPath ?? localLibrarySnapshot?.rootPath;
          if (targetPath && source.folder.path !== targetPath) {
            void onMoveFolder?.(source.folder.path, targetPath).then(setMessage);
          }
          return;
        }
        void transfer(source, target);
        return;
      }
      if (source.area === "local" && area === "local" && source.entry.path) {
        const targetPath = folder?.localPath ?? localLibrarySnapshot?.rootPath;
        if (targetPath) {
          void onMovePaper?.(source.entry.id, targetPath).then(setMessage);
        }
        return;
      }
      void transfer(source, target);
      return;
    }
    if (area === "local") {
      const files = Array.from(event.dataTransfer.files ?? []).filter((file) =>
        file.name.toLocaleLowerCase().endsWith(".pdf")
      );
      if (files.length > 0) {
        void Promise.resolve(onAddDroppedPdfFiles?.(
          files,
          folder?.localPath ?? localLibrarySnapshot?.rootPath
        )).then(() => onRefreshLocalLibrary?.());
      }
    }
  }

  function renderEntry(area: "local" | "collection" | "organization", entry: ExplorerEntry, depth: number) {
    const selected = area === "local" && selectedPaperIds.includes(entry.id);
    const pending = pendingNodeIds.includes(entry.id);
    const canAttachPdf = entry.source.area !== "local" &&
      entry.source.entry.entryKind === "metadata_only" &&
      (entry.source.area !== "organization" || Boolean(
        organizationStorageAccess && canUploadToOrganization(organizationStorageAccess)
      ));
    const canManageEntry = area !== "organization" || Boolean(
      organizationStorageAccess && canManageOrganizationLibrary(organizationStorageAccess.role)
    );
    const openEntry = () => {
      if (entry.source.area === "local") onOpenPaper?.(entry.id);
      else void onOpenCloudEntry?.(entry.source.scope, entry.source.entry);
    };
    const row = (
      <div
        aria-busy={pending}
        className="library-paper-row"
        draggable={!pending && canStartResourceDrag(entry.source)}
        onDragStart={(event) => {
          if (!canStartResourceDrag(entry.source)) {
            event.preventDefault();
            setMessage("当前组织策略不允许移动或复制该内容。");
            return;
          }
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(resourceTransferMimeType, JSON.stringify(entry.source));
        }}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {area === "local" ? (
          <input
            aria-label={`选择 ${entry.label}`}
            checked={selected}
            disabled={selectionLocked}
            onChange={() => onToggleSelection(entry.id)}
            type="checkbox"
          />
        ) : <span className="library-disclosure-spacer" />}
        <span aria-hidden="true" className="library-paper-icon">
          {entry.bodyAvailable ? <DocumentPdfRegular /> : <DocumentTextRegular />}
        </span>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <button
              className="library-paper-title"
              disabled={pending}
              title={entry.bodyAvailable ? entry.label : `${entry.label}（仅元数据）`}
              type="button"
            >
              {entry.label}
            </button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                disabled={!entry.bodyAvailable || pending}
                icon={<OpenRegular />}
                onClick={openEntry}
              >打开</MenuItem>
              <MenuItem
                disabled={pending || !canManageEntry}
                icon={<EditRegular />}
                onClick={() => void runNodeAction(entry.id, "正在重命名文献...", () => renameEntry(area, entry))}
              >重命名</MenuItem>
              {canAttachPdf ? (
                <MenuItem
                  disabled={pending}
                  icon={<DocumentArrowUpRegular />}
                  onClick={() => {
                    if (entry.source.area === "collection" || entry.source.area === "organization") {
                      setAttachTarget({ area: entry.source.area, entry: entry.source.entry, scope: entry.source.scope });
                      attachPdfInputRef.current?.click();
                    }
                  }}
                >补充正文</MenuItem>
              ) : null}
              <MenuItem
                disabled={pending || !canManageEntry}
                icon={<DeleteRegular />}
                onClick={() => void runNodeAction(entry.id, "正在移到回收站...", () => trashEntry(area, entry))}
              >移到回收站</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        {!entry.bodyAvailable ? <span className="library-entry-status">仅元数据</span> : null}
      </div>
    );
    return (
      <li className={`library-paper-node${activePaperId === entry.id ? " active" : ""}`} key={entry.id}>
        {row}
      </li>
    );
  }

  function renderFolder(
    area: "local" | "collection" | "organization",
    folder: ExplorerFolder,
    depth: number
  ) {
    const expanded = query.length > 0 || expandedFolders[area].includes(folder.id);
    const selected = !folder.virtual && selectedFolderIds[area] === folder.id;
    const pending = pendingNodeIds.includes(folder.id);
    const canManageFolder = area !== "organization" || Boolean(
      organizationStorageAccess && canManageOrganizationLibrary(organizationStorageAccess.role)
    );
    const folderSource = folder.sourceFolder ? folderTransferSource(folder) : null;
    const row = (
      <div
        aria-busy={pending}
        className={`library-folder-row${selected ? " is-selected" : ""}`}
        draggable={Boolean(
          !pending && !folder.virtual && folderSource && canStartResourceDrag(folderSource)
        )}
        onDragStart={folder.sourceFolder ? (event) => {
          const source = folderSource;
          if (!source) return;
          if (!canStartResourceDrag(source)) {
            event.preventDefault();
            setMessage("当前组织策略不允许移动或复制该目录。");
            return;
          }
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(resourceTransferMimeType, JSON.stringify(source));
        } : undefined}
        onDragOver={folder.virtual ? undefined : (event) => event.preventDefault()}
        onDrop={folder.virtual ? undefined : (event) => dropOnTarget(event, area, folder)}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}${folder.label}`}
          className="library-disclosure"
          onClick={() => toggleFolder(area, folder.id)}
          type="button"
        >
          {expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        </button>
        <button
          aria-pressed={folder.virtual ? undefined : selected}
          className="library-folder-name"
          onClick={() => folder.virtual
            ? toggleFolder(area, folder.id)
            : selectFolder(area, folder.id)}
          type="button"
        >
          <FolderRegular aria-hidden="true" />
          <span>{folder.label}</span>
        </button>
      </div>
    );
    return (
      <li className="library-folder-node" key={folder.id}>
        {folder.virtual ? row : (
          <Menu openOnContext>
            <MenuTrigger disableButtonEnhancement>{row}</MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  disabled={pending || !canManageFolder}
                  icon={<FolderAddRegular />}
                  onClick={() => openCreateFolderDialog(area, folder)}
                >新建子目录</MenuItem>
                <MenuItem
                  disabled={pending || !canManageFolder}
                  icon={<EditRegular />}
                  onClick={() => void runNodeAction(folder.id, "正在重命名目录...", () => renameFolder(area, folder))}
                >重命名</MenuItem>
                <MenuItem
                  disabled={pending || !canManageFolder}
                  icon={<DeleteRegular />}
                  onClick={() => void runNodeAction(folder.id, "正在将目录移到回收站...", () => trashFolder(area, folder))}
                >移到回收站</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
        {expanded ? (
          <ul className="library-tree-children">
            {folder.children.map((child) => renderFolder(area, child, depth + 1))}
            {folder.entries.map((entry) => renderEntry(area, entry, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  function renderTree(
    area: "local" | "collection" | "organization",
    tree: ExplorerTree,
    empty: string
  ) {
    return (
      <div
        className="library-tree-drop-root"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropOnTarget(event, area)}
      >
        {tree.folders.length > 0 || tree.entries.length > 0 ? (
          <ul className="library-resource-tree">
            {tree.folders.map((folder) => renderFolder(area, folder, 0))}
            {tree.entries.map((entry) => renderEntry(area, entry, 0))}
          </ul>
        ) : <div className="library-empty-collection">{empty}</div>}
      </div>
    );
  }

  function openCreateFolderDialog(
    area: "local" | "collection" | "organization",
    parent?: ExplorerFolder
  ) {
    setFolderName("");
    setFolderDialogError("");
    setCreateFolderTarget({ area, parent });
  }

  async function createFolder(target: CreateFolderTarget, name: string) {
    const { area, parent } = target;
    try {
      if (area === "local") {
        await createLocalLibraryFolder(name, parent?.localPath);
        try {
          await onRefreshLocalLibrary?.();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          setMessage(`目录已创建，但列表刷新失败：${reason}`);
          return;
        }
      } else {
        const scope = area === "collection" ? collectionScope : organizationScope;
        if (!scope) throw new Error("当前文献库尚未准备完成。");
        const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
        const parentFolderId = parent?.sourceFolder && parent.sourceFolder.area !== "local"
          ? parent.sourceFolder.folder.folderId
          : undefined;
        await client.createFolder(
          scope,
          name,
          parentFolderId,
          area === "collection"
            ? collection.tree?.revision ?? 0
            : organization.tree?.revision ?? 0
        );
        await (area === "collection" ? collection.refresh() : organization.refresh());
      }
      if (parent) {
        setExpandedFolders((current) => ({
          ...current,
          [area]: current[area].includes(parent.id)
            ? current[area]
            : [...current[area], parent.id]
        }));
      }
      setMessage(parent ? `已在“${parent.label}”中新建目录“${name}”。` : `已新建目录“${name}”。`);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async function submitCreateFolder() {
    const target = createFolderTarget;
    const name = folderName.trim();
    if (!target || !name || folderDialogPending) return;
    setFolderDialogPending(true);
    setFolderDialogError("");
    try {
      await createFolder(target, name);
      setCreateFolderTarget(null);
      setFolderName("");
    } catch (error) {
      setFolderDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setFolderDialogPending(false);
    }
  }

  function iconAction(label: string, icon: ReactElement, action: () => void, disabled = false) {
    return (
      <Tooltip content={label} relationship="label">
        <Button
          appearance="subtle"
          aria-label={label}
          disabled={disabled}
          icon={icon}
          onClick={action}
          size="small"
        />
      </Tooltip>
    );
  }

  const localCount = localLibrarySnapshot?.entries.length ?? 0;
  const legacyLibrarySelectionRequired = localLibraryError?.startsWith(
    "检测到多个旧账号本地库"
  ) ?? false;
  const collectionCount = collection.tree?.entries.length ?? 0;
  const organizationCount = organization.tree?.entries.length ?? 0;

  return (
    <div className="library-pane">
      <div className="library-toolbar">
        <Input
          aria-label="搜索文献资源"
          className="library-search-input"
          contentBefore={<SearchRegular aria-hidden="true" />}
          onChange={(_, data) => setSearch(data.value)}
          placeholder="搜索文献"
          size="small"
          value={search}
        />
        {iconAction(
          selectionLocked ? "解除选中文献集锁定" : "锁定选中文献集",
          selectionLocked ? <LockClosedRegular /> : <LockOpenRegular />,
          onToggleLock
        )}
        {iconAction("导入选中文献", <ArrowImportRegular />, onImportSelectedSet)}
      </div>
      {message ? <div aria-live="polite" className="library-resource-action-message">{message}</div> : null}

      <section aria-label="本地文献库" className="library-section">
        <SectionHeader
          actions={<>
            {iconAction("新建本地目录", <FolderAddRegular />, () => openCreateFolderDialog("local"), !localLibrarySnapshot)}
            {iconAction("导入 PDF", <AddRegular />, openLocalPdfPicker, !localLibrarySnapshot)}
            {iconAction("从 Zotero 导出目录导入 PDF", <FolderOpenRegular />, () => zoteroDirectoryInputRef.current?.click(), !localLibrarySnapshot)}
            {iconAction("刷新本地文献库", <ArrowClockwiseRegular />, () => void onRefreshLocalLibrary?.())}
          </>}
          count={localCount}
          expanded={!collapsedSections.includes("local")}
          icon={<FolderRegular />}
          onToggle={() => toggleSection("local")}
          title="本地文献库"
        />
        <input
          accept=".pdf,application/pdf"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            setMessage(`正在导入 ${files.length} 个 PDF...`);
            const targetFolderPath = localImportTargetPathRef.current ?? localLibrarySnapshot?.rootPath;
            localImportTargetPathRef.current = undefined;
            void Promise.resolve(onAddDroppedPdfFiles?.(files, targetFolderPath))
              .then(async () => {
                await onRefreshLocalLibrary?.();
                setMessage(`已导入 ${files.length} 个 PDF。`);
              })
              .catch((error) => {
                setMessage(error instanceof Error
                  ? error.message
                  : typeof error === "string" ? error : "PDF 导入失败，本地文献库未更改。");
              });
          }}
          ref={fileInputRef}
          type="file"
        />
        <input
          accept=".pdf,application/pdf"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setMessage("正在检查 Zotero 导出目录...");
            void Promise.resolve(onImportZoteroDirectory?.(files))
              .then((nextMessage) => {
                setMessage(nextMessage ?? "Zotero PDF 导入已完成。");
                return onRefreshLocalLibrary?.();
              })
              .catch((error) => setMessage(error instanceof Error ? error.message : "Zotero PDF 导入失败。"));
            event.target.value = "";
          }}
          ref={(node) => {
            zoteroDirectoryInputRef.current = node;
            node?.setAttribute("webkitdirectory", "");
          }}
          type="file"
        />
        <input
          accept=".pdf,application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            const target = attachTarget;
            event.target.value = "";
            if (!file || !target) return;
            setAttachTarget(null);
            void runNodeAction(target.entry.documentId, "正在校验并上传 PDF 正文...", async () => {
              const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
              await client.attachMetadataEntryPdf({
                documentId: target.entry.documentId,
                expectedRevision: cloudRevision(target.area),
                file,
                scope: target.scope
              });
              await (target.area === "collection" ? collection.refresh() : organization.refresh());
            });
          }}
          ref={attachPdfInputRef}
          type="file"
        />
        {!collapsedSections.includes("local") ? (
          <div className="library-section-content">
            {legacyLibrarySelectionRequired && loadLegacyLibraryRoots && onSelectLegacyLibraryRoot ? (
              <LibraryLocationPanel
                loadLegacyRoots={loadLegacyLibraryRoots}
                onSelectLegacyRoot={onSelectLegacyLibraryRoot}
                rootPath={null}
              />
            ) : localLibraryError ? (
              <ErrorState
                message="本地文献库暂时无法加载。"
                onRetry={() => void onRefreshLocalLibrary?.()}
              />
            ) : (
              <>
                {renderTree("local", localTree, query ? "没有匹配的本地文献" : "本地文献库为空")}
                <TrashGroup
                  entries={localLibrarySnapshot?.trashEntries ?? []}
                  onEmpty={async () => {
                    await emptyLocalLibraryTrash();
                    await onRefreshLocalLibrary?.();
                  }}
                  onPurge={async (entry) => {
                    await purgeLocalLibraryTrashItem(entry.trashId);
                    await onRefreshLocalLibrary?.();
                  }}
                  onRestore={async (entry) => {
                    await restoreLocalLibraryTrashItem(entry.trashId);
                    await onRefreshLocalLibrary?.();
                  }}
                />
              </>
            )}
          </div>
        ) : null}
      </section>

      <section aria-label="收藏" className="library-section">
        <SectionHeader
          actions={<>
            {iconAction("新建收藏目录", <FolderAddRegular />, () => openCreateFolderDialog("collection"), !accountSessionAvailable)}
            {iconAction("刷新收藏", <ArrowClockwiseRegular />, () => void collection.refresh(), !accountSessionAvailable)}
          </>}
          count={collectionCount}
          expanded={!collapsedSections.includes("collection")}
          icon={<BookmarkRegular />}
          onToggle={() => toggleSection("collection")}
          title="收藏"
        />
        {!collapsedSections.includes("collection") ? (
          <div className="library-section-content">
            {!accountSessionAvailable ? (
              <button className="library-inline-button" onClick={onLoginRequired} type="button">登录</button>
            ) : collection.status === "error" ? (
              <ErrorState message={collection.message} onRetry={() => void collection.refresh()} />
            ) : collection.status === "loading" ? (
              <div className="library-empty-collection">加载中…</div>
            ) : renderTree("collection", collectionTree, query ? "没有匹配的收藏" : "收藏为空")}
            {accountSessionAvailable && collection.trashTree ? (
              <CloudTrashGroup
                endpoint={cloudEndpoint}
                onRefresh={collection.refresh}
                scope={collectionScope}
                tree={collection.trashTree}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-label="关联推荐" className="library-section">
        <SectionHeader
          actions={iconAction("清除推荐缓存", <DeleteDismissRegular />, onClearRecommendations, !accountSessionAvailable)}
          count={recommendationItems.length}
          expanded={!collapsedSections.includes("recommendation")}
          icon={<LightbulbRegular />}
          onToggle={() => toggleSection("recommendation")}
          title="关联推荐"
        />
        {!collapsedSections.includes("recommendation") ? (
          <div className="library-section-content">
            {!accountSessionAvailable ? (
              <button className="library-inline-button" onClick={onLoginRequired} type="button">登录</button>
            ) : recommendationPending ? (
              <div className="library-empty-collection">加载中…</div>
            ) : recommendationItems.length === 0 ? (
              <div className="library-empty-collection">{recommendationMessage || "暂无关联推荐"}</div>
            ) : (
              <ul className="library-resource-tree">
                {recommendationItems.map((recommendation) => (
                  <li className="library-recommendation-item" draggable key={recommendation.id} onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(resourceTransferMimeType, JSON.stringify({
                      area: "recommendation",
                      recommendation
                    } satisfies LibraryResourceTransferSource));
                  }}>
                    <div className="library-paper-row">
                      <LightbulbRegular aria-hidden="true" />
                      <span className="library-paper-title">{recommendation.title}</span>
                      <Tooltip content="收藏" relationship="label"><Button appearance="subtle" aria-label={`收藏 ${recommendation.title}`} disabled={!collection.tree || pendingNodeIds.includes(recommendation.id)} icon={<BookmarkRegular />} onClick={() => void saveRecommendation(recommendation)} size="small" /></Tooltip>
                      <Tooltip content="不感兴趣" relationship="label"><Button appearance="subtle" aria-label={`忽略 ${recommendation.title}`} icon={<DeleteRegular />} onClick={() => onDismissRecommendation(recommendation)} size="small" /></Tooltip>
                    </div>
                    <div className="library-recommendation-reason">{recommendation.reason}</div>
                  </li>
                ))}
              </ul>
            )}
            {recommendationStatus === "error" ? <ErrorState message={recommendationMessage} /> : null}
          </div>
        ) : null}
      </section>

      <section aria-label="组织文献库" className="library-section">
        <SectionHeader
          actions={<>
            {iconAction(
              "新建组织目录",
              <FolderAddRegular />,
              () => openCreateFolderDialog("organization"),
              !organizationScope || !organizationStorageAccess ||
                !canUploadToOrganization(organizationStorageAccess)
            )}
            {iconAction("刷新组织文献库", <ArrowClockwiseRegular />, () => void organization.refresh(), !organizationScope)}
          </>}
          count={organizationCount}
          expanded={!collapsedSections.includes("organization")}
          icon={<OrganizationRegular />}
          onToggle={() => toggleSection("organization")}
          title={organizationWorkspaceLabel}
        />
        {!collapsedSections.includes("organization") ? (
          <div className="library-section-content">
            {!accountSessionAvailable ? (
              <button className="library-inline-button" onClick={onLoginRequired} type="button">登录</button>
            ) : !organizationScope ? (
              <div className="library-empty-collection">尚未加入组织</div>
            ) : organization.status === "error" ? (
              <ErrorState message={organization.message} onRetry={() => void organization.refresh()} />
            ) : organization.status === "loading" ? (
              <div className="library-empty-collection">加载中…</div>
            ) : renderTree("organization", organizationTree, query ? "没有匹配的组织文献" : "组织文献库为空")}
            {organizationScope && organization.trashTree && organizationStorageAccess &&
              canManageOrganizationLibrary(organizationStorageAccess.role) ? (
              <CloudTrashGroup
                endpoint={cloudEndpoint}
                onRefresh={organization.refresh}
                scope={organizationScope}
                tree={organization.trashTree}
              />
            ) : null}
          </div>
        ) : null}
      </section>
      <Dialog
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open && !folderDialogPending) setCreateFolderTarget(null);
        }}
        open={createFolderTarget !== null}
      >
        <DialogSurface aria-label="新建目录">
          <form onSubmit={(event) => {
            event.preventDefault();
            void submitCreateFolder();
          }}>
            <DialogBody>
              <DialogTitle>{createFolderTarget?.parent ? "新建子目录" : "新建目录"}</DialogTitle>
              <DialogContent>
                <Input
                  aria-label="目录名称"
                  autoFocus
                  disabled={folderDialogPending}
                  onChange={(_, data) => setFolderName(data.value)}
                  placeholder="输入目录名称"
                  value={folderName}
                />
                {folderDialogError ? <div className="library-error-state" role="alert">{folderDialogError}</div> : null}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  disabled={folderDialogPending}
                  onClick={() => setCreateFolderTarget(null)}
                  type="button"
                >取消</Button>
                <Button
                  appearance="primary"
                  disabled={folderDialogPending || folderName.trim().length === 0}
                  type="submit"
                >创建</Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="library-error-state" role="alert">
      <span>{props.message}</span>
      {props.onRetry ? <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={props.onRetry} size="small">重试</Button> : null}
    </div>
  );
}

function TrashGroup(props: {
  entries: LocalLibraryTrashEntry[];
  onEmpty: () => Promise<void>;
  onPurge: (entry: LocalLibraryTrashEntry) => Promise<void>;
  onRestore: (entry: LocalLibraryTrashEntry) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (props.entries.length === 0) return null;
  return (
    <div className="library-trash-group">
      <div className="library-folder-row">
        <button aria-expanded={expanded} className="library-disclosure" onClick={() => setExpanded(!expanded)} type="button">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</button>
        <button className="library-folder-name" onClick={() => setExpanded(!expanded)} type="button"><DeleteRegular /><span>回收站</span></button>
        <Tooltip content="清空回收站" relationship="label"><Button appearance="subtle" aria-label="清空本地回收站" icon={<DeleteDismissRegular />} onClick={() => void props.onEmpty()} size="small" /></Tooltip>
      </div>
      {expanded ? <ul className="library-resource-tree">{props.entries.map((entry) => (
        <li className="library-paper-row" key={entry.trashId}>
          <DocumentTextRegular aria-hidden="true" />
          <span className="library-paper-title">{entry.name}</span>
          <span className="library-entry-status">
            {formatByteLength(entry.byteLength)} · {formatPurgeTime(entry.purgeAfter)}到期
          </span>
          <Tooltip content="恢复" relationship="label"><Button appearance="subtle" aria-label={`恢复 ${entry.name}`} icon={<ArrowResetRegular />} onClick={() => void props.onRestore(entry)} size="small" /></Tooltip>
          <Tooltip content="永久删除" relationship="label"><Button appearance="subtle" aria-label={`永久删除 ${entry.name}`} icon={<DeleteDismissRegular />} onClick={() => void props.onPurge(entry)} size="small" /></Tooltip>
        </li>
      ))}</ul> : null}
    </div>
  );
}

function formatByteLength(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatPurgeTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })
    .format(new Date(timestamp * 1000));
}

function CloudTrashGroup(props: {
  endpoint: string;
  onRefresh: () => Promise<void>;
  scope: CloudLibraryScope;
  tree: CloudLibraryTree;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = props.tree.entries.length + props.tree.folders.length;
  if (count === 0) return null;
  const client = createCloudLibraryStorageClient({ endpoint: props.endpoint });
  const restoreFolder = async (folder: CloudLibraryFolder) => {
    await client.restoreFolder(props.scope, folder.folderId, props.tree.revision);
    await props.onRefresh();
  };
  const purgeFolder = async (folder: CloudLibraryFolder) => {
    await client.purgeFolder(props.scope, folder.folderId, props.tree.revision);
    await props.onRefresh();
  };
  return (
    <div className="library-trash-group">
      <div className="library-folder-row">
        <button aria-expanded={expanded} className="library-disclosure" onClick={() => setExpanded(!expanded)} type="button">{expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</button>
        <button className="library-folder-name" onClick={() => setExpanded(!expanded)} type="button"><DeleteRegular /><span>回收站</span></button>
        <Tooltip content="清空回收站" relationship="label"><Button appearance="subtle" aria-label="清空云端回收站" icon={<DeleteDismissRegular />} onClick={() => void client.emptyTrash(props.scope, props.tree.revision).then(props.onRefresh)} size="small" /></Tooltip>
      </div>
      {expanded ? <ul className="library-resource-tree">
        {props.tree.folders.filter((folder) => !folder.parentFolderId).map((folder) => (
          <li className="library-paper-row" key={folder.folderId}><FolderRegular /><span className="library-paper-title">{folder.name}</span><Button appearance="subtle" aria-label={`恢复 ${folder.name}`} icon={<ArrowResetRegular />} onClick={() => void restoreFolder(folder)} size="small" /><Button appearance="subtle" aria-label={`永久删除 ${folder.name}`} icon={<DeleteDismissRegular />} onClick={() => void purgeFolder(folder)} size="small" /></li>
        ))}
        {props.tree.entries.map((entry) => (
          <li className="library-paper-row" key={entry.documentId}><DocumentTextRegular /><span className="library-paper-title">{entry.title}</span><Button appearance="subtle" aria-label={`恢复 ${entry.title}`} icon={<ArrowResetRegular />} onClick={() => void client.restoreDocument(props.scope, entry.documentId, props.tree.revision).then(props.onRefresh)} size="small" /><Button appearance="subtle" aria-label={`永久删除 ${entry.title}`} icon={<DeleteDismissRegular />} onClick={() => void client.purgeEntry(props.scope, entry.documentId, props.tree.revision).then(props.onRefresh)} size="small" /></li>
        ))}
      </ul> : null}
    </div>
  );
}
