import { ARTIFACT_CONTEXT_MIME } from "../object-transfer/contextTransfer";
import { ResourceLocationButton } from "../resource-filesystem/ResourceLocationButton";
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
  Spinner,
  Select,
  Tab,
  TabList,
  Tooltip
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  DeleteRegular,
  DocumentBulletListRegular,
  DocumentRegular,
  BookOpenRegular,
  EditRegular,
  FolderOpenRegular,
  MoreHorizontalRegular,
  OpenRegular,
  SearchRegular
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import type {
  ArtifactExportHistoryStatus,
  ArtifactExportRecord
} from "./artifactExport.types";
import type {
  ArtifactCatalogLoadState,
  ArtifactMutationOutcome,
  ArtifactTab,
  ArtifactType
} from "./artifact.types";
import { artifactDateValue, artifactSearchText, artifactTypeLabels, groupArtifactsByPaper, indexArtifactPapers, matchesArtifactPaper, normalizeArtifactSearch, unlinkedPaperFilter } from "./artifactLibraryIndex";
import "./artifactLibrary.css";

type ArtifactLibraryPaneProps = {
  activePaperId?: string | null;
  onOpenPaper?: (paperId: string) => void;
  availablePaperIds?: string[];
  accountAvailable: boolean;
  artifactCatalog: ArtifactTab[];
  artifactCatalogLoadState: ArtifactCatalogLoadState;
  exportError?: string;
  exportRecords: ArtifactExportRecord[];
  exportStatus: ArtifactExportHistoryStatus;
  onDeleteArtifact: (
    artifactId: string
  ) => ArtifactMutationOutcome | Promise<ArtifactMutationOutcome>;
  onOpenArtifact: (artifactId: string) => unknown;
  onOpenExport: (recordId: string) => unknown | Promise<unknown>;
  onReloadArtifactCatalog: () => unknown | Promise<unknown>;
  onRefreshExports: () => unknown | Promise<unknown>;
  onRemoveExport: (recordId: string) => unknown | Promise<unknown>;
  onRenameArtifact: (
    artifactId: string,
    name: string
  ) => ArtifactMutationOutcome | Promise<ArtifactMutationOutcome>;
  onRevealExport: (recordId: string) => unknown | Promise<unknown>;
};

const formatLabels: Record<ArtifactExportRecord["format"], string> = {
  html: "HTML",
  markdown: "Markdown",
  pdf: "PDF"
};

