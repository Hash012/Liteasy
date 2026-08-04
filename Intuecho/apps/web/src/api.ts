const baseUrl = import.meta.env.VITE_INTUECHO_API_URL ?? "http://127.0.0.1:4040";

export type Post = {
  id: string;
  topic_id: string;
  topic_name: string | null;
  work_id: string;
  work_title: string | null;
  title: string | null;
  body: string;
  author_name: string;
  author_initials: string;
  page: number | null;
  excerpt: string | null;
  anchor_hash: string | null;
  helpful: number;
  misleading: number;
  tags: string[];
  has_citation: boolean;
  viewer_signal: "helpful" | "misleading" | null;
  viewer_saved: boolean;
  created_at: string;
};

export type DiscussionComment = { id: string; post_id: string; post_title: string | null; topic_id: string; work_id: string | null; body: string; author_name: string; author_initials: string; created_at: string; viewer_saved: boolean };

export type Work = { id: string; topic_id: string; title: string; authors: string; year: number; venue: string; identifier: string | null; abstract: string };
export type Topic = { id: string; name: string; description: string; guide: string; follower_count: number; is_following?: boolean; is_saved?: boolean };
export type Draft = { id: string; work_id: string | null; topic_id: string; page: number | null; excerpt: string | null; anchor_hash: string | null; language: string; expires_at: string | null; citation_enabled: boolean; body: string; title: string | null; tags: string[]; is_saved: number; updated_at: string; published_post_id: string | null };
export type DraftSummary = { draft: Draft; work: Pick<Work, "id" | "title"> | null; topic: Pick<Topic, "id" | "name"> };

async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), "x-intuecho-user": "demo-user", ...(init?.headers ?? {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求未能完成");
  return body;
}

export const api = {
  topics: () => request<Topic[]>("/v1/topics"),
  topic: (id: string) => request<{ topic: Topic; works: Work[]; posts: Post[] }>(`/v1/topics/${id}`),
  work: (id: string) => request<{ work: Work; topic: Topic; posts: Post[] }>(`/v1/works/${id}`),
  draft: (id: string) => request<{ draft: Draft; work: Work | null; topic: Topic }>(`/v1/drafts/${id}`),
  createTopic: (body: { name: string; description: string }) => request<{ topic: Topic }>("/v1/topics", { method: "POST", body: JSON.stringify(body) }, true),
  drafts: () => request<{ drafts: DraftSummary[] }>("/v1/me/drafts", undefined, true),
  myPosts: () => request<{ posts: Post[] }>("/v1/me/posts", undefined, true),
  following: () => request<{ topics: Topic[] }>("/v1/me/following", undefined, true),
  saved: () => request<{ topics: Topic[]; posts: Post[]; comments: DiscussionComment[] }>("/v1/me/saved", undefined, true),
  followTopic: (topicId: string) => request<{ following: boolean; followerCount: number }>(`/v1/topics/${topicId}/follow`, { method: "POST", body: "{}" }, true),
  saveTopic: (topicId: string) => request<{ saved: boolean }>(`/v1/topics/${topicId}/save`, { method: "POST", body: "{}" }, true),
  createDraft: (body: { topicId: string; workId?: string; page?: number; excerpt?: string; anchorHash?: string; language: string; citationEnabled?: boolean }) => request<{ draftId: string }>("/v1/drafts/contextual", { method: "POST", body: JSON.stringify(body) }, true),
  saveDraft: (draftId: string, body: { body: string; tags: string[]; citationEnabled: boolean; title?: string; topicId?: string }) => request<{ ok: true; draftId: string; updatedAt: string }>(`/v1/drafts/${draftId}`, { method: "PUT", body: JSON.stringify(body) }, true),
  discardDraft: (draftId: string) => request<{ ok: true; draftId: string }>(`/v1/drafts/${draftId}`, { method: "DELETE" }, true),
  publish: (draftId: string) => request<{ postId: string; workId: string | null }>("/v1/posts", { method: "POST", body: JSON.stringify({ draftId }) }, true),
  contextualFeed: (workId: string, anchorHash: string) => request<{ posts: Post[] }>(`/v1/contextual-feed?workId=${encodeURIComponent(workId)}&anchorHash=${encodeURIComponent(anchorHash)}`),
  search: (query: string, tag = "") => request<{ posts: Post[]; query: string; tag: string }>(`/v1/search?query=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}`),
  signal: (postId: string, signal: "helpful" | "misleading") => request<{ ok: true; helpful: number; selectedSignal: "helpful" | "misleading" | null }>(`/v1/posts/${postId}/signals`, { method: "POST", body: JSON.stringify({ signal }) }, true),
  savePost: (postId: string) => request<{ saved: boolean }>(`/v1/posts/${postId}/save`, { method: "POST", body: "{}" }, true),
  comments: (postId: string) => request<{ comments: DiscussionComment[] }>(`/v1/posts/${postId}/comments`),
  createComment: (postId: string, body: string) => request<{ comment: DiscussionComment }>(`/v1/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body }) }, true),
  saveComment: (commentId: string) => request<{ saved: boolean }>(`/v1/comments/${commentId}/save`, { method: "POST", body: "{}" }, true),
  withdraw: (postId: string) => request(`/v1/posts/${postId}`, { method: "DELETE" }, true),
  feedback: (body: { kind: "bug" | "idea" | "experience"; message: string; context?: string }) => request("/v1/feedback", { method: "POST", body: JSON.stringify(body) })
};
