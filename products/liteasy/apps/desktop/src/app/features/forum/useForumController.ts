import { useCallback, useRef } from "react";
import { createForumClient, type ForumClient } from "./forumClient";
import type { ForumFeedQuery } from "./forum.types";

export function useForumController(input: { getSessionId?: () => string | undefined } = {}) {
  const clientRef = useRef<ForumClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createForumClient({ getSessionId: input.getSessionId });
  }

  const loadFeed = useCallback(async (query: ForumFeedQuery) => (await clientRef.current!.feed(query)).posts, []);

  return { client: clientRef.current, loadFeed };
}