function displayDate(value?: string) {
  if (!value) return "日期未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleDateString("zh-CN");
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ArtifactLibraryPane({
  activePaperId,
  onOpenPaper,
  availablePaperIds = [],
  accountAvailable,
  artifactCatalog,
  artifactCatalogLoadState,
  exportError,
  exportRecords,
  exportStatus,
  onDeleteArtifact,
  onOpenArtifact,
  onOpenExport,
  onReloadArtifactCatalog,
  onRefreshExports,
  onRemoveExport,
  onRenameArtifact,
  onRevealExport
}: ArtifactLibraryPaneProps) {
  const [activeView, setActiveView] = useState<"exported" | "saved">("saved");
  const [deleteTarget, setDeleteTarget] = useState<ArtifactTab | null>(null);
  const [dialogError, setDialogError] = useState<string>();
  const [dialogPending, setDialogPending] = useState(false);
  const [query, setQuery] = useState("");
  const [renameName, setRenameName] = useState("");
  const [renameTarget, setRenameTarget] = useState<ArtifactTab | null>(null);
  const [paperFilter, setPaperFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState("recent");
  const searchQuery = normalizeArtifactSearch(query);
  const visibleCatalog = useMemo(() => accountAvailable ? artifactCatalog : [], [accountAvailable, artifactCatalog]);
  const catalogById = useMemo(() => new Map(visibleCatalog.map((artifact) => [artifact.artifactId, artifact])), [visibleCatalog]);
  const papers = useMemo(() => indexArtifactPapers(visibleCatalog), [visibleCatalog]);
  const filterActive = Boolean(searchQuery || paperFilter || typeFilter);
  const filteredArtifacts = useMemo(() => visibleCatalog.filter((artifact) =>
    matchesArtifactPaper(artifact, paperFilter) && (!typeFilter || artifact.type === typeFilter) &&
    normalizeArtifactSearch(artifactSearchText(artifact)).includes(searchQuery)
  ).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : artifactDateValue(b.createdAt) - artifactDateValue(a.createdAt)),
  [visibleCatalog, paperFilter, typeFilter, searchQuery, sort]);
  const filteredExports = useMemo(() => exportRecords.filter((record) => {
    const artifact = catalogById.get(record.artifactId);
    return matchesArtifactPaper(artifact, paperFilter) && (!typeFilter || artifact?.type === typeFilter) &&
      normalizeArtifactSearch([record.title, record.fileName, formatLabels[record.format],
        record.location === "desktop" ? record.path : "", artifact ? artifactSearchText(artifact) : ""].join(" ")).includes(searchQuery);
  }).sort((a, b) => sort === "title" ? a.fileName.localeCompare(b.fileName) : artifactDateValue(b.exportedAt) - artifactDateValue(a.exportedAt)),
  [exportRecords, catalogById, paperFilter, typeFilter, searchQuery, sort]);

  function beginRename(artifact: ArtifactTab) {
    setDialogError(undefined);
    setRenameName(artifact.title);
    setRenameTarget(artifact);
  }

  async function submitRename() {
    if (!renameTarget || !renameName.trim()) return;
    setDialogPending(true);
    setDialogError(undefined);
    try {
      const outcome = await onRenameArtifact(renameTarget.artifactId, renameName.trim());
      if (outcome.status === "error") {
        setDialogError(outcome.message);
        return;
      }
      setRenameTarget(null);
    } catch (error) {
      setDialogError(messageFrom(error));
    } finally {
      setDialogPending(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDialogPending(true);
    setDialogError(undefined);
    try {
      const outcome = await onDeleteArtifact(deleteTarget.artifactId);
      if (outcome.status === "error") {
        setDialogError(outcome.message);
        return;
      }
      setDeleteTarget(null);
    } catch (error) {
      setDialogError(messageFrom(error));
    } finally {
      setDialogPending(false);
    }
  }

  return (
    <section aria-label="产物库" className="artifact-library-pane">
      <div className="artifact-library-toolbar">
        <TabList
          aria-label="产物库分类"
          onTabSelect={(_, data) => {
            const nextView = data.value as "exported" | "saved";
            setActiveView(nextView);
            if (nextView === "exported" && activeView !== "exported") {
              void onRefreshExports();
            }
          }}
          selectedValue={activeView}
          size="small"
        >
          <Tab value="saved">已保存</Tab>
          <Tab value="exported">已导出</Tab>
        </TabList>
        <Tooltip content={activeView === "saved" ? "刷新已保存产物" : "刷新导出记录"} relationship="label">
          <Button appearance="subtle" aria-label={activeView === "saved" ? "刷新已保存产物" : "刷新导出记录"}
            icon={<ArrowClockwiseRegular />} size="small"
            onClick={() => void (activeView === "saved" ? onReloadArtifactCatalog() : onRefreshExports())} />
        </Tooltip>
      </div>
      <div className="artifact-library-filters">
      <Input
        aria-label="搜索产物"
        className="artifact-library-search"
        contentBefore={<SearchRegular aria-hidden="true" />}
        onChange={(_, data) => setQuery(data.value)}
        placeholder="搜索名称、论文、作者或 DOI"
        type="search"
        value={query}
      />

      <Select aria-label="按来源论文筛选" value={paperFilter} onChange={(_, data) => setPaperFilter(data.value)} size="small">
        <option value="">全部来源论文</option>
        {papers.map(({ paper, count }) => <option key={paper.id} value={paper.id}>{paper.title}（{count}）</option>)}
        <option value={unlinkedPaperFilter}>未关联论文</option>
      </Select>
      <div className="artifact-library-filter-row">
        <Select aria-label="按产物类型筛选" value={typeFilter} onChange={(_, data) => setTypeFilter(data.value)} size="small">
          <option value="">全部类型</option>
          {Object.entries(artifactTypeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </Select>
        <Select aria-label="产物排序" value={sort} onChange={(_, data) => setSort(data.value)} size="small">
          <option value="recent">最近生成</option><option value="title">名称排序</option>
        </Select>
      </div>
      <div className="artifact-library-filter-summary">
        <span role="status">{activeView === "saved" ? filteredArtifacts.length : filteredExports.length} 项</span>
        {activePaperId && papers.some(({ paper }) => paper.id === activePaperId) ? <Button size="small" appearance="subtle"
          aria-pressed={paperFilter === activePaperId} icon={<BookOpenRegular />}
          onClick={() => setPaperFilter(paperFilter === activePaperId ? "" : activePaperId)}>当前论文</Button> : null}
        {filterActive ? <Button size="small" appearance="subtle" onClick={() => { setQuery(""); setPaperFilter(""); setTypeFilter(""); }}>清除筛选</Button> : null}
      </div>
      </div>
      <div className="artifact-library-results">
      {activeView === "saved" ? (
        <SavedArtifactList
          accountAvailable={accountAvailable}
          artifacts={filteredArtifacts}
          paperFilter={paperFilter}
          onFilterPaper={setPaperFilter}
          onOpenPaper={onOpenPaper}
          availablePaperIds={availablePaperIds}
          loadState={artifactCatalogLoadState}
          onDelete={(artifact) => {
            setDialogError(undefined);
            setDeleteTarget(artifact);
          }}
          onOpen={onOpenArtifact}
          onRename={beginRename}
          onRetry={onReloadArtifactCatalog}
          queryActive={filterActive}
        />
      ) : (
        <ExportRecordList
          catalogById={catalogById}
          onFilterPaper={setPaperFilter}
          onOpenArtifact={onOpenArtifact}
          error={exportError}
          onOpen={onOpenExport}
          onRemove={onRemoveExport}
          onRetry={onRefreshExports}
          onReveal={onRevealExport}
          queryActive={filterActive}
          records={filteredExports}
          status={exportStatus}
        />
      )}

      </div>

      <Dialog
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open && !dialogPending) setRenameTarget(null);
        }}
        open={renameTarget !== null}
      >
        <DialogSurface aria-label="重命名产物">
          <form onSubmit={(event) => {
            event.preventDefault();
            void submitRename();
          }}>
            <DialogBody>
              <DialogTitle>重命名产物</DialogTitle>
              <DialogContent className="artifact-library-dialog-content">
                <Input
                  aria-label="产物名称"
                  autoFocus
                  disabled={dialogPending}
                  onChange={(_, data) => setRenameName(data.value)}
                  value={renameName}
                />
                {dialogError ? <div className="artifact-library-error" role="alert">{dialogError}</div> : null}
              </DialogContent>
              <DialogActions>
                <Button disabled={dialogPending} onClick={() => setRenameTarget(null)} type="button">
                  取消
                </Button>
                <Button
                  appearance="primary"
                  disabled={dialogPending || !renameName.trim()}
                  type="submit"
                >
                  保存
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      <Dialog
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open && !dialogPending) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
      >
        <DialogSurface aria-label="删除产物">
          <DialogBody>
            <DialogTitle>删除产物</DialogTitle>
            <DialogContent className="artifact-library-dialog-content">
              <p>将从账号中删除“{deleteTarget?.title}”。此操作无法撤销。</p>
              {dialogError ? <div className="artifact-library-error" role="alert">{dialogError}</div> : null}
            </DialogContent>
            <DialogActions>
              <Button disabled={dialogPending} onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button
                appearance="primary"
                disabled={dialogPending}
                onClick={() => void confirmDelete()}
              >
                确认删除
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}

function SavedArtifactList({
  paperFilter, onFilterPaper, onOpenPaper, availablePaperIds,
  accountAvailable,
  artifacts,
  loadState,
  onDelete,
  onOpen,
  onRename,
  onRetry,
  queryActive
}: {
  accountAvailable: boolean;
  artifacts: ArtifactTab[];
  paperFilter: string;
  onFilterPaper: (paperId: string) => void;
  onOpenPaper?: (paperId: string) => void;
  availablePaperIds: string[];
  loadState: ArtifactCatalogLoadState;
  onDelete: (artifact: ArtifactTab) => void;
  onOpen: (artifactId: string) => unknown;
  onRename: (artifact: ArtifactTab) => void;
  onRetry: () => unknown;
  queryActive: boolean;
}) {
  const [openMenuArtifactId, setOpenMenuArtifactId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    artifact: ArtifactTab;
    kind: "delete" | "rename";
  } | null>(null);

  useEffect(() => {
    if (openMenuArtifactId !== null || pendingAction === null) return;
    // Finish the menu's click and focus restoration before mounting another dismissable layer.
    const frame = requestAnimationFrame(() => {
      setPendingAction(null);
      if (pendingAction.kind === "rename") onRename(pendingAction.artifact);
      else onDelete(pendingAction.artifact);
    });
    return () => cancelAnimationFrame(frame);
  }, [onDelete, onRename, openMenuArtifactId, pendingAction]);

  function scheduleDialog(kind: "delete" | "rename", artifact: ArtifactTab) {
    setPendingAction({ artifact, kind });
    setOpenMenuArtifactId(null);
  }

  if (!accountAvailable) {
    return <div className="artifact-library-empty">登录后查看账号中保存的产物</div>;
  }
  if (loadState.status === "loading" || loadState.status === "idle") {
    return (
      <div className="artifact-library-loading">
        <Spinner aria-label="正在加载已保存产物" size="tiny" />
      </div>
    );
  }
  if (loadState.status === "error") {
    return (
      <div className="artifact-library-error" role="alert">
        <span>{loadState.message ?? "加载已保存产物失败。"}</span>
        <Button
          appearance="subtle"
          icon={<ArrowClockwiseRegular />}
          onClick={() => void onRetry()}
          size="small"
        >
          重试
        </Button>
      </div>
    );
  }
  if (!artifacts.length) {
    return (
      <div className="artifact-library-empty">
        {queryActive ? "没有匹配的已保存产物" : "暂无已保存产物"}
      </div>
    );
  }
  return (
    <ul aria-label="已保存产物" className="artifact-library-list">
      {groupArtifactsByPaper(artifacts, paperFilter).map((group) => <li className="artifact-library-group" key={group.id}>
        <details open>
          <summary title={group.title}><DocumentRegular aria-hidden="true" /><span>{group.title}</span><small>{group.artifacts.length}</small></summary>
          <ul className="artifact-library-list">
      {group.artifacts.map((artifact) => (
        <li className="artifact-library-row artifact-library-saved-row" key={artifact.artifactId}>
          <Button
            appearance="transparent"
            aria-label={`打开产物：${artifact.title}`}
            className="artifact-library-row-main"
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(ARTIFACT_CONTEXT_MIME, artifact.artifactId);
              event.dataTransfer.setData("text/plain", artifact.title);
            }}
            icon={<DocumentBulletListRegular />}
            onClick={() => onOpen(artifact.artifactId)}
          >
            <span className="artifact-library-row-copy">
              <span className="artifact-library-title">{artifact.title}</span>
              <span className="artifact-library-meta">
                {artifactTypeLabels[artifact.type]} · {displayDate(artifact.createdAt)}
              </span>
            </span>
          </Button>
          <Menu
            onOpenChange={(_, data) => {
              setOpenMenuArtifactId(data.open ? artifact.artifactId : null);
            }}
            open={openMenuArtifactId === artifact.artifactId}
            positioning="below-end"
          >
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content={`产物操作：${artifact.title}`} relationship="label">
                <Button
                  appearance="subtle"
                  aria-label={`产物操作：${artifact.title}`}
                  icon={<MoreHorizontalRegular />}
                  size="small"
                />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<OpenRegular />} onClick={() => onOpen(artifact.artifactId)}>打开</MenuItem>
                {onOpenPaper ? artifact.papers?.filter((paper) => availablePaperIds.includes(paper.id)).map((paper) =>
                  <MenuItem key={paper.id} icon={<BookOpenRegular />} onClick={() => onOpenPaper(paper.id)}>阅读来源：{paper.title}</MenuItem>
                ) : null}
                <MenuItem icon={<EditRegular />} onClick={() => scheduleDialog("rename", artifact)}>重命名</MenuItem>
                <MenuItem icon={<DeleteRegular />} onClick={() => scheduleDialog("delete", artifact)}>删除</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
          <ResourceLocationButton target={{ kind: "artifact", artifactId: artifact.artifactId }} />
          {(artifact.papers?.length ?? 0) > 1 ? <ArtifactSourceLinks artifact={artifact} onFilterPaper={onFilterPaper} /> : null}
        </li>
      ))}
          </ul>
        </details>
      </li>)}
    </ul>
  );
}

