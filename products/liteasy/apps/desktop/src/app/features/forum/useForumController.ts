import { useCallback, useRef } from "react";
import { createForumClient, type ForumClient } from "./forumClient";
import type { PublicationActorBinding } from "./publicationActorBinding";
import type { ForumFeedQuery } from "./forum.types";

export function useForumController(input: { getSessionId?: () => string | undefined; getActorBinding?: () => PublicationActorBinding | undefined; apiBaseUrl?: string } = {}) {
  const clientRef = useRef<ForumClient | null>(null);
  const endpointRef = useRef(input.apiBaseUrl);
  if (!clientRef.current || endpointRef.current !== input.apiBaseUrl) {
    endpointRef.current = input.apiBaseUrl;
    clientRef.current = createForumClient(input);
  }

  const loadFeed = useCallback(async (query: ForumFeedQuery) => (await clientRef.current!.feed(query)).posts, []);

  return { client: clientRef.current, loadFeed };
}
