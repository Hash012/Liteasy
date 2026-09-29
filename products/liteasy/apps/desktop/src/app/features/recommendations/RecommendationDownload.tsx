import { useState } from "react";
import { Button, Input, Select } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import type { LocalLibrarySnapshot } from "../library/localLibrary.types";
import { displayPath } from "../resource-filesystem/displayPath";
import type { RecommendationDownloadOptions, RecommendationItem } from "./recommendation.types";

export type RecommendationLocations = Pick<LocalLibrarySnapshot, "rootPath" | "folders">;
export type DownloadRecommendation = (item: RecommendationItem, options?: RecommendationDownloadOptions) => Promise<string>;

export function RecommendationDownload({ item, locations, onDownload }: {
  item: RecommendationItem; locations?: RecommendationLocations | null; onDownload: DownloadRecommendation;
}) {
  const [target, setTarget] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return <section className="recommendation-download" aria-label="保存推荐论文">
    {locations ? <>
      <label>保存到<Select aria-label="论文保存目录" value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value); setFolder(""); }}>
        <option value="">文献库 / Download（默认）</option>
        <option value={locations.rootPath}>文献库根目录</option>
        {[...locations.folders].sort((a, b) => a.path.localeCompare(b.path)).map((entry) => <option value={entry.path} key={entry.path}>
          {displayPath(entry.path).replace(displayPath(locations.rootPath).replace(/\/$/, "") + "/", "文献库 / ")}
        </option>)}
      </Select></label>
      {target ? <Input aria-label="新建论文保存子目录" placeholder="在所选目录下新建文件夹（可选）" value={folder} disabled={busy}
        onChange={(_, data) => setFolder(data.value)} /> : null}
    </> : null}
    <Button appearance="primary" icon={<ArrowDownloadRegular />} disabled={busy} onClick={() => {
      setBusy(true); setFailed(false); setMessage("正在查找可用全文并下载 PDF…");
      void onDownload(item, { targetFolderPath: target || undefined, newFolderName: folder.trim() || undefined })
        .then(setMessage, (error: unknown) => { setFailed(true); setMessage(error instanceof Error ? error.message : "下载失败，请重试。"); })
        .finally(() => setBusy(false));
    }}>{busy ? "正在下载…" : "下载 PDF 并保存"}</Button>
    <p className="recommendation-muted">自动查找论文网站与开放全文源，下载后保存到本地文献库。</p>
    {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
  </section>;
}
