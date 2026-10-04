import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { compileSearchQuery } from "../search/searchQuery";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { ExtensionActions } from "../extensions/ExtensionActions";
import { RecommendationList } from "../recommendations/RecommendationList";
import { LibraryIconProvider, LibraryIconMenuItem, LibraryItemIcon, useLibraryIcons } from "./LibraryItemIcon";
import { libraryFileDragType, libraryFolderKey, normalizedLibraryPath, relativeLibraryFolder } from "./libraryFolderMembership";
import { buildMovedFolderPath, buildRenamedFolderPath } from "../workspace/workspacePathOperations";
import { indexReadingCatalog, queryReadingCatalog, type ReadingCatalogFilters } from "./readingCatalogSearch";
import { readingCatalogFormatLabels, readingCatalogStatusLabels } from "./readingCatalog.types";
import { LibraryTagChips } from "./LibraryTagChips";
import { LibraryMetadataEditor } from "./LibraryMetadataEditor";
import { LibraryFacetFilters } from "./LibraryFacetFilters";
import { inferAssetType, type LibraryTag } from "./libraryAssetMetadata";
import type { ReadingCatalogEntry, ReadingCatalogMetadataPatch } from "./readingCatalog.types";
import { LibraryFileList, type LibraryFileAccess } from "./LibraryFileList";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { ResourceLocationButton } from "../resource-filesystem/ResourceLocationButton";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
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
  Field, Popover, PopoverSurface, PopoverTrigger,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Textarea,
  Tooltip
} from "@fluentui/react-components";
import {
  AddRegular,
  FilterRegular,
  ArrowClockwiseRegular,
  ArrowResetRegular,
  BookmarkRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteDismissRegular,
  DeleteRegular,
  DocumentPdfRegular,
  DocumentArrowDownRegular,
  DocumentTextRegular,
  EditRegular,
  FolderAddRegular,
  FolderOpenRegular,
  FolderRegular,
  LightbulbRegular,
  OrganizationRegular,
  OpenRegular,
  DocumentArrowUpRegular,
  SearchRegular,
  TagRegular
} from "@fluentui/react-icons";
import type { ImportJob } from "../import/import.types";
import type { PaperResourceKind } from "../import/paperResource.types";
import type {
  RecommendationItem,
  RecommendationStatus,
  RecommendationStyle
} from "../recommendations/recommendation.types";
import { RecommendationStyleControl } from "../recommendations/RecommendationStyleControl";
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
import { getAccountSessionGeneration } from "../account/accountSessionStorage";
import { planLibraryResourceTransfer, type LibraryResourceTransferPlan } from "./libraryResourceTransferPlan";
import "./library.css";
import type { LiteratureHydrationState } from "../paper-identity/literature.types";
import {
  loadPaperFileMetadata,
  normalizePaperFileMetadata,
  savePaperFileMetadata,
  type PaperFileMetadata
} from "./paperFileMetadata";

export type LibraryPaperChildItem = {
  id: string;
  kind: "artifact" | "note" | "board" | PaperResourceKind;
  objectId?: string;
  label: string;
  meta?: string;
};