function ExportRecordList({
  catalogById, onFilterPaper, onOpenArtifact,
  error,
  onOpen,
  onRemove,
  onRetry,
  onReveal,
  queryActive,
  records,
  status
}: {
  catalogById: Map<string, ArtifactTab>;
  onFilterPaper: (paperId: string) => void;
  onOpenArtifact: (artifactId: string) => unknown;
  error?: string;
  onOpen: (recordId: string) => unknown;
  onRemove: (recordId: string) => unknown;
  onRetry: () => unknown;
  onReveal: (recordId: string) => unknown;
  queryActive: boolean;
  records: ArtifactExportRecord[];
  status: ArtifactExportHistoryStatus;
}) {
  if (status === "loading" && !records.length) {
    return <div className="artifact-library-loading"><Spinner aria-label="正在加载导出记录" size="tiny" /></div>;
  }
  if (status === "error" && !records.length) {
    return (
      <div className="artifact-library-error" role="alert">
        <span>{error ?? "加载导出记录失败。"}</span>
        <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={() => onRetry()} size="small">
          重试
        </Button>
      </div>
    );
  }
  if (!records.length) {
    return (
      <div className="artifact-library-empty">
        {queryActive ? "没有匹配的导出记录" : "暂无导出记录"}
      </div>
    );
  }
  return (
    <>
      {error ? <div className="artifact-library-inline-error" role="alert">{error}</div> : null}
      <ul aria-label="已导出产物" className="artifact-library-list">
        {records.map((record) => {
          const missing = record.location === "desktop" && record.status === "missing";
          return (
            <li className="artifact-library-row artifact-library-export-row" key={record.id}>
              <div className="artifact-library-export-copy">
                <span className="artifact-library-title">{record.fileName}</span>
                <span className="artifact-library-meta">
                  {record.title} · {formatLabels[record.format]} · {displayDate(record.exportedAt)}
                </span>
                <span className={`artifact-library-status${missing ? " is-missing" : ""}`}>
                  {record.location === "browser"
                    ? "由浏览器管理"
                    : missing ? "文件不可用" : "文件可用"}
                </span>
                <ArtifactSourceLinks artifact={catalogById.get(record.artifactId)} onFilterPaper={onFilterPaper} />
                {catalogById.has(record.artifactId) ? <Button appearance="subtle" size="small" className="artifact-library-original"
                  onClick={() => onOpenArtifact(record.artifactId)}>查看原产物</Button> : null}
                {record.location === "desktop" ? (
                  <span className="artifact-library-path" title={record.path}>{record.path}</span>
                ) : null}
              </div>
              <div className="artifact-library-actions">
                {record.location === "desktop" ? (
                  <>
                    <Tooltip content={`打开文件：${record.fileName}`} relationship="label">
                      <Button
                        appearance="subtle"
                        aria-label={`打开文件：${record.fileName}`}
                        disabled={missing}
                        icon={<OpenRegular />}
                        onClick={() => onOpen(record.id)}
                        size="small"
                      />
                    </Tooltip>
                    <Tooltip content={`在文件夹中显示：${record.fileName}`} relationship="label">
                      <Button
                        appearance="subtle"
                        aria-label={`在文件夹中显示：${record.fileName}`}
                        disabled={missing}
                        icon={<FolderOpenRegular />}
                        onClick={() => onReveal(record.id)}
                        size="small"
                      />
                    </Tooltip>
                  </>
                ) : null}
                <Tooltip content={`移除导出记录：${record.fileName}`} relationship="label">
                  <Button
                    appearance="subtle"
                    aria-label={`移除导出记录：${record.fileName}`}
                    icon={<DeleteRegular />}
                    onClick={() => onRemove(record.id)}
                    size="small"
                  />
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ArtifactSourceLinks({ artifact, onFilterPaper }: { artifact?: ArtifactTab; onFilterPaper: (paperId: string) => void }) {
  if (!artifact?.papers?.length) return null;
  return <div className="artifact-library-source-links" aria-label="来源论文">
    {artifact.papers.map((paper) => <Tooltip key={paper.id} content={`筛选此论文的产物：${paper.title}`} relationship="description">
      <button type="button" onClick={() => onFilterPaper(paper.id)} aria-label={`筛选来源：${paper.title}`}>
        <DocumentRegular aria-hidden="true" /><span>{paper.title}</span>
      </button>
    </Tooltip>)}
  </div>;
}
