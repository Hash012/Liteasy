import type { ForumContext, ForumDraftUpdate, ForumFeedQuery, ForumPost } from "./forum.types";

type ForumClientOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  getSessionId?: () => string | undefined;
  sessionId?: string;
};

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function createForumClient({
  apiBaseUrl = import.meta.env.VITE_FORUM_API_URL ?? "http://127.0.0.1:4040",
  fetchImpl = fetch,
  getSessionId,
  sessionId
}: ForumClientOptions = {}) {
  function authenticationHeaders(required: boolean): Record<string, string> {
    const currentSessionId = getSessionId?.() ?? sessionId;
    if (!currentSessionId && required) {
      throw new Error("请先登录 Liteasy 再打开论坛发布页。");
    }
    return required && currentSessionId ? { Authorization: `Bearer ${currentSessionId}` } : {};
  }

  async function request<T>(path: string): Promise<T> {
    const response = await fetchImpl(joinUrl(apiBaseUrl, path), {
      headers: authenticationHeaders(false)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "论坛请求失败");
    }
    return body as T;
  }

  return {
    async createDraftHandoff(context: ForumContext, update?: ForumDraftUpdate) {
      const response = await fetchImpl(joinUrl(apiBaseUrl, "/v1/integrations/desktop/annotation-handoffs"), {
        body: JSON.stringify({
          ...context,
          body: update?.body ?? context.body ?? "",
          tags: update?.tags ?? context.tags ?? [],
          shareToPlaza: context.shareToPlaza ?? true,
          visibility: context.visibility ?? "public"
        }),
        headers: { "Content-Type": "application/json", ...authenticationHeaders(true) },
        method: "POST"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "论坛交接创建失败");
      }
      return body as { expiresAt: string; handoffId: string };
    },
    feed(query: ForumFeedQuery) {
      const params = new URLSearchParams({
        limit: "3",
        literatureIdentityKind: query.paperIdentity.kind,
        literatureIdentityValue: query.paperIdentity.value,
        sort: "recommended"
      });
      return request<{ annotations: Array<{
        author: { name: string };
        body: string;
        createdAt: string;
        helpful: number;
        id: string;
        tags: Array<{ name: string }>;
        viewerSaved: boolean;
      }> }>(`/v1/plaza?${params.toString()}`).then(({ annotations }) => ({
        posts: annotations.map((annotation) => ({
          author_name: annotation.author.name,
          body: annotation.body,
          created_at: annotation.createdAt,
          helpful: annotation.helpful,
          id: annotation.id,
          tags: annotation.tags.map((tag) => tag.name),
          title: null,
          viewer_saved: annotation.viewerSaved,
          work_id: null
        }))
      }));
    }
  };
}

export type ForumClient = ReturnType<typeof createForumClient>;

export function openForumHandoff(handoffId: string, webBaseUrl = import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174") {
  const url = `${webBaseUrl.replace(/\/$/, "")}/?handoff=${encodeURIComponent(handoffId)}`;
  window.location.assign(url);
}
