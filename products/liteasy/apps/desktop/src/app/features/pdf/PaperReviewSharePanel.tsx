import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Popover, PopoverTrigger, PopoverSurface } from "@fluentui/react-components";
import { ShareRegular } from "@fluentui/react-icons";
import { IconAction } from "../../shared/ui/productPrimitives";
import { isTauri } from "@tauri-apps/api/core";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { paperReviewShareStore, type PaperReviewSource } from "./paperReviewShare";

type ShareInput = { scopeKey: string | null; ready: boolean; source: PaperReviewSource };
/** The reader owns this lifecycle; opening or hiding a toolbar never revokes a snapshot. */
export function usePaperReviewShare({ scopeKey, ready, source }: ShareInput) {
  const [ownId, setOwnId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const activeId = useSyncExternalStore(paperReviewShareStore.subscribe, paperReviewShareStore.getId);
  const accountKey = resolveLocalAccountKey();
  const latest = useRef({ scopeKey, ready, accountKey });
  latest.current = { scopeKey, ready, accountKey };
  const shared = Boolean(ownId && activeId === ownId);
  useEffect(() => {
    return () => { if (ownId) paperReviewShareStore.revoke(ownId); };
  }, [scopeKey, accountKey, ownId]);
  useEffect(() => {
    if (!ready && ownId) paperReviewShareStore.revoke(ownId);
  }, [ready, ownId]);
  function share() {
    try {
      const id = paperReviewShareStore.share(source, () =>
        latest.current.ready && latest.current.scopeKey === scopeKey &&
        latest.current.accountKey === accountKey && resolveLocalAccountKey() === accountKey);
      setOwnId(id);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "无法共享评论。"); }
  }
  return { ready, shared, error, share, stop: () => { if (ownId) paperReviewShareStore.revoke(ownId); } };
}
type ShareController = ReturnType<typeof usePaperReviewShare>;
export function PaperReviewShareStatus({ controller }: { controller: ShareController }) {
  return <>{controller.shared ? <div className="pdf-comment-share-status" role="status"><span>评论快照共享中 · 切换论文或关闭阅读器后停止共享。</span><Button size="small" onClick={controller.stop}>停止共享</Button></div> : null}
    {controller.error ? <p role="alert">{controller.error}</p> : null}</>;
}
export function PaperReviewShareControl({ controller, hostAvailable = isTauri() && !/Win/.test(navigator.platform) }: { controller: ShareController; hostAvailable?: boolean }) {
  return <Popover positioning={{ position: "below", align: "start", autoSize: "always" }}><PopoverTrigger disableButtonEnhancement>
    <IconAction label="共享评论" appearance="subtle" density="compact" icon={<ShareRegular />} />
  </PopoverTrigger><PopoverSurface className="pdf-comment-share-popover" aria-label="共享评论设置">
    <h3>共享评论</h3>
    <p>通过已连接的 ChatGPT 读取本篇论文中已保存的个人文字评论、引用、评论所在页的文本及已有 AI 回答。图片与手绘不包含在内。</p>
    {!hostAvailable ? <p>请使用 Linux/macOS 桌面版配置 Liteasy 评论连接。</p> : null}
    <Button size="small" disabled={!controller.ready || !hostAvailable} onClick={controller.share}>{controller.shared ? "更新共享快照" : "共享本篇评论"}</Button>
    {!controller.shared ? <p>共享前请先配置 Liteasy 评论连接；开启后仅共享本次快照，编辑评论后需更新。</p> : null}
  </PopoverSurface></Popover>;
}
export function PaperReviewSharePanel(props: ShareInput & { hostAvailable?: boolean }) {
  const controller = usePaperReviewShare(props);
  return <><PaperReviewShareControl controller={controller} hostAvailable={props.hostAvailable} /><PaperReviewShareStatus controller={controller} /></>;
}
