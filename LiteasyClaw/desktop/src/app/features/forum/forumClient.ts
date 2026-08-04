import type { ForumContext, ForumDraftUpdate, ForumFeedQuery, ForumPost } from "./forum.types";

type ForumClientOptions = {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  userId?: string;
};

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function createForumClient({
  apiBaseUrl = import.meta.env.VITE_FORUM_API_URL ?? "http://127.0.0.1:4040",
  fetchImpl = fetch,
  userId = import.meta.env.VITE_FORUM_USER_ID ?? "demo-user"
}: ForumClientOptions = {}) {
  async function request<T>(path: string): Promise<T> {
    const response = await fetchImpl(joinUrl(apiBaseUrl, path), {
      headers: { "x-intuecho-user": userId }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "论坛请求失败");
    }
    return body as T;
  }

  return {
    async createContextualDraft(context: ForumContext) {
      const response = await fetchImpl(joinUrl(apiBaseUrl, "/v1/drafts/contextual"), {
        body: JSON.stringify(context),
        headers: { "Content-Type": "application/json", "x-intuecho-user": userId },
        method: "POST"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "论坛草稿创建失败");
      }
      return body as { draftId: string };
    },
    async updateDraft(draftId: string, update: ForumDraftUpdate) {
      const response = await fetchImpl(joinUrl(apiBaseUrl, `/v1/drafts/${encodeURIComponent(draftId)}`), {
        body: JSON.stringify({
          body: update.body,
          citationEnabled: update.citationEnabled,
          tags: update.tags ?? [],
          ...(update.title ? { title: update.title } : {})
        }),
        headers: { "Content-Type": "application/json", "x-intuecho-user": userId },
        method: "PUT"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "论坛草稿保存失败");
      }
      return body as { draftId: string; ok: true; updatedAt: string };
    },
    async discardDraft(draftId: string) {
      const response = await fetchImpl(joinUrl(apiBaseUrl, `/v1/drafts/${encodeURIComponent(draftId)}`), {
        headers: { "x-intuecho-user": userId },
        method: "DELETE"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "论坛草稿删除失败");
      }
      return body as { draftId: string; ok: true };
    },
    feed(query: ForumFeedQuery) {
      const params = new URLSearchParams({ workId: query.workId });
      if (query.anchorHash) {
        params.set("anchorHash", query.anchorHash);
      }
      return request<{ posts: ForumPost[] }>(`/v1/contextual-feed?${params.toString()}`);
    }
  };
}

export type ForumClient = ReturnType<typeof createForumClient>;

export function openForumDraft(draftId: string, webBaseUrl = import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174") {
  const url = `${webBaseUrl.replace(/\/$/, "")}/?draft=${encodeURIComponent(draftId)}`;
  window.location.assign(url);
}
