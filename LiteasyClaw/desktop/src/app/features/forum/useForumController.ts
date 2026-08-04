import { useCallback, useRef } from "react";
import { createForumClient, openForumDraft, type ForumClient } from "./forumClient";
import type { ForumContext, ForumDraftUpdate, ForumFeedQuery } from "./forum.types";

export function useForumController() {
  const clientRef = useRef<ForumClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createForumClient();
  }

  const createDraftAndOpen = useCallback(async (context: ForumContext) => {
    // Reserve the browser target during the click event so popup blockers do not
    // reject the forum page after the draft request resolves.
    let pendingWindow: Window | null = null;
    try {
      pendingWindow = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
      if (pendingWindow) {
        pendingWindow.document.title = "论坛";
        pendingWindow.document.body.textContent = "正在准备论坛发布页…";
      }
    } catch {
      // Tauri or a strict browser may reject window creation; the URL fallback below still runs.
    }
    try {
      const { draftId } = await clientRef.current!.createContextualDraft(context);
      if (pendingWindow) {
        const webBaseUrl = import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174";
        pendingWindow.location.href = `${webBaseUrl.replace(/\/$/, "")}/?draft=${encodeURIComponent(draftId)}`;
      } else {
        openForumDraft(draftId);
      }
    } catch (error) {
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.document.title = "论坛暂时无法打开";
        pendingWindow.document.body.textContent = error instanceof Error ? error.message : "论坛暂时无法打开，请返回 Liteasy 重试。";
      }
      throw error;
    }
  }, []);
  const createDraft = useCallback(async (context: ForumContext, update?: ForumDraftUpdate) => {
    const { draftId } = await clientRef.current!.createContextualDraft(context);
    if (!update?.body.trim()) {
      return { draftId };
    }
    try {
      await clientRef.current!.updateDraft(draftId, update);
      return { draftId };
    } catch (error) {
      await clientRef.current!.discardDraft(draftId).catch(() => undefined);
      throw error;
    }
  }, []);
  const loadFeed = useCallback(async (query: ForumFeedQuery) => (await clientRef.current!.feed(query)).posts, []);

  return { createDraft, createDraftAndOpen, loadFeed };
}
