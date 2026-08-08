import { useCallback, useRef } from "react";
import { createForumClient, openForumHandoff, type ForumClient } from "./forumClient";
import type { ForumContext, ForumDraftUpdate, ForumFeedQuery } from "./forum.types";

export function useForumController(input: { getSessionId?: () => string | undefined } = {}) {
  const clientRef = useRef<ForumClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createForumClient({ getSessionId: input.getSessionId });
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
      const { handoffId } = await clientRef.current!.createDraftHandoff(context);
      if (pendingWindow) {
        const webBaseUrl = import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174";
        pendingWindow.location.href = `${webBaseUrl.replace(/\/$/, "")}/?handoff=${encodeURIComponent(handoffId)}`;
      } else {
        openForumHandoff(handoffId);
      }
    } catch (error) {
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.document.title = "论坛暂时无法打开";
        pendingWindow.document.body.textContent = error instanceof Error ? error.message : "论坛暂时无法打开，请返回 Liteasy 重试。";
      }
      throw error;
    }
  }, []);
  const createDraftHandoff = useCallback(async (context: ForumContext, update?: ForumDraftUpdate) =>
    clientRef.current!.createDraftHandoff(context, update), []);
  const loadFeed = useCallback(async (query: ForumFeedQuery) => (await clientRef.current!.feed(query)).posts, []);

  return { createDraftAndOpen, createDraftHandoff, loadFeed };
}
