import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const baseUrl = import.meta.env.VITE_INTUECHO_API_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:4040" : window.location.origin);
const oauthSessionProjectionKey = "intuecho.auth.oauth-session.v1";
const audience = "intuecho-web";

export type IdentityMode = "development" | "oauth" | "unavailable";

export type IdentitySession = {
  audience: "intuecho-web";
  email: string;
  expiresAt: string;
  name: string;
  sessionId: string;
  userId: string;
};

type WebIdentityConfiguration = {
  audience: "intuecho-web";
  authorizationFlow: "authorization_code_pkce";
  clientId: string;
  issuer: string;
};

let identityModePromise: Promise<IdentityMode> | null = null;
let oauthManagerPromise: Promise<UserManager> | null = null;

let authRequiredHandler: (() => void) | null = null;

export function setAuthRequiredHandler(handler: (() => void) | null) {
  authRequiredHandler = handler;
}

export function readIdentitySession(): IdentitySession | null {
  return readStoredSession(sessionStorage, oauthSessionProjectionKey);
}

function readStoredSession(storage: Storage, key: string) {
  try {
    const value = storage.getItem(key);
    if (!value) return null;
    const session = JSON.parse(value) as IdentitySession;
    return session.audience === audience && session.sessionId && session.userId ? session : null;
  } catch {
    return null;
  }
}

function storeSession(storage: Storage, key: string, session: IdentitySession | null) {
  if (session) storage.setItem(key, JSON.stringify(session));
  else storage.removeItem(key);
}

function loopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  } catch {
    return false;
  }
}

function validateWebIdentityConfiguration(value: unknown): WebIdentityConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("身份服务配置无效。");
  }
  const candidate = value as Partial<WebIdentityConfiguration>;
  if (
    candidate.audience !== audience ||
    candidate.authorizationFlow !== "authorization_code_pkce" ||
    typeof candidate.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{1,200}$/.test(candidate.clientId) ||
    typeof candidate.issuer !== "string"
  ) {
    throw new Error("身份服务配置无效。");
  }
  const issuer = new URL(candidate.issuer);
  if (
    issuer.username || issuer.password || issuer.search || issuer.hash ||
    (issuer.protocol !== "https:" && !(import.meta.env.DEV && loopbackUrl(candidate.issuer)))
  ) {
    throw new Error("身份服务配置无效。");
  }
  return candidate as WebIdentityConfiguration;
}

