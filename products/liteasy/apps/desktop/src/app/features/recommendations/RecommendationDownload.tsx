import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import type { LocalLibrarySnapshot } from "../library/localLibrary.types";
import { displayPath } from "../resource-filesystem/displayPath";
import type { RecommendationDownloadOptions, RecommendationItem } from "./recommendation.types";

export type RecommendationLocations = Pick<LocalLibrarySnapshot, "rootPath" | "folders">;
export type DownloadRecommendation = (item: RecommendationItem, options?: RecommendationDownloadOptions) => Promise<string>;

export function RecommendationDownload({ item, locations, onDownload }: {
  item: RecommendationItem; locations?: RecommendationLocations | null; onDownload: DownloadRecommendation;
}) {
  const task = useRef<AbortController>();
  useEffect(() => () => task.current?.abort(), []);
  const [target, setTarget] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return <section className="recommendation-download" aria-label="保存推荐论文">
    {locations ? <>
      <label>保存到<OptionPicker aria-label="论文保存目录" value={String(target ?? "")} disabled={busy} onValueChange={nextValue => { setTarget(nextValue); setFolder(""); }} options={[{ value: String(""), label: String("\u6587\u732E\u5E93 / Download\uFF08\u9ED8\u8BA4\uFF09") }, { value: String(locations.rootPath), label: String("\u6587\u732E\u5E93\u6839\u76EE\u5F55") }, ...([...locations.folders].sort((a, b) => a.path.localeCompare(b.path)).map((entry) => ({ value: String(entry.path), label: String(displayPath(entry.path).replace(displayPath(locations.rootPath).replace(/\/$/, "") + "/", "文献库 / ")) })))]} /></label>
      {target ? <Input aria-label="新建论文保存子目录" placeholder="在所选目录下新建文件夹（可选）" value={folder} disabled={busy}
        onChange={(_, data) => setFolder(data.value)} /> : null}
    </> : null}
    <Button appearance="primary" icon={<ArrowDownloadRegular />} disabled={busy} onClick={() => {
      task.current = new AbortController();
      setBusy(true); setFailed(false); setMessage("正在查找可用全文并下载 PDF…");
      void onDownload(item, { targetFolderPath: target || undefined, newFolderName: folder.trim() || undefined, signal: task.current.signal,
        onProgress: ({ received, total }) => setMessage(`已接收 ${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ""}`) })
        .then(setMessage, (error: unknown) => { setFailed(true); setMessage(error instanceof Error ? error.message : "下载失败，请重试。"); })
        .finally(() => setBusy(false));
    }}>{busy ? "正在下载…" : "下载 PDF 并保存"}</Button>
    {busy ? <Button appearance="subtle" onClick={() => task.current?.abort()}>取消下载</Button> : null}
    <p className="recommendation-muted">自动查找论文网站与开放全文源，下载后保存到本地文献库。</p>
    {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
  </section>;
}
