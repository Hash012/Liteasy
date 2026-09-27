import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { paperReviewShareStore, type PaperReviewSource } from "./paperReviewShare";

export function PaperReviewSharePanel({ scopeKey, ready, source, hostAvailable = isTauri() && !/Win/.test(navigator.platform) }: {
  scopeKey: string | null;
  ready: boolean;
  source: PaperReviewSource;
  hostAvailable?: boolean;
}) {
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
  return <details className="pdf-annotation-options">
    <summary>ChatGPT 评论 Review</summary>
    <p>通过已连接的 ChatGPT 读取本篇论文中已保存的个人文字评论、引用、评论所在页的文本及已有 AI 回答。图片与手绘不包含在内。</p>
    {!hostAvailable ? <p>请使用 Linux/macOS 桌面版配置 Liteasy 评论连接。</p> : null}
    <Button size="small" disabled={!ready || !hostAvailable} onClick={share}>{shared ? "更新共享快照" : "共享本篇评论"}</Button>
    {shared ? <>
      <Button size="small" onClick={() => { if (ownId) paperReviewShareStore.revoke(ownId); }}>停止共享</Button>
      <p role="status">评论快照已共享。请在 ChatGPT 中选择 Liteasy 连接并说：“Review 我共享的论文中的全部评论”。切换论文或关闭阅读器后停止共享。</p>
    </> : <p>共享前请先配置 Liteasy 评论连接；开启后仅共享本次快照，编辑评论后需更新。</p>}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