async function identityMode() {
  identityModePromise ??= (async () => {
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/identity/web-config`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
    } catch {
      return "unavailable" as const;
    }
    if (response.ok) {
      validateWebIdentityConfiguration(await response.json());
      return "oauth" as const;
    }
    if (response.status === 404 && import.meta.env.DEV) {
      const { developmentIdentity } = await import("./developmentIdentity");
      if (developmentIdentity.available(baseUrl)) return "development" as const;
    }
    return "unavailable" as const;
  })();
  return identityModePromise;
}

async function loadWebIdentityConfiguration() {
  const response = await fetch(`${baseUrl}/v1/identity/web-config`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("统一身份服务暂时不可用。");
  return validateWebIdentityConfiguration(await response.json());
}

async function oauthManager() {
  oauthManagerPromise ??= (async () => {
    const configuration = await loadWebIdentityConfiguration();
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const manager = new UserManager({
      authority: configuration.issuer,
      automaticSilentRenew: true,
      client_id: configuration.clientId,
      extraQueryParams: { audience },
      loadUserInfo: true,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      stateStore: new WebStorageStateStore({ store: sessionStorage }),
      userStore: new WebStorageStateStore({ store: sessionStorage })
    });
    manager.events.addUserLoaded((value) => {
      storeSession(sessionStorage, oauthSessionProjectionKey, sessionFromOauthUser(value));
    });
    manager.events.addUserUnloaded(() => {
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
    });
    return manager;
  })();
  return oauthManagerPromise;
}

function sessionFromOauthUser(user: User): IdentitySession {
  const name = typeof user.profile.name === "string" ? user.profile.name :
    typeof user.profile.preferred_username === "string" ? user.profile.preferred_username : "";
  if (!user.access_token || !user.profile.sub || !name || !user.expires_at) {
    throw new Error("统一身份服务返回了无效会话。");
  }
  return {
    audience,
    email: typeof user.profile.email === "string" ? user.profile.email : "",
    expiresAt: new Date(user.expires_at * 1000).toISOString(),
    name,
    sessionId: user.access_token,
    userId: user.profile.sub
  };
}

async function validOauthSession() {
  const manager = await oauthManager();
  let value = await manager.getUser();
  if (value?.expired) {
    value = await manager.signinSilent().catch(() => null);
  }
  if (!value || value.expired) {
    storeSession(sessionStorage, oauthSessionProjectionKey, null);
    return null;
  }
  const session = sessionFromOauthUser(value);
  storeSession(sessionStorage, oauthSessionProjectionKey, session);
  return session;
}

async function currentIdentitySession() {
  const mode = await identityMode();
  if (mode === "oauth") return validOauthSession();
  if (mode === "development" && import.meta.env.DEV) {
    const { developmentIdentity } = await import("./developmentIdentity");
    return developmentIdentity.read();
  }
  return null;
}

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
  viewer_is_author: boolean;
  created_at: string;
};

export type DiscussionComment = { id: string; post_id: string; post_title: string | null; topic_id: string; work_id: string | null; body: string; author_name: string; author_initials: string; created_at: string; viewer_saved: boolean };

export type Work = { id: string; topic_id: string; title: string; authors: string; year: number; venue: string; identifier: string | null; abstract: string };
export type Topic = { id: string; name: string; description: string; guide: string; follower_count: number; is_following?: boolean; is_saved?: boolean };
export type Draft = { id: string; work_id: string | null; topic_id: string; page: number | null; excerpt: string | null; anchor_hash: string | null; language: string; expires_at: string | null; citation_enabled: boolean; body: string; title: string | null; tags: string[]; is_saved: number; updated_at: string; published_post_id: string | null };
export type DraftSummary = { draft: Draft; work: Pick<Work, "id" | "title"> | null; topic: Pick<Topic, "id" | "name"> };

export type PaperIdentity = {
  id: string;
  kind: "doi" | "arxiv_id" | "semantic_scholar_id" | "title_authors_year_hash";
  source: "inferred" | "metadata";
  value: string;
};

export type LiteratureReference = {
  identity: PaperIdentity;
  metadata: {
    authors: string[];
    documentType?: string;
    title: string;
    year?: number;
  };
};

export type SourceEvidence = {
  anchorHash: string;
  excerpt: string;
  literature: LiteratureReference;
  page?: number;
  rects: Array<Record<string, unknown>>;
};

export type AnnotationTarget =
  | { kind: "whole_document"; literature: LiteratureReference }
  | ({ kind: "source_passage" } & SourceEvidence)
  | {
      derivedContent: { artifactId: string; excerpt: string; nodeId?: string; version: string };
      evidence: SourceEvidence[];
      kind: "derived_passage";
      literature: LiteratureReference;
    };

export type AnnotationVisibility = "private" | "organization" | "mutual_followers" | "public";

export type CommunityAnnotation = {
  author: {
    id: string;
    initials: string;
    name: string;
    profile: {
      educationStage: string | null;
      institutions: Array<{ name: string }>;
    };
  };
  body: string;
  createdAt: string;
  id: string;
  organizationId: string | null;
  originalReply: { replyId: string; status: "available" | "parent_deleted" } | null;
  ratingAverage: number | null;
  ratingCount: number;
  revision: number;
  shareToPlaza: boolean;
  tags: Array<{ confidence: number | null; name: string; origin: "platform" | "user"; state: "active" | "appealed" | "upheld" }>;
  targets: AnnotationTarget[];
  updatedAt: string;
  viewerCanModerate: boolean;
  viewerIsAuthor: boolean;
  viewerSaved: boolean;
  viewerRating: number | null;
  visibility: AnnotationVisibility;
  withdrawnAt: string | null;
};

export type OrganizationAnnotationGroup = {
  annotations: CommunityAnnotation[];
  name: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
};

export type CreateAnnotationInput = {
  body: string;
  organizationId?: string;
  shareToPlaza: boolean;
  tags: string[];
  targets: AnnotationTarget[];
  visibility: AnnotationVisibility;
};

export type AcademicProfile = {
  educationStage: string | null;
  institutions: Array<{ name: string }>;
  revision: number;
};

export type CommunityReply = {
  author: CommunityAnnotation["author"];
  body: string;
  createdAt: string;
  derivedAnnotationId: string | null;
  id: string;
  parentAnnotationId: string;
  revision: number;
  updatedAt: string;
  viewerIsAuthor: boolean;
};

export type DirectMessage = {
  body: string;
  createdAt: string;
  id: string;
  invitation: Record<string, string> | null;
  kind: "text" | "organization_invitation";
  senderId: string;
};

export type ConversationSummary = {
  canSend: boolean;
  createdAt: string;
  id: string;
  lastMessage: Omit<DirectMessage, "id"> | null;
  participant: CommunityAnnotation["author"];
  unreadCount: number;
};

export type CreateReplyInput = {
  body: string;
  shareToPlaza: boolean;
  tags: string[];
  targets: AnnotationTarget[];
};

export type PlazaFilters = {
  documentType?: string;
  educationStage?: string;
  institution?: string;
  limit?: number;
  literatureIdentityKind?: PaperIdentity["kind"];
  literatureIdentityValue?: string;
  query?: string;
  sort?: "latest" | "recommended";
};

async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  const session = await currentIdentitySession();
  if (authenticated && !session) {
    authRequiredHandler?.();
    throw new Error("请先登录后再继续。");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.sessionId}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && session) {
    storeSession(sessionStorage, oauthSessionProjectionKey, null);
    if (import.meta.env.DEV) {
      const { developmentIdentity } = await import("./developmentIdentity");
      developmentIdentity.clear();
    }
    authRequiredHandler?.();
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求未能完成");
  return body;
}

export const identityApi = {
  beginOAuthLogin: async () => {
    if (await identityMode() !== "oauth") throw new Error("统一身份登录尚未配置。");
    await (await oauthManager()).signinRedirect();
  },
  initialize: async (): Promise<{ mode: IdentityMode; session: IdentitySession | null }> => {
    const mode = await identityMode();
    if (mode === "oauth") {
      const callback = new URLSearchParams(window.location.search);
      if (callback.has("code") && callback.has("state")) {
        await (await oauthManager()).signinRedirectCallback(window.location.href);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      }
      return { mode, session: await validOauthSession() };
    }
    if (mode === "development" && import.meta.env.DEV) {
      const { developmentIdentity } = await import("./developmentIdentity");
      return { mode, session: await developmentIdentity.restore() };
    }
    return { mode, session: null };
  },
  logout: async () => {
    const mode = await identityMode();
    if (mode === "oauth") {
      const manager = await oauthManager();
      await manager.revokeTokens(["access_token", "refresh_token"]).catch(() => undefined);
      await manager.removeUser();
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
      return;
    }
    if (mode !== "development" || !import.meta.env.DEV) return;
    const { developmentIdentity } = await import("./developmentIdentity");
    await developmentIdentity.logout();
  }
};

export const api = {
  plaza: (filters: PlazaFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    return request<{ annotations: CommunityAnnotation[]; filters: PlazaFilters }>(`/v1/plaza?${params}`);
  },
  annotation: (id: string) => request<{ annotation: CommunityAnnotation }>(`/v1/annotations/${encodeURIComponent(id)}`),
  createAnnotation: (body: CreateAnnotationInput) => request<{ annotation: CommunityAnnotation }>("/v1/annotations", { method: "POST", body: JSON.stringify(body) }, true),
  consumeAnnotationHandoff: (handoffId: string) => request<{ draft: CreateAnnotationInput; replayed: boolean }>(`/v1/annotation-handoffs/${encodeURIComponent(handoffId)}/consume`, { method: "POST", body: "{}" }, true),
  updateAnnotation: (id: string, body: Partial<CreateAnnotationInput>) => request<{ annotation: CommunityAnnotation }>(`/v1/annotations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }, true),
  replies: (id: string) => request<{ replies: CommunityReply[] }>(`/v1/annotations/${encodeURIComponent(id)}/replies`),
  createReply: (id: string, body: CreateReplyInput) => request<{ annotation: CommunityAnnotation | null; reply: CommunityReply }>(`/v1/annotations/${encodeURIComponent(id)}/replies`, { method: "POST", body: JSON.stringify(body) }, true),
  updateReply: (id: string, body: { body: string }) => request<{ reply: CommunityReply }>(`/v1/replies/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }, true),
  academicProfile: () => request<{ profile: AcademicProfile }>("/v1/me/academic-profile", undefined, true),
  updateAcademicProfile: (body: Omit<AcademicProfile, "revision">) => request<{ profile: AcademicProfile }>("/v1/me/academic-profile", { method: "PUT", body: JSON.stringify(body) }, true),
  followUser: (targetUserId: string) => request<{ following: boolean; mutual: boolean }>("/v1/follows", { method: "POST", body: JSON.stringify({ targetUserId }) }, true),
  followingAnnotations: () => request<{ annotations: CommunityAnnotation[] }>("/v1/me/following-annotations", undefined, true),
  conversations: () => request<{ conversations: ConversationSummary[] }>("/v1/conversations", undefined, true),
  createConversation: (participantId: string) => request<{ id: string }>("/v1/conversations", { method: "POST", body: JSON.stringify({ participantId }) }, true),
  messages: (conversationId: string) => request<{ messages: DirectMessage[] }>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, undefined, true),
  markConversationRead: (conversationId: string, messageId: string) => request<{ lastReadMessageId: string; unreadCount: number }>(`/v1/conversations/${encodeURIComponent(conversationId)}/read`, { method: "PUT", body: JSON.stringify({ messageId }) }, true),
  sendMessage: (conversationId: string, body: { body: string; invitation?: { organizationId: string; role: string }; kind: "text" | "organization_invitation" }) => request(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify(body) }, true),
  appealTag: (annotationId: string, tag: string, reason: string) => request(`/v1/annotations/${encodeURIComponent(annotationId)}/tags/${encodeURIComponent(tag)}/appeals`, { method: "POST", body: JSON.stringify({ reason }) }, true),
  myAnnotations: () => request<{ annotations: CommunityAnnotation[] }>("/v1/me/annotations", undefined, true),
  organizationAnnotations: () => request<{ organizations: OrganizationAnnotationGroup[] }>("/v1/me/organization-annotations", undefined, true),
  moderateOrganizationAnnotation: (annotationId: string, body: { action: "restore" | "withdraw"; reason: string }) => request(`/v1/annotations/${encodeURIComponent(annotationId)}/organization-moderation`, { method: "POST", body: JSON.stringify(body) }, true),
  rateAnnotation: (annotationId: string, rating: number) => request<{ ratingAverage: number; ratingCount: number; viewerRating: number }>(`/v1/annotations/${encodeURIComponent(annotationId)}/rating`, { method: "PUT", body: JSON.stringify({ rating }) }, true),
  saveAnnotation: (annotationId: string) => request<{ saved: boolean }>(`/v1/annotations/${encodeURIComponent(annotationId)}/save`, { method: "POST", body: "{}" }, true),
  withdrawAnnotation: (annotationId: string) => request(`/v1/annotations/${encodeURIComponent(annotationId)}`, { method: "DELETE" }, true),
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
  consumeDraftHandoff: (handoffId: string) => request<{ draftId: string; replayed: boolean }>(`/v1/draft-handoffs/${encodeURIComponent(handoffId)}/consume`, { method: "POST", body: "{}" }, true),
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
