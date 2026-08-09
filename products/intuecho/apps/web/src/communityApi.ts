import {
  clearRejectedIdentitySession,
  notifyAuthenticationRequired,
  resolveIdentitySession
} from "./identityClient";
import { intuechoApiBaseUrl } from "./runtimeConfig";
import type {
  AcademicProfile,
  CommunityAnnotation,
  CommunityReply,
  ConversationSummary,
  CreateAnnotationInput,
  CreateReplyInput,
  DirectMessage,
  OrganizationAnnotationGroup,
  PlazaFilters
} from "./community.types";
import type {
  LiteratureRecord,
  LiteratureResolveInput,
  LiteratureResolveResult,
  LiteratureConfirmInput,
  ReplyPublicationInput
} from "./community.types";

async function request<T>(path: string, init?: RequestInit, authenticated = false): Promise<T> {
  const session = await resolveIdentitySession();
  if (authenticated && !session) {
    notifyAuthenticationRequired();
    throw new Error("请先登录后再继续。");
  }
  const response = await fetch(`${intuechoApiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.sessionId}` } : {}),
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && session) {
    await clearRejectedIdentitySession();
  }
  if (!response.ok) throw new Error(body.message ?? body.error ?? "请求未能完成");
  return body;
}

export const communityApi = {
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
  resolveLiterature: (body: LiteratureResolveInput) => request<LiteratureResolveResult>("/v1/literature:resolve", { method: "POST", body: JSON.stringify(body) }, true),
  confirmLiterature: (body: LiteratureConfirmInput) => request<{ literature: LiteratureRecord }>("/v1/literature:confirm", { method: "POST", body: JSON.stringify(body) }, true),
  updateReplyPublication: (id: string, body: ReplyPublicationInput) => request<{ annotation: CommunityAnnotation | null; reply: CommunityReply }>(`/v1/replies/${encodeURIComponent(id)}/publication`, { method: "PUT", body: JSON.stringify(body) }, true),
  deleteReply: (id: string) => request<{ ok: true; replyId: string }>(`/v1/replies/${encodeURIComponent(id)}`, { method: "DELETE" }, true),
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
  withdrawAnnotation: (annotationId: string) => request(`/v1/annotations/${encodeURIComponent(annotationId)}`, { method: "DELETE" }, true)
};