type LibraryPaneProps = {
  expanded?: boolean;
  onCloseExpanded?: () => void;
  fileLibrary?: LibraryFileAccess;
  accountScopeId?: string;
  contextScopeId?: string;
  localRecommendations?: boolean;
  accountSessionAvailable?: boolean;
  activePaperId?: string | null;
  canOpenOrganizationWorkspace: boolean;
  cloudEndpoint: string;
  cloudTreeRevision?: number;
  importJobs: Record<string, ImportJob>;
  localLibrarySnapshot: LocalLibrarySnapshot | null;
  literatureHydration?: LiteratureHydrationState;
  localLibraryError?: string | null;
  loadLegacyLibraryRoots?: () => Promise<string[]>;
  organizationId?: string;
  organizationStorageAccess?: OrganizationStorageAccess;
  organizationWorkspaceLabel?: string;
  paperChildren?: Record<string, LibraryPaperChildItem[]>;
  papers: Paper[];
  recommendationService?: PaperServiceConfig;
  recommendationItems: RecommendationItem[];
  selectedRecommendationId?: string;
  onInspectRecommendation?: (item: RecommendationItem) => void;
  onOpenRecommendation?: (item: RecommendationItem) => void;
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  recommendationStyle?: RecommendationStyle;
  onRecommendationStyleChange?: (style: RecommendationStyle) => void;
  selectedPaperIds: string[];
  selectionLocked: boolean;
  workspaceLabel: string;
  workspaceSourceType: WorkspaceSourceType;
  onAddDroppedPdfFiles?: (files: File[], targetFolderPath?: string) => void | Promise<void>;
  onAddExternalPdf?: (item: ExternalPdfDragPayload) => void | Promise<void>;
  onClearRecommendations: () => void;
  onRefreshRecommendations?: () => void;
  onDismissRecommendation: (recommendation: RecommendationItem) => void;
  onImportZoteroDirectory?: (files: File[]) => string | Promise<string>;
  onLoginRequired?: () => void;
  onSelectLegacyLibraryRoot?: (legacyRootPath: string) => Promise<void>;
  onMoveFolder?: (folderPath: string, targetFolderPath: string) => Promise<string>;
  onMovePaper?: (paperId: string, targetFolderPath: string) => Promise<string>;
  onOpenCloudEntry?: (scope: CloudLibraryScope, entry: CloudLibraryEntry) => void | Promise<void>;
  onOpenOrganizationWorkspace: () => void;
  onOpenPaper?: (paperId: string) => void;
  onResolvePaperIdentity?: (paper: Paper) => void;
  onRetrievePaperMetadata?: (paper: Paper) => Promise<string>;
  onCreatePaperChild?: (paper: Paper, kind: "note" | "board", title: string) => Promise<void>;
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

export function LiteratureHydrationStatus({
  hydration
}: {
  hydration?: LiteratureHydrationState;
}) {
  if (hydration?.status !== "recoverable_error") return null;
  return (
    <div
      aria-label="文献身份恢复状态"
      aria-live="polite"
      className="library-resource-action-message"
      role="status"
    >
      {hydration.issues.length} 篇文献的身份信息暂时无法恢复；本地文献与其他身份信息仍可使用。
    </div>
  );
}

type ExplorerEntry = {
  bodyAvailable: boolean;
  id: string;
  label: string;
  metadata?: PaperFileMetadata;
  source: LibraryResourceEntrySource;
};

type ExplorerFolder = {
  children: ExplorerFolder[];
  entries: ExplorerEntry[];
  id: string;
  label: string;
  localPath?: string;
  sourceFolder?: LibraryResourceFolderOrigin;
  unfilteredFolder?: ExplorerFolder;
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
  return accountScopeId ?? "";
}

function dirname(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "" : normalized.slice(0, separator);
}

function localExplorerTree(
  snapshot: LocalLibrarySnapshot | null,
  metadataByPaperId: Record<string, PaperFileMetadata> = {},
  papers: readonly Paper[] = []
): ExplorerTree {
  if (!snapshot) return { entries: [], folders: [] };
  const byPath = new Map<string, ExplorerFolder>();
  for (const folder of snapshot.folders) {
    byPath.set(libraryFolderKey(folder.path), {
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
    const node = byPath.get(libraryFolderKey(folder.path))!;
    const parent = folder.parentPath ? byPath.get(libraryFolderKey(folder.parentPath)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const rootEntries: ExplorerEntry[] = [];
  const metadataEntries: ExplorerEntry[] = [];
  for (const entry of snapshot.entries) {
    const explorerEntry: ExplorerEntry = {
      bodyAvailable: entry.path !== null,
      id: entry.id,
      label: metadataByPaperId[entry.id]?.title || paperById.get(entry.id)?.title || entry.title,
      metadata: metadataByPaperId[entry.id],
      source: { area: "local", entry }
    };
    if (!entry.path) {
      metadataEntries.push(explorerEntry);
      continue;
    }
    const parent = byPath.get(libraryFolderKey(dirname(entry.path)));
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

function filterTree(tree: ExplorerTree, query: string, category = "", matches?: Set<string>, fileFolders?: Set<string>): ExplorerTree {
  const compiled = compileSearchQuery(query);
  const entryMatches = (entry: ExplorerEntry) => {
    if (matches) return matches.has(entry.id);
    const categoryMatches = !category || entry.metadata?.category === category;
    if (!categoryMatches) return false;
    if (!query) return true;
    return compiled.matches([entry.label, entry.metadata?.category, ...(entry.metadata?.tags ?? [])].join(" "), { tags: entry.metadata?.tags, format: "pdf", assetType: entry.metadata?.assetType });
  };
  if (!query && !category && !matches) return tree;
  const filterFolders = (folders: ExplorerFolder[]): ExplorerFolder[] => folders.flatMap((folder) => {
    const children = filterFolders(folder.children);
    const entries = folder.entries.filter(entryMatches);
    return (!matches && !category && !compiled.advanced && compiled.textMatches(folder.label)) || children.length > 0 || entries.length > 0 || fileFolders?.has(libraryFolderKey(folder.id))
      ? [{ ...folder, children, entries, unfilteredFolder: folder }]
      : [];
  });
  return {
    entries: tree.entries.filter(entryMatches),
    folders: filterFolders(tree.folders)
  };
}

function readTransfer(event: ReactDragEvent): LibraryResourceTransferSource | null {
  const serialized = event.dataTransfer.getData(resourceTransferMimeType);
  if (!serialized) return null;
  try {
    const source = JSON.parse(serialized);
    if (!source || typeof source !== "object") return null;
    if (source.area === "recommendation") return typeof source.recommendation?.id === "string" ? source : null;
    if (!["local", "collection", "organization"].includes(source.area)) return null;
    if (source.area !== "local" && typeof source.scope?.scopeId !== "string") return null;
    if (source.folder) {
      if (typeof (source.area === "local" ? source.folder.path : source.folder.folderId) !== "string") return null;
      return Array.isArray(source.tree?.children) && Array.isArray(source.tree?.entries) ? source : null;
    }
    return typeof (source.area === "local" ? source.entry?.id : source.entry?.documentId) === "string" ? source : null;
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
  const sourceFolder = folder.unfilteredFolder ?? folder;
  return folder.sourceFolder
    ? {
        ...folder.sourceFolder,
        tree: folderTransferTree(sourceFolder)
      } as LibraryResourceFolderSource
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

export function LibraryPane(props: LibraryPaneProps) {
  const scope = `${props.accountScopeId ?? "guest"}:${props.localLibrarySnapshot?.libraryId ?? "none"}`;
  const content = <LibraryIconProvider key={scope} scope={scope}><LibraryPaneContent {...props} /></LibraryIconProvider>;
  return props.expanded ? <Dialog open onOpenChange={(_, data) => { if (!data.open) props.onCloseExpanded?.(); }}>
    <DialogSurface className="library-expanded-dialog"><DialogBody>
      <DialogTitle action={<Button appearance="subtle" aria-label="关闭文献库浮窗" onClick={props.onCloseExpanded}>关闭</Button>}>文献库</DialogTitle>
      <DialogContent>{content}</DialogContent>
    </DialogBody></DialogSurface>
  </Dialog> : content;
}

function LibraryPaneContent({
  fileLibrary,
  accountScopeId,
  contextScopeId = "local",
  accountSessionAvailable = false,
  localRecommendations = false,
  activePaperId,
  cloudEndpoint,
  cloudTreeRevision,
  localLibrarySnapshot,
  localLibraryError,
  literatureHydration,
  loadLegacyLibraryRoots,
  onAddDroppedPdfFiles,
  onClearRecommendations,
  onRefreshRecommendations,
  onDismissRecommendation,
  onImportZoteroDirectory,
  onLoginRequired,
  onSelectLegacyLibraryRoot,
  onMoveFolder,
  onMovePaper,
  onOpenCloudEntry,
  onOpenPaper,
  onResolvePaperIdentity,
  onRetrievePaperMetadata,
  onOpenPaperChild,
  onCreatePaperChild,
  paperChildren = {},
  papers,
  onRefreshLocalLibrary,
  onRenameFolder,
  onRenamePaper,
  onResourceTransfer,
  onToggleSelection,
  organizationId,
  organizationStorageAccess,
  organizationWorkspaceLabel = "组织文献库",
  recommendationService,
  recommendationItems,
  selectedRecommendationId,
  onInspectRecommendation,
  onOpenRecommendation,
  recommendationMessage,
  recommendationPending,
  recommendationStatus,
  recommendationStyle = "balanced",
  onRecommendationStyleChange,
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
  const icons = useLibraryIcons();
  const [transferPlan, setTransferPlan] = useState<LibraryResourceTransferPlan | null>(null);
  const transferConfirmation = useRef<((accepted: boolean) => void) | null>(null);
  const sessionGeneration = getAccountSessionGeneration();
  const transferContext = useRef({ cloudEndpoint, sessionGeneration, localRoot: localLibrarySnapshot?.rootPath });
  transferContext.current = { cloudEndpoint, sessionGeneration, localRoot: localLibrarySnapshot?.rootPath };
  useEffect(() => {
    transferConfirmation.current?.(false);
    transferConfirmation.current = null;
    setTransferPlan(null);
    return () => { transferConfirmation.current?.(false); };
  }, [cloudEndpoint, sessionGeneration, localLibrarySnapshot?.rootPath]);
  function folderIconKey(area: string, path: string) {
    if (area !== "local") return `folder:${area}:${area === "organization" ? organizationId : ""}:${path}`;
    if (path === "local-metadata-only") return "folder:virtual:metadata";
    const relative = relativeLibraryFolder(localLibrarySnapshot?.rootPath, path);
    const windows = /^(?:[a-z]:|\/\/)/i.test(normalizedLibraryPath(localLibrarySnapshot?.rootPath ?? ""));
    return `folder:local:${windows ? relative.toLowerCase() : relative}`;
  }
  function relocateFolderIcons(source: string, target: string) {
    icons.relocate(folderIconKey("local", source), folderIconKey("local", target));
  }
  const [collapsedSections, setCollapsedSections] = useState<LibraryResourceArea[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<LibraryResourceArea, string[]>>({
    collection: [],
    local: [],
    organization: [],
    recommendation: []
  });
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [fileFilters, setFileFilters] = useState<ReadingCatalogFilters>({ query: "", collection: "", format: "all", status: "all", year: "", sort: "added" });
  const [paperMetadataById, setPaperMetadataById] = useState<Record<string, PaperFileMetadata>>({});
  const [metadataEditorEntry, setMetadataEditorEntry] = useState<ReadingCatalogEntry | null>(null);
  const [expandedPaperChildren, setExpandedPaperChildren] = useState<string[]>([]);
  const [newChild, setNewChild] = useState<{ paper: Paper; kind: "note" | "board" }>();
  const [childTitle, setChildTitle] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);
  const [message, setMessage] = useState("");
  const [dropHover, setDropHover] = useState<{ key: string; allowed: boolean; label: string } | null>(null);
  const dragSourceRef = useRef<LibraryResourceTransferSource | null>(null);
  const dropBusy = useRef(false);
  useEffect(() => {
    const clear = () => { setDropHover(null); dragSourceRef.current = null; };
    window.addEventListener("dragend", clear); window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); window.removeEventListener("blur", clear); };
  }, []);
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
  useEffect(() => {
    setPendingNodeIds([]);
    setMessage("");
    dragSourceRef.current = null;
    dropBusy.current = false;
  }, [cloudEndpoint, sessionGeneration]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Record<
    "local" | "collection" | "organization",
    string | null
  >>({ collection: null, local: null, organization: null });
  const query = search.trim();
  const visiblePaperMetadata = useMemo(() => {
    const result = { ...paperMetadataById };
    for (const entry of fileLibrary?.entries ?? []) {
      if (entry.format !== "pdf" || (entry.collection === undefined && entry.tags === undefined)) continue;
      result[entry.id] = normalizePaperFileMetadata({
        ...result[entry.id], ...entry, category: entry.collection ?? result[entry.id]?.category,
        tags: entry.tags ?? result[entry.id]?.tags
      });
    }
    return result;
  }, [paperMetadataById, fileLibrary?.entries]);
  const categories = useMemo(() => Array.from(new Set(
    [...Object.values(visiblePaperMetadata).map((metadata) => metadata.category), ...(fileLibrary?.entries.map((entry) => entry.collection ?? "") ?? [])].filter(Boolean)
  )).sort((left, right) => left.localeCompare(right)), [visiblePaperMetadata, fileLibrary?.entries]);
  const catalogEntries = useMemo<ReadingCatalogEntry[]>(() => {
    const entries = new Map((fileLibrary?.entries ?? []).map((entry) => [entry.id, entry]));
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    for (const source of localLibrarySnapshot?.entries ?? []) {
      const paper = paperById.get(source.id);
      const metadata = visiblePaperMetadata[source.id];
      const previous = entries.get(source.id);
      if (previous?.bibliographicRevision) {
        entries.set(source.id, { ...previous, fileName: source.relativePath ?? undefined, physicalPath: source.path ?? undefined, available: source.path !== null });
        continue;
      }
      entries.set(source.id, { ...previous, id: source.id, format: "pdf", title: paper?.literature?.title || paper?.title || source.title,
        authors: metadata?.authors ?? paper?.literature?.authors ?? (typeof paper?.authors === "string" ? [paper.authors] : paper?.authors ? [...paper.authors] : previous?.authors),
        year: metadata?.year ?? paper?.literature?.year ?? (paper?.year ? Number(paper.year) : previous?.year),
        assetType: metadata?.assetType || previous?.assetType || inferAssetType("pdf", paper?.literature?.documentType),
        subjects: metadata?.subjects, tags: metadata?.tags, collection: metadata?.category,
        fileName: source.relativePath ?? undefined, physicalPath: source.path ?? undefined, available: source.path !== null
      });
    }
    return [...entries.values()];
  }, [fileLibrary?.entries, localLibrarySnapshot, papers, visiblePaperMetadata]);
  const catalogById = useMemo(() => new Map(catalogEntries.map((entry) => [entry.id, entry])), [catalogEntries]);
  const fileIndex = useMemo(() => indexReadingCatalog(catalogEntries), [catalogEntries]);
  const hasFilters = Boolean(query || selectedCategory || fileFilters.format !== "all" || fileFilters.status !== "all" || fileFilters.year || fileFilters.assetType || fileFilters.author || fileFilters.subject || fileFilters.tags?.length || fileFilters.excludeTags?.length);
  const filteredIds = useMemo(() => hasFilters
    ? new Set(queryReadingCatalog(fileIndex, { ...fileFilters, query: search, collection: selectedCategory }).map((entry) => entry.id)) : undefined,
    [fileIndex, hasFilters, search, selectedCategory, fileFilters]);
  function selectTag(tag: LibraryTag) {
    if (tag.kind === "collection") setSelectedCategory(tag.value);
    else setFileFilters((value) => ({ ...value, ...(tag.kind === "tag" ? { tags: [...new Set([...(value.tags ?? []), tag.value])] }
      : { [tag.kind === "type" ? "assetType" : tag.kind]: tag.value }) }));
  }
  function resetFilters() {
    setSelectedCategory("");
    setFileFilters({ query: "", collection: "", format: "all", status: "all", year: "", sort: "added" });
  }
  const fileFolders = useMemo(() => {
    const paths = new Set<string>();
    const root = normalizedLibraryPath(localLibrarySnapshot?.rootPath ?? "");
    for (const entry of fileLibrary?.entries ?? []) {
      if (entry.format === "pdf" || !entry.folderPath || (filteredIds && !filteredIds.has(entry.id))) continue;
      const parts = entry.folderPath.split("/");
      while (parts.length) { paths.add(libraryFolderKey(`${root}/${parts.join("/")}`)); parts.pop(); }
    }
    return paths;
  }, [fileLibrary?.entries, localLibrarySnapshot?.rootPath, filteredIds]);
  const rootFileIds = useMemo(() => {
    const paths = new Set(localLibrarySnapshot?.folders.map((folder) => libraryFolderKey(folder.path)));
    const root = normalizedLibraryPath(localLibrarySnapshot?.rootPath ?? "");
    return new Set(fileLibrary?.entries.filter((entry) => !entry.folderPath || !paths.has(libraryFolderKey(`${root}/${entry.folderPath}`))).map((entry) => entry.id));
  }, [fileLibrary?.entries, localLibrarySnapshot]);
  const localTree = useMemo(
    () => filterTree(localExplorerTree(localLibrarySnapshot, visiblePaperMetadata, papers), query, selectedCategory, filteredIds, fileFolders),
    [localLibrarySnapshot, visiblePaperMetadata, papers, query, selectedCategory, filteredIds, fileFolders]
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

  useEffect(() => {
    const paperIds = localLibrarySnapshot?.entries.map((entry) => entry.id) ?? [];
    let cancelled = false;
    void Promise.all(paperIds.map(async (paperId) => [
      paperId,
      await loadPaperFileMetadata(paperId)
    ] as const)).then((entries) => {
      if (!cancelled) setPaperMetadataById(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [localLibrarySnapshot?.libraryId, localLibrarySnapshot?.revision]);

  function openMetadataEditor(entry: ExplorerEntry) {
    setMetadataEditorEntry(catalogById.get(entry.id) ?? { id: entry.id, title: entry.label, format: "pdf", ...entry.metadata, collection: entry.metadata?.category });
  }
  async function submitMetadataEditor(patch: ReadingCatalogMetadataPatch) {
    if (!metadataEditorEntry) return;
    const draft = normalizePaperFileMetadata({ ...paperMetadataById[metadataEditorEntry.id], ...patch, category: patch.collection });
    if (fileLibrary?.onMetadataChange) await fileLibrary.onMetadataChange(metadataEditorEntry.id, patch);
    else await savePaperFileMetadata(metadataEditorEntry.id, draft);
    if (metadataEditorEntry.format === "pdf") setPaperMetadataById((current) => ({ ...current, [metadataEditorEntry.id]: draft }));
    setSelectedCategory((current) => current === metadataEditorEntry.collection ? draft.category : current);
    setMessage("资产分类与标签已保存。");
  }

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
    const generation = getAccountSessionGeneration();
    try {
      const plan = await confirmAndTransfer(source, target);
      setMessage(plan.action === "move" ? "资源已移到目标位置。" : "资源已复制到目标位置。");
      await Promise.all([collection.refresh(), organization.refresh()]);
    } catch (error) {
      if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) setMessage(error instanceof Error ? error.message : "资源操作失败。");
    }
  }

  function finishTransferConfirmation(accepted: boolean) {
    transferConfirmation.current?.(accepted);
    transferConfirmation.current = null;
    setTransferPlan(null);
  }

  async function confirmAndTransfer(source: LibraryResourceTransferSource, target: LibraryResourceTransferTarget) {
    if (!onResourceTransfer) throw new Error("当前资源暂不支持转移。");
    const plan = planLibraryResourceTransfer(source, target);
    const context = transferContext.current;
    transferConfirmation.current?.(false);
    setTransferPlan(plan);
    const accepted = await new Promise<boolean>((resolve) => { transferConfirmation.current = resolve; });
    if (!accepted) throw new Error("已取消资料转移。");
    if (context.sessionGeneration !== getAccountSessionGeneration() || context.cloudEndpoint !== transferContext.current.cloudEndpoint || context.localRoot !== transferContext.current.localRoot) throw new Error("账号或云服务已变化，请重新操作。");
    await onResourceTransfer(plan.source, plan.target);
    if (context.sessionGeneration !== getAccountSessionGeneration() || context.cloudEndpoint !== transferContext.current.cloudEndpoint || context.localRoot !== transferContext.current.localRoot) throw new Error("账号或云服务已变化，请重新操作。");
    return plan;
  }

  async function saveRecommendation(recommendation: RecommendationItem) {
    const generation = getAccountSessionGeneration();
    if (pendingNodeIds.includes(recommendation.id)) return;
    setPendingNodeIds((current) => [...current, recommendation.id]);
    try {
      await transfer({ area: "recommendation", recommendation }, targetFor(localRecommendations ? "local" : "collection"));
    } finally {
      if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) setPendingNodeIds((current) => current.filter((id) => id !== recommendation.id));
    }
  }

  async function runNodeAction(nodeId: string, pendingMessage: string, action: () => Promise<void | string>) {
    const generation = getAccountSessionGeneration();
    if (pendingNodeIds.includes(nodeId)) return;
    setPendingNodeIds((current) => [...current, nodeId]);
    setMessage(pendingMessage);
    try {
      const outcome = await action();
      if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) setMessage(outcome ?? "操作已完成。");
    } catch (error) {
      if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) setMessage(error instanceof Error ? error.message : "资源操作失败，请检查目标位置后重试。");
    } finally {
      if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) setPendingNodeIds((current) => current.filter((id) => id !== nodeId));
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
      const result = await onRenameFolder(folder.localPath, requested);
      if (result.startsWith("已将目录")) {
        const target = buildRenamedFolderPath(folder.localPath, requested);
        relocateFolderIcons(folder.localPath, target);
        await fileLibrary?.onRelocateFolder?.(folder.localPath, target);
      }
      setMessage(result);
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
      folderLabel: folder?.label,
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

  function dropKey(area: string, folder?: ExplorerFolder) { return `${area}:${folder?.id ?? "root"}`; }
  function dropPermission(event: ReactDragEvent, area: "local" | "collection" | "organization", folder?: ExplorerFolder) {
    if (dropBusy.current || fileLibrary?.pending) return "请等待当前文件操作完成。";
    if (folder?.virtual) return "此分组不是可导入的目录。";
    if (area !== "local" && !accountSessionAvailable) return "请登录后再导入收藏或组织目录。";
    if (event.dataTransfer.types.includes(libraryFileDragType)) return area === "local" && fileLibrary?.onMoveFile ? "" : "阅读文件目前可整理到本地目录。";
    const source = dragSourceRef.current ?? readTransfer(event);
    if (source) {
      const denied = transferPermissionMessage(source, targetFor(area, folder));
      if (denied) return denied;
      if (source.area === "local" && "folder" in source && area === "local") {
        const from = libraryFolderKey(source.folder.path), to = libraryFolderKey(folder?.localPath ?? localLibrarySnapshot?.rootPath ?? "");
        if (to === from || to.startsWith(`${from}/`)) return "不能将目录移入自身或其子目录。";
      }
      return "";
    }
    if (area === "organization" && (!organizationStorageAccess || !canUploadToOrganization(organizationStorageAccess))) return "当前组织角色不能导入文件。";
    if (event.dataTransfer.types.includes(resourceTransferMimeType) || event.dataTransfer.types.includes("Files")) return "";
    return "请拖入文件或文献库中的条目。";
  }
  function hoverTarget(event: ReactDragEvent, area: "local" | "collection" | "organization", folder?: ExplorerFolder) {
    event.preventDefault(); event.stopPropagation();
    const reason = dropPermission(event, area, folder);
    const moving = event.dataTransfer.types.includes(libraryFileDragType) || (dragSourceRef.current?.area === area);
    event.dataTransfer.dropEffect = reason ? "none" : moving ? "move" : "copy";
    const name = folder?.label ?? (area === "local" ? "本地文献库" : area === "collection" ? "收藏" : "组织文献库");
    const next = { key: dropKey(area, folder), allowed: !reason, label: reason || `松开即可${moving ? "移入" : "导入"}“${name}”` };
    setDropHover((current) => current?.key === next.key && current.label === next.label ? current : next);
  }
  function leaveTarget(event: ReactDragEvent, area: "local" | "collection" | "organization", folder?: ExplorerFolder) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      setDropHover((current) => current?.key === dropKey(area, folder) ? null : current);
    }
  }
  async function dropOnTarget(event: ReactDragEvent, area: "local" | "collection" | "organization", folder?: ExplorerFolder) {
    const generation = getAccountSessionGeneration();
    event.preventDefault(); event.stopPropagation(); setDropHover(null);
    const denied = dropPermission(event, area, folder);
    if (denied) { setMessage(denied); return; }
    const source = dragSourceRef.current ?? readTransfer(event);
    const readingId = event.dataTransfer.getData(libraryFileDragType);
    const files = Array.from(event.dataTransfer.files ?? []);
    const directory = Array.from(event.dataTransfer.items ?? []).some((item) => item.webkitGetAsEntry?.()?.isDirectory);
    const target = targetFor(area, folder);
    const name = folder?.label ?? (area === "local" ? "本地文献库" : area === "collection" ? "收藏" : "组织文献库");
    dropBusy.current = true;
    setMessage(`正在导入“${name}”…`);
    try {
      if (directory) throw new Error("请打开文件夹，选择其中的文件后拖入。");
      if (readingId) {
        if (!fileLibrary?.onMoveFile || area !== "local") throw new Error("此文件无法移动到该位置。");
        await fileLibrary.onMoveFile(readingId, target.localFolderPath);
        setMessage(`文件已移入“${name}”。`);
      } else if (source) {
        if ("folder" in source && source.area === "local" && area === "local") {
          if (!onMoveFolder || !target.localFolderPath) throw new Error("当前目录无法移动。");
          const result = await onMoveFolder(source.folder.path, target.localFolderPath);
          if (result.startsWith("已将目录")) {
            const destination = buildMovedFolderPath(source.folder.path, target.localFolderPath);
            relocateFolderIcons(source.folder.path, destination);
            await fileLibrary?.onRelocateFolder?.(source.folder.path, destination);
          }
          setMessage(result);
        } else if (source.area === "local" && "entry" in source && source.entry.path && area === "local") {
          if (!onMovePaper || !target.localFolderPath) throw new Error("当前文献无法移动。");
          setMessage(await onMovePaper(source.entry.id, target.localFolderPath));
        } else await transfer(source, target);
      } else if (files.length) {
        if (area === "local") {
          if (!fileLibrary && files.some((file) => !/\.pdf$/i.test(file.name))) throw new Error("当前入口仅支持 PDF 文件。");
          if (!fileLibrary && !onAddDroppedPdfFiles) throw new Error("文件导入暂不可用。");
          const result = fileLibrary ? await fileLibrary.onImport(files, target.localFolderPath) : await onAddDroppedPdfFiles!(files, target.localFolderPath);
          setMessage(typeof result === "string" ? `目标：${name}。${result}` : `已将 ${files.length} 个文件导入“${name}”。`);
        } else {
          if (files.some((file) => !/\.pdf$/i.test(file.name))) throw new Error("云端收藏和组织目录目前仅支持 PDF；其他格式请导入本地目录。");
          if (!target.scope) throw new Error("目标目录不可用，请刷新后重试。");
          const client = createCloudLibraryStorageClient({ endpoint: cloudEndpoint });
          let revision = target.expectedRevision ?? 0, imported = 0;
          for (const file of files) {
            const result = await client.uploadDocument({ file, scope: target.scope, folderId: target.folderId, expectedRevision: revision });
            revision = result.revision ?? revision;
            if (result.status === "imported") imported += 1;
          }
          await (area === "collection" ? collection.refresh() : organization.refresh());
          setMessage(`已导入 ${imported} 个 PDF 到“${name}”（重复文件未新增）。`);
        }
      } else throw new Error("没有可导入的文件，请从文件管理器或文献库拖入。");
      if (folder) {
        setExpandedFolders((current) => ({ ...current, [area]: [...new Set([...current[area], folder.id])] }));
        setSelectedFolderIds((current) => ({ ...current, [area]: folder.id }));
      }
      await onRefreshLocalLibrary?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败，请重试。"); }
    finally { if (generation === getAccountSessionGeneration() && cloudEndpoint === transferContext.current.cloudEndpoint) { dropBusy.current = false; dragSourceRef.current = null; } }
  }

  function renderEntry(area: "local" | "collection" | "organization", entry: ExplorerEntry, depth: number) {
    const selected = area === "local" && selectedPaperIds.includes(entry.id);
    const sourcePaper = papers.find((paper) => paper.id === entry.id);
    const children = sourcePaper ? paperChildren[sourcePaper.id] ?? [] : [];
    const childrenExpanded = expandedPaperChildren.includes(entry.id);
    const pending = pendingNodeIds.includes(entry.id);
    const canAttachPdf = entry.source.area !== "local" &&
      entry.source.entry.entryKind === "metadata_only" &&
      (entry.source.area !== "organization" || Boolean(
        organizationStorageAccess && canUploadToOrganization(organizationStorageAccess)
      ));
    const canManageEntry = area !== "organization" || Boolean(
      organizationStorageAccess && canManageOrganizationLibrary(organizationStorageAccess.role)
    );
    const inspectEntry = () => fileLibrary?.onInspect(fileLibrary.entries.find((item) => item.id === entry.id) ?? {
      id: entry.id, title: entry.label, format: "pdf", canExport: false, canRemove: false,
      physicalPath: entry.source.area === "local" ? entry.source.entry.path ?? undefined : undefined,
      available: entry.bodyAvailable, tags: entry.metadata?.tags, collection: entry.metadata?.category
    }, () => {
      if (entry.source.area === "local") onOpenPaper?.(entry.id);
      else void onOpenCloudEntry?.(entry.source.scope, entry.source.entry);
    });
    const openEntry = () => {
      inspectEntry();
      if (entry.source.area === "local") onOpenPaper?.(entry.id);
      else void onOpenCloudEntry?.(entry.source.scope, entry.source.entry);
    };
    const selectEntry = (event: { ctrlKey: boolean; metaKey: boolean }) => {
      inspectEntry();
      if (area !== "local" || selectionLocked) return;
      if (event.ctrlKey || event.metaKey) { onToggleSelection(entry.id); return; }
      selectedPaperIds.filter((id) => id !== entry.id).forEach(onToggleSelection);
      if (!selected) onToggleSelection(entry.id);
    };
    const row = (
      <div
        aria-busy={pending}
        className="library-paper-row"
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button,input")) selectEntry(event); }}
        onFocus={inspectEntry}
        draggable={!pending && canStartResourceDrag(entry.source)}
        onDragStart={(event) => {
          if (!canStartResourceDrag(entry.source)) {
            event.preventDefault();
            setMessage("当前组织策略不允许移动或复制该内容。");
            return;
          }
          event.dataTransfer.effectAllowed = "copyMove";
          dragSourceRef.current = entry.source;
          event.dataTransfer.setData(resourceTransferMimeType, JSON.stringify(entry.source));
        }}
        data-library-depth={depth}
        style={{ paddingInlineStart: `${depth * 18 + 6}px` }}
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
        {children.length ? <Tooltip content={childrenExpanded ? "收起论文附件" : `展开 ${children.length} 个论文附件`} relationship="description">
          <button className="library-attachment-count" type="button" aria-label={`${childrenExpanded ? "收起" : "展开"} ${entry.label} 的 ${children.length} 个附件`}
            aria-expanded={childrenExpanded} onClick={(event) => { event.stopPropagation(); setExpandedPaperChildren((current) => current.includes(entry.id)
              ? current.filter((id) => id !== entry.id) : [...current, entry.id]); }}>+{children.length}</button>
        </Tooltip> : null}
        <span aria-hidden="true" className="library-paper-icon">
          <LibraryItemIcon itemKey={`file:${area}:${entry.id}`} kind={entry.bodyAvailable ? "pdf" : "text"} />
        </span>
        <div className="library-paper-content">
          <Menu openOnContext>
            <MenuTrigger disableButtonEnhancement>
              <button
                onClick={selectEntry}
                onDoubleClick={openEntry}
                data-reading-entry={entry.bodyAvailable ? "true" : undefined}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openEntry(); } }}
                aria-pressed={selected}
                className="library-paper-title"
                disabled={pending}
                title={entry.bodyAvailable ? entry.label : `${entry.label}（仅元数据）`}
                type="button"
              >
                <span className="library-paper-title-text"><SearchHighlight text={entry.label} query={search} /></span>
              </button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <LibraryIconMenuItem itemKey={`file:${area}:${entry.id}`} title={entry.label} />
                {sourcePaper ? <ExtensionActions menu location="library.item.context" paperCount={1} selection={[liteasyPath(contextScopeId, { kind: "paper", paperId: sourcePaper.id })]} /> : null}
                {sourcePaper && onCreatePaperChild ? <>
                  <MenuItem onClick={() => { setNewChild({ paper: sourcePaper, kind: "note" }); setChildTitle(`${sourcePaper.title} · 笔记`); }}>新建 Markdown 笔记</MenuItem>
                  <MenuItem onClick={() => { setNewChild({ paper: sourcePaper, kind: "board" }); setChildTitle(`${sourcePaper.title} · 白板`); }}>新建论文白板</MenuItem>
                </> : null}
                <MenuItem
                  disabled={!entry.bodyAvailable || pending}
                  icon={<OpenRegular />}
                  onClick={openEntry}
                >打开</MenuItem>
                {entry.source.area === "collection" && entry.source.entry.entryKind === "pdf" ? (
                  <MenuItem
                    disabled={pending || !accountSessionAvailable || !localLibrarySnapshot || !onResourceTransfer}
                    icon={<DocumentArrowDownRegular />}
                    onClick={() => void runNodeAction(entry.id, "正在复制到本机文献库...", async () => {
                      if (!onResourceTransfer || !localLibrarySnapshot) throw new Error("请先选择本机文献库。");
                      await confirmAndTransfer(entry.source, targetFor("local"));
                      return "已复制到本机文献库。";
                    })}
                  >复制到本机文献库</MenuItem>
                ) : null}
                {area === "local" && fileLibrary?.onEditBibliography ? <MenuItem icon={<EditRegular />} disabled={pending}
                  onClick={() => fileLibrary.onEditBibliography!(catalogById.get(entry.id) ?? { id: entry.id, title: entry.label, format: "pdf" })}>编辑元信息</MenuItem> : null}
                {sourcePaper && area === "local" ? <MenuItem
                  disabled={pending || !entry.bodyAvailable || !onRetrievePaperMetadata}
                  icon={<DocumentTextRegular />}
                  onClick={() => void runNodeAction(entry.id, "正在获取元数据...", () => onRetrievePaperMetadata!(sourcePaper))}
                >获取元数据</MenuItem> : null}
                {sourcePaper ? <MenuItem icon={<DocumentTextRegular />} onClick={() => onResolvePaperIdentity?.(sourcePaper)}>确认文献身份</MenuItem> : null}
                <MenuItem
                  disabled={pending || !canManageEntry}
                  icon={<EditRegular />}
                  onClick={() => void runNodeAction(entry.id, "正在重命名文献...", () => renameEntry(area, entry))}
                >重命名</MenuItem>
                {area === "local" ? (
                  <MenuItem
                    disabled={pending}
                    icon={<TagRegular />}
                    onClick={() => openMetadataEditor(entry)}
                  >编辑分类与标签</MenuItem>
                ) : null}
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
          <LibraryTagChips entry={catalogById.get(entry.id) ?? { id: entry.id, title: entry.label, format: "pdf" }} onSelect={selectTag} />
        </div>
        {!entry.bodyAvailable ? <span className="library-entry-status">仅元数据</span> : null}
        {sourcePaper ? <ResourceLocationButton target={{ kind: "paper", paperId: sourcePaper.id }} /> : null}
      </div>
    );
    return (
      <li className={`library-paper-node${selected ? " active" : ""}`} key={entry.id}>
        {row}
        {sourcePaper && children.length > 0 && childrenExpanded ? (
          <div className="library-paper-children" style={{ marginInlineStart: `${depth * 18 + 50}px` }}>
            <ul aria-label={`${entry.label} 的论文文件`}>
              {children.map((child) => (
                <li key={child.id}>
                  <Menu openOnContext><MenuTrigger disableButtonEnhancement><Button
                    appearance="subtle"
                    size="small"
                    icon={<LibraryItemIcon itemKey={`child:${sourcePaper.id}:${child.id}`} kind={child.kind} />}
                    title={child.meta ? `${child.label} · ${child.meta}` : child.label}
                    aria-label={`打开论文文件：${child.label}`}
                    data-reading-entry="true"
                    draggable
                    onDragStart={(event) => {
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "copy";
                      if (child.objectId) writeAssetContextTransfer(event.dataTransfer, contextScopeId, {
                        kind: "path", path: liteasyPath(contextScopeId, { kind: "object", ref: { objectId: child.objectId, revision: "latest" }, followLatest: true }),
                      }, child.label);
                      else if (child.kind === "artifact") {
                        writeAssetContextTransfer(event.dataTransfer, contextScopeId, { kind: "path", path: liteasyPath(contextScopeId, { kind: "artifact", artifactId: child.id }) }, child.label);
                      } else if (child.kind === "extracted_text" || child.kind === "figures" || child.kind === "multimodal") {
                        writeAssetContextTransfer(event.dataTransfer, contextScopeId, { kind: "paper-resource", paperId: sourcePaper.id, resourceKind: child.kind }, child.label);
                      } else event.preventDefault();
                    }}
                    onClick={() => onOpenPaperChild?.(child, sourcePaper)}
                  >{child.label}</Button></MenuTrigger><MenuPopover><MenuList>
                    <LibraryIconMenuItem itemKey={`child:${sourcePaper.id}:${child.id}`} title={child.label} />
                  </MenuList></MenuPopover></Menu>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </li>
    );
  }

  function renderFolder(
    area: "local" | "collection" | "organization",
    folder: ExplorerFolder,
    depth: number
  ) {
    const expanded = query.length > 0 || Boolean(area === "local" && filteredIds && fileFolders.has(libraryFolderKey(folder.id))) || expandedFolders[area].includes(folder.id);
    const selected = !folder.virtual && selectedFolderIds[area] === folder.id;
    const pending = pendingNodeIds.includes(folder.id);
    const canManageFolder = area !== "organization" || Boolean(
      organizationStorageAccess && canManageOrganizationLibrary(organizationStorageAccess.role)
    );
    const folderSource = folder.sourceFolder ? folderTransferSource(folder) : null;
    const row = (
      <div
        aria-busy={pending}
        className={`library-folder-row${selected ? " is-selected" : ""}${dropHover?.key === dropKey(area, folder) ? dropHover.allowed ? " is-drop-target" : " is-drop-blocked" : ""}`}
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
          event.stopPropagation(); dragSourceRef.current = source;
          event.dataTransfer.setData(resourceTransferMimeType, JSON.stringify(source));
        } : undefined}
        onDragEnter={(event) => hoverTarget(event, area, folder)}
        onDragOver={(event) => hoverTarget(event, area, folder)}
        onDragLeave={(event) => leaveTarget(event, area, folder)}
        onDrop={(event) => void dropOnTarget(event, area, folder)}
        data-library-depth={depth}
        style={{ paddingInlineStart: `${depth * 18}px` }}
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
          <LibraryItemIcon itemKey={folderIconKey(area, folder.localPath ?? folder.id)} kind="folder" />
          <span>{folder.label}{dropHover?.key === dropKey(area, folder) ? <small className="library-drop-feedback" role="status">{dropHover.label}</small> : null}</span>
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
                <LibraryIconMenuItem itemKey={folderIconKey(area, folder.localPath ?? folder.id)} title={folder.label} />
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
          <ul className="library-tree-children" style={{ "--library-guide-offset": `${depth * 18 + 9}px` } as CSSProperties}>
            {folder.children.map((child) => renderFolder(area, child, depth + 1))}
            {folder.entries.map((entry) => renderEntry(area, entry, depth + 1))}
            {area === "local" && folder.localPath && fileLibrary ? <li className="library-folder-files"><LibraryFileList onEditMetadata={setMetadataEditorEntry} access={fileLibrary} query={search} category={selectedCategory} filters={fileFilters}
              libraryRootPath={localLibrarySnapshot?.rootPath} folderPath={relativeLibraryFolder(localLibrarySnapshot?.rootPath, folder.localPath)} depth={depth + 1} /></li> : null}
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
        className={`library-tree-drop-root${dropHover?.key === dropKey(area) ? dropHover.allowed ? " is-drop-target" : " is-drop-blocked" : ""}`}
        onDragEnter={(event) => hoverTarget(event, area)} onDragOver={(event) => hoverTarget(event, area)} onDragLeave={(event) => leaveTarget(event, area)}
        onDrop={(event) => void dropOnTarget(event, area)}
      >
        {area !== "local" && dropHover?.key === dropKey(area) ? <div className="library-drop-feedback" role="status">{dropHover.label}</div> : null}
        {tree.folders.length > 0 || tree.entries.length > 0 ? (
          <ul className="library-resource-tree">
            {tree.folders.map((folder) => renderFolder(area, folder, 0))}
            {tree.entries.map((entry) => renderEntry(area, entry, 0))}
          </ul>
        ) : empty ? <div className="library-empty-collection">{empty}</div> : null}
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

  const localCount = (localLibrarySnapshot?.entries.length ?? 0) + (fileLibrary?.entries.filter((entry) => entry.format !== "pdf").length ?? 0);
  const legacyLibrarySelectionRequired = localLibraryError?.startsWith(
    "检测到多个旧账号本地库"
  ) ?? false;
  const collectionCount = collection.tree?.entries.length ?? 0;
  const organizationCount = organization.tree?.entries.length ?? 0;

  return (
    <div className="library-pane">
      <Dialog open={transferPlan !== null} onOpenChange={(_, data) => { if (!data.open) finishTransferConfirmation(false); }}>
        <DialogSurface aria-label="确认资料转移"><DialogBody>
          <DialogTitle>{transferPlan?.action === "move" ? "移动资料" : "复制资料"}</DialogTitle>
          <DialogContent>
            <p>来源：{transferPlan?.sourceLabel}</p>
            <p>目标：{transferPlan?.targetLabel}</p>
            <p>{transferPlan?.pdfCount ?? 0} 个 PDF，{transferPlan?.metadataCount ?? 0} 条仅元数据条目。</p>
            {transferPlan?.recommendationCount ? <p>{transferPlan.recommendationCount} 篇推荐文献：有可用正文时保存 PDF，否则仅保存元数据。</p> : null}
            <p>仅转移文献 PDF 与元数据；本机批注、派生笔记和白板不随之转移。</p>
            <p>云端权限、可用配额和重复条目将在提交时再次检查。复制到组织库后，该组织中有权限的成员可访问；个人云收藏不会因此发布到 Intuecho。</p>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => finishTransferConfirmation(false)}>取消</Button>
            <Button appearance="primary" onClick={() => finishTransferConfirmation(true)}>{transferPlan?.action === "move" ? "确认移动" : "确认复制"}</Button>
          </DialogActions>
        </DialogBody></DialogSurface>
      </Dialog>
      <Dialog open={Boolean(newChild)} onOpenChange={(_, data) => { if (!data.open && !creatingChild) setNewChild(undefined); }}>
        <DialogSurface><DialogBody><DialogTitle>{newChild?.kind === "board" ? "新建论文白板" : "新建 Markdown 笔记"}</DialogTitle>
          <DialogContent><Field label="名称"><Input aria-label="论文附件名称" value={childTitle} onChange={(_, data) => setChildTitle(data.value)} maxLength={1000} /></Field>
            <p>保存到「{newChild?.paper.title}」的论文文件中。</p>{message ? <p role="status">{message}</p> : null}</DialogContent>
          <DialogActions><Button disabled={creatingChild} onClick={() => setNewChild(undefined)}>取消</Button>
            <Button appearance="primary" disabled={creatingChild || !childTitle.trim()} onClick={() => {
              if (!newChild || !onCreatePaperChild) return;
              setCreatingChild(true);
              void onCreatePaperChild(newChild.paper, newChild.kind, childTitle.trim()).then(() => setNewChild(undefined))
                .catch((failure) => setMessage(String(failure))).finally(() => setCreatingChild(false));
            }}>{creatingChild ? "创建中…" : "创建"}</Button></DialogActions>
        </DialogBody></DialogSurface>
      </Dialog>

      <div className="library-toolbar">
        <Input
          aria-label="搜索文献资源"
          className="library-search-input"
          contentBefore={<SearchRegular aria-hidden="true" />}
          onChange={(_, data) => setSearch(data.value)}
          placeholder="搜索标题、作者、标签或文件"
          size="small"
          value={search}
        />
        <SearchOptions query={search} onChange={setSearch} tags={catalogEntries.flatMap((entry) => entry.tags ?? [])} />
        <Popover positioning="below-start">
          <PopoverTrigger disableButtonEnhancement><Tooltip content="筛选本地文件" relationship="description"><Button appearance="subtle" size="small" aria-label="筛选本地文件" icon={<FilterRegular />} /></Tooltip></PopoverTrigger>
          <PopoverSurface className="library-file-filters">
            <Field label="检索字段"><Select aria-label="文件检索字段" value={fileFilters.scope ?? "metadata"} onChange={(_, data) => setFileFilters((value) => ({ ...value, scope: data.value as "metadata" | "name" }))}><option value="metadata">标题与元信息</option><option value="name">仅名称</option></Select></Field>
            <Field label="格式"><Select aria-label="筛选文件格式" value={fileFilters.format} onChange={(_, data) => setFileFilters((value) => ({ ...value, format: data.value as ReadingCatalogFilters["format"] }))}>
              <option value="all">全部格式</option>{Object.entries(readingCatalogFormatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select></Field>
            <Field label="阅读状态"><Select aria-label="筛选阅读状态" value={fileFilters.status} onChange={(_, data) => setFileFilters((value) => ({ ...value, status: data.value as ReadingCatalogFilters["status"] }))}>
              <option value="all">全部状态</option>{Object.entries(readingCatalogStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select></Field>
            <Field label="年份"><Input aria-label="筛选发表年份" placeholder="例如 2024" value={fileFilters.year} onChange={(_, data) => setFileFilters((value) => ({ ...value, year: data.value }))} /></Field>
            <LibraryFacetFilters entries={catalogEntries} filters={fileFilters} onChange={setFileFilters} />
            <Button appearance="subtle" onClick={resetFilters}>重置筛选</Button>
          </PopoverSurface>
        </Popover>
        {categories.length > 0 ? (
          <Select
            aria-label="按论文分类筛选"
            className="library-category-filter"
            onChange={(event) => setSelectedCategory(event.currentTarget.value)}
            size="small"
            value={selectedCategory}
          >
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Select>
        ) : null}
      </div>
      {hasFilters ? <div className="library-active-filters" role="status">筛选结果：{filteredIds?.size ?? 0} 个资产
        <Button appearance="subtle" size="small" onClick={() => { resetFilters(); setSearch(""); }}>清除筛选</Button></div> : null}
      <p className="library-drag-help">将文件拖到目录名称上导入；拖动库内条目可整理位置。</p>
      {message || fileLibrary?.message ? <div aria-live="polite" className="library-resource-action-message">{message || fileLibrary?.message}</div> : null}

      <section aria-label="本地文献库" className={`library-section${dropHover?.key === dropKey("local") ? dropHover.allowed ? " is-drop-target" : " is-drop-blocked" : ""}`}
        onDragEnter={(event) => hoverTarget(event, "local")} onDragOver={(event) => hoverTarget(event, "local")} onDragLeave={(event) => leaveTarget(event, "local")} onDrop={(event) => void dropOnTarget(event, "local")}>
        <SectionHeader
          actions={<>
            {iconAction("新建本地目录", <FolderAddRegular />, () => openCreateFolderDialog("local"), !localLibrarySnapshot)}
            {iconAction(fileLibrary ? "导入文件" : "导入 PDF", <AddRegular />, openLocalPdfPicker, fileLibrary ? fileLibrary.pending : !localLibrarySnapshot)}
            {iconAction("从 Zotero 导出目录导入 PDF", <FolderOpenRegular />, () => zoteroDirectoryInputRef.current?.click(), !localLibrarySnapshot)}
            {iconAction("刷新本地文献库", <ArrowClockwiseRegular />, () => void onRefreshLocalLibrary?.())}
          </>}
          count={localCount}
          expanded={!collapsedSections.includes("local")}
          icon={<FolderRegular />}
          onToggle={() => toggleSection("local")}
          title="本地文献库"
        />
        <p className="library-scope-description">本机文件 · 保存在此设备</p>
        <LiteratureHydrationStatus hydration={literatureHydration} />
        {dropHover?.key === dropKey("local") ? <div className="library-drop-feedback" role="status">{dropHover.label}</div> : null}
        <input
          accept={fileLibrary ? undefined : ".pdf,application/pdf"}
          aria-label="选择文献库文件"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            setMessage(`正在导入 ${files.length} 个文件...`);
            const targetFolderPath = localImportTargetPathRef.current ?? localLibrarySnapshot?.rootPath;
            localImportTargetPathRef.current = undefined;
            void Promise.resolve(fileLibrary ? fileLibrary.onImport(files, targetFolderPath) : onAddDroppedPdfFiles?.(files, targetFolderPath))
              .then(async () => {
                await onRefreshLocalLibrary?.();
                setMessage(fileLibrary ? "" : `已导入 ${files.length} 个 PDF。`);
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
                {renderTree("local", localTree, fileLibrary?.entries.some((entry) => entry.format !== "pdf" && (!filteredIds || filteredIds.has(entry.id))) ? "" : query ? "没有匹配的本地文件" : "本地文献库为空")}
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
            {fileLibrary ? <LibraryFileList onEditMetadata={setMetadataEditorEntry} access={fileLibrary} query={search} category={selectedCategory} filters={fileFilters} rootEntries={rootFileIds} /> : null}
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
        <p className="library-scope-description">个人云收藏 · 当前账号的云端副本，未因此发布到 Intuecho</p>
        {!collapsedSections.includes("collection") ? (
          <div className="library-section-content">
            {!accountSessionAvailable ? (
              <button className="library-inline-button" onClick={onLoginRequired} type="button">登录</button>
            ) : collection.status === "error" ? (
              <><ErrorState message={collection.message} onRetry={() => void collection.refresh()} /><p className="library-scope-description">仅云端收藏受影响，本地阅读仍可继续。</p></>
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
          actions={<>
            {iconAction("刷新推荐", <ArrowClockwiseRegular />, () => onRefreshRecommendations?.(), !(accountSessionAvailable || localRecommendations) || recommendationPending || !onRefreshRecommendations)}
            {iconAction("清除推荐缓存", <DeleteDismissRegular />, onClearRecommendations, !(accountSessionAvailable || localRecommendations))}
          </>}
          count={recommendationItems.length}
          expanded={!collapsedSections.includes("recommendation")}
          icon={<LightbulbRegular />}
          onToggle={() => toggleSection("recommendation")}
          title="关联推荐"
        />
        {!collapsedSections.includes("recommendation") ? (
          <div className="library-section-content">
            {(accountSessionAvailable || localRecommendations) ? (
              <RecommendationStyleControl compact
                onChange={onRecommendationStyleChange}
                value={recommendationStyle}
              />
            ) : null}
            {(accountSessionAvailable || localRecommendations) && recommendationPending ? (
              <div className="library-recommendation-message loading" role="status">
                {recommendationItems.length > 0 ? "正在更新推荐，仍可浏览已有结果…" : "正在获取推荐…"}
              </div>
            ) : null}
            {!(accountSessionAvailable || localRecommendations) ? (
              <button className="library-inline-button" onClick={onLoginRequired} type="button">登录</button>
            ) : recommendationItems.length === 0 ? (
              !recommendationPending ? <div className="library-empty-collection">{recommendationMessage || "暂无关联推荐"}</div> : null
            ) : (
              <RecommendationList service={recommendationService} items={recommendationItems} selectedId={selectedRecommendationId}
                pendingIds={pendingNodeIds} canSave={localRecommendations || Boolean(collection.tree)}
                onInspect={onInspectRecommendation}
                onOpen={onOpenRecommendation}
                onSave={(item) => void saveRecommendation(item)} onDismiss={onDismissRecommendation} />
            )}
            {localRecommendations && recommendationItems.length > 0 && !recommendationPending && recommendationMessage ? <p role="status" className="library-recommendation-message">{recommendationMessage}</p> : null}
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
        <p className="library-scope-description">组织文献 · 访问和下载遵循当前组织权限</p>
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
      {metadataEditorEntry ? <LibraryMetadataEditor key={metadataEditorEntry.id} entry={metadataEditorEntry}
        onSave={submitMetadataEditor} onClose={() => setMetadataEditorEntry(null)} /> : null}
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
