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
  Tab,
  TabList,
  Tooltip
} from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  DeleteRegular,
  DocumentBulletListRegular,
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
import "./artifactLibrary.css";

type ArtifactLibraryPaneProps = {
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

const artifactTypeLabels: Record<ArtifactType, string> = {
  comparison_table: "文献对比",
  layered_graph: "分层关系图",
  mindmap: "思维导图",
  ppt: "演示文稿大纲",
  skill_doc: "Skill 文档",
  thin_reading: "薄读",
  tree: "树形分析"
};

const formatLabels: Record<ArtifactExportRecord["format"], string> = {
  html: "HTML",
  markdown: "Markdown",
  pdf: "PDF"
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

function displayDate(value?: string) {
  if (!value) return "日期未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleDateString("zh-CN");
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ArtifactLibraryPane({
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
  const searchQuery = normalized(query);

  const filteredArtifacts = useMemo(() => artifactCatalog.filter((artifact) => {
    if (!searchQuery) return true;
    return normalized([
      artifact.title,
      artifactTypeLabels[artifact.type],
      ...(artifact.papers ?? []).map((paper) => paper.title)
    ].join(" ")).includes(searchQuery);
  }), [artifactCatalog, searchQuery]);

  const filteredExports = useMemo(() => exportRecords.filter((record) => {
    if (!searchQuery) return true;
    const path = record.location === "desktop" ? record.path : "";
    return normalized([
      record.title,
      record.fileName,
      formatLabels[record.format],
      path
    ].join(" ")).includes(searchQuery);
  }), [exportRecords, searchQuery]);

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
        {activeView === "exported" ? (
          <Tooltip content="刷新导出记录" relationship="label">
            <Button
              appearance="subtle"
              aria-label="刷新导出记录"
              icon={<ArrowClockwiseRegular />}
              onClick={() => void onRefreshExports()}
              size="small"
            />
          </Tooltip>
        ) : null}
      </div>
      <Input
        aria-label="搜索产物"
        className="artifact-library-search"
        contentBefore={<SearchRegular aria-hidden="true" />}
        onChange={(_, data) => setQuery(data.value)}
        placeholder="搜索产物"
        type="search"
        value={query}
      />

      {activeView === "saved" ? (
        <SavedArtifactList
          accountAvailable={accountAvailable}
          artifacts={filteredArtifacts}
          loadState={artifactCatalogLoadState}
          onDelete={(artifact) => {
            setDialogError(undefined);
            setDeleteTarget(artifact);
          }}
          onOpen={onOpenArtifact}
          onRename={beginRename}
          onRetry={onReloadArtifactCatalog}
          queryActive={Boolean(searchQuery)}
        />
      ) : (
        <ExportRecordList
          error={exportError}
          onOpen={onOpenExport}
          onRemove={onRemoveExport}
          onRetry={onRefreshExports}
          onReveal={onRevealExport}
          queryActive={Boolean(searchQuery)}
          records={filteredExports}
          status={exportStatus}
        />
      )}

      {renameTarget ? <Dialog
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open && !dialogPending) setRenameTarget(null);
        }}
        open
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
      </Dialog> : null}

      {deleteTarget ? <Dialog
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open && !dialogPending) setDeleteTarget(null);
        }}
        open
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
      </Dialog> : null}
    </section>
  );
}

function SavedArtifactList({
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
    const frame = window.requestAnimationFrame(() => {
      setPendingAction(null);
      if (pendingAction.kind === "rename") {
        onRename(pendingAction.artifact);
        return;
      }
      onDelete(pendingAction.artifact);
    });
    return () => window.cancelAnimationFrame(frame);
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
      {artifacts.map((artifact) => (
        <li className="artifact-library-row" key={artifact.artifactId}>
          <Button
            appearance="transparent"
            aria-label={`打开产物：${artifact.title}`}
            className="artifact-library-row-main"
            icon={<DocumentBulletListRegular />}
            onClick={() => onOpen(artifact.artifactId)}
          >
            <span className="artifact-library-row-copy">
              <span className="artifact-library-title">{artifact.title}</span>
              <span className="artifact-library-meta">
                {artifactTypeLabels[artifact.type]} · {displayDate(artifact.createdAt)}
              </span>
              {artifact.papers?.length ? (
                <span className="artifact-library-source">
                  {artifact.papers.map((paper) => paper.title).join("；")}
                </span>
              ) : null}
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
                <MenuItem icon={<EditRegular />} onClick={() => scheduleDialog("rename", artifact)}>重命名</MenuItem>
                <MenuItem icon={<DeleteRegular />} onClick={() => scheduleDialog("delete", artifact)}>删除</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </li>
      ))}
    </ul>
  );
}

function ExportRecordList({
  error,
  onOpen,
  onRemove,
  onRetry,
  onReveal,
  queryActive,
  records,
  status
}: {
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
