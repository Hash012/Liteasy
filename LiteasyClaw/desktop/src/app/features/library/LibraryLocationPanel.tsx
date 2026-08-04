import { useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { FolderOpenRegular } from "@fluentui/react-icons";

type LibraryLocationPanelProps = {
  onChangeRoot?: (nextRootPath: string) => Promise<void>;
  onOpenInFileManager?: () => Promise<void>;
  rootPath?: string | null;
};

export function LibraryLocationPanel({
  onChangeRoot,
  onOpenInFileManager,
  rootPath
}: LibraryLocationPanelProps) {
  const [requestedRootPath, setRequestedRootPath] = useState("");
  const [message, setMessage] = useState("");
  const [moving, setMoving] = useState(false);

  async function changeRoot() {
    const nextRootPath = requestedRootPath.trim();
    if (!nextRootPath || !onChangeRoot) {
      return;
    }
    setMoving(true);
    setMessage("正在迁移文献库，请不要关闭应用。");
    try {
      await onChangeRoot(nextRootPath);
      setRequestedRootPath("");
      setMessage("文献库已迁移到新目录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "迁移文献库失败。");
    } finally {
      setMoving(false);
    }
  }

  if (!onChangeRoot && !onOpenInFileManager) {
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
