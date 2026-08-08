import { useEffect, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { FolderOpenRegular, SaveRegular } from "@fluentui/react-icons";

type LibraryLocationPanelProps = {
  loadLegacyRoots?: () => Promise<string[]>;
  onBackup?: (destinationDirectory: string) => Promise<string>;
  onChangeRoot?: (nextRootPath: string) => Promise<void>;
  onOpenInFileManager?: () => Promise<void>;
  onSelectLegacyRoot?: (legacyRootPath: string) => Promise<void>;
  rootPath?: string | null;
};

export function LibraryLocationPanel({
  loadLegacyRoots,
  onBackup,
  onChangeRoot,
  onOpenInFileManager,
  onSelectLegacyRoot,
  rootPath
}: LibraryLocationPanelProps) {
  const [requestedRootPath, setRequestedRootPath] = useState("");
  const [backupDirectory, setBackupDirectory] = useState("");
  const [message, setMessage] = useState("");
  const [backingUp, setBackingUp] = useState(false);
  const [moving, setMoving] = useState(false);
  const [legacyRoots, setLegacyRoots] = useState<string[]>([]);

  useEffect(() => {
    if (!loadLegacyRoots) return;
    let active = true;
    void loadLegacyRoots()
      .then((roots) => {
        if (active) setLegacyRoots([...new Set(roots)].filter((path) => path !== rootPath));
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "无法检查旧文献库目录。");
      });
    return () => {
      active = false;
    };
  }, [loadLegacyRoots, rootPath]);

  async function changeRoot(candidatePath?: string) {
    const nextRootPath = candidatePath?.trim() || requestedRootPath.trim();
    if (!nextRootPath || !onChangeRoot) {
      return;
    }
    setMoving(true);
    setMessage("正在迁移文献库，请不要关闭应用。");
    try {
      await onChangeRoot(nextRootPath);
      setRequestedRootPath("");
      setLegacyRoots((current) => current.filter((path) => path !== nextRootPath));
      setMessage("文献库已迁移到新目录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "迁移文献库失败。");
    } finally {
      setMoving(false);
    }
  }

  async function backupLibrary() {
    const destinationDirectory = backupDirectory.trim();
    if (!destinationDirectory || !onBackup) return;
    setBackingUp(true);
    setMessage("正在创建并校验完整备份，请不要关闭应用。");
    try {
      const backupPath = await onBackup(destinationDirectory);
      setBackupDirectory("");
      setMessage(`完整备份已保存到 ${backupPath}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文献库备份失败。");
    } finally {
      setBackingUp(false);
    }
  }

  async function selectLegacyRoot(legacyRootPath: string) {
    if (!onSelectLegacyRoot) return;
    setMoving(true);
    setMessage("正在校验并选择旧文献库，请不要关闭应用。");
    try {
      await onSelectLegacyRoot(legacyRootPath);
      setLegacyRoots([]);
      setMessage("旧文献库已设为当前库；其他旧目录保持原样。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "选择旧文献库失败。");
    } finally {
      setMoving(false);
    }
  }

  if (!onBackup && !onChangeRoot && !onOpenInFileManager && !onSelectLegacyRoot) {
    return <p className="library-location-hint">桌面端才能管理本地文献库目录。</p>;
  }

  return (
    <div aria-label="本地文献库位置" className="library-location-panel">
      <p className="library-location-current">
        <span className="library-location-label">当前目录</span>
        <span className="library-location-path" title={rootPath ?? ""}>
          {rootPath || "尚未确定"}
        </span>
      </p>
      {onOpenInFileManager ? (
        <Button
          appearance="secondary"
          icon={<FolderOpenRegular />}
          onClick={() => {
            void onOpenInFileManager().catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : "无法打开文件管理器。");
            });
          }}
          size="small"
          type="button"
        >
          在文件管理器中打开
        </Button>
      ) : null}
      {legacyRoots.length > 0 && onSelectLegacyRoot ? (
        <div aria-label="检测到的旧文献库" className="library-location-move">
          <p className="library-location-hint">
            检测到多个旧版本遗留的本地库。请选择一个作为当前库；未选目录不会合并或删除。
          </p>
          {legacyRoots.map((path) => (
            <div className="library-location-current" key={path}>
              <span className="library-location-path" title={path}>{path}</span>
              <Button
                appearance="secondary"
                disabled={moving}
                onClick={() => void selectLegacyRoot(path)}
                size="small"
                type="button"
              >
                设为当前库
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {onBackup ? (
        <div className="library-location-move">
          <p className="library-location-hint">
            本地文献库不会自动云备份。完整备份包含 PDF、元数据、批注和回收站。
          </p>
          <Input
            aria-label="文献库备份保存目录完整路径"
            disabled={backingUp}
            onChange={(_event, data) => setBackupDirectory(data.value)}
            placeholder="备份保存目录的完整路径"
            size="small"
            value={backupDirectory}
          />
          <Button
            appearance="secondary"
            disabled={backingUp || backupDirectory.trim().length === 0}
            icon={<SaveRegular />}
            onClick={() => void backupLibrary()}
            size="small"
            type="button"
          >
            {backingUp ? "备份中…" : "导出完整备份"}
          </Button>
        </div>
      ) : null}
      {onChangeRoot ? (
        <div className="library-location-move">
          <Input
            aria-label="新的文献库根目录完整路径"
            disabled={moving}
            onChange={(_event, data) => setRequestedRootPath(data.value)}
            placeholder="粘贴新目录的完整路径"
            size="small"
            value={requestedRootPath}
          />
          <Button
            appearance="primary"
            disabled={moving || requestedRootPath.trim().length === 0}
            onClick={() => {
              void changeRoot();
            }}
            size="small"
            type="button"
          >
            {moving ? "迁移中…" : "移动文献库"}
          </Button>
          <p className="library-location-hint">
            PDF 本体、批注与全文快照会一起移动过去，不会留在原处造成文献库分裂。
          </p>
        </div>
      ) : null}
      {message ? <p aria-live="polite" className="library-location-message">{message}</p> : null}
    </div>
  );
}
