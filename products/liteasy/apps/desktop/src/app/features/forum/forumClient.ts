import type {
  ForumAnnotationPublicationOperation,
  ForumAnnotationPublicationReceipt,
  ForumAnnotationPublicationResult,
  ForumContext,
  ForumDraftUpdate,
  ForumFeedQuery,
  ForumLiteratureConfirmInput,
  ForumLiteratureConfirmResult,
  ForumLiteratureResolveInput,
  ForumLiteratureResolveResult,
  ForumPost
} from "./forum.types";

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

  async function postJson<T>(path: string, payload: unknown): Promise<T> {
    const response = await fetchImpl(joinUrl(apiBaseUrl, path), {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", ...authenticationHeaders(true) },
      method: "POST"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message ?? body.error ?? "论坛请求失败");
    }
    return body as T;
  }

  function failedPublication(
    operation: ForumAnnotationPublicationOperation,
    error = "论坛发布响应无法验证，请稍后重试。"
  ): ForumAnnotationPublicationResult {
    return {
      annotationId: operation.annotationId,
      error,
      pendingOperation: operation,
      queueKey: operation.queueKey,
      state: "failed"
    };
  }

  function normalizePublicationResults(
    operations: readonly ForumAnnotationPublicationOperation[],
    value: unknown
  ): ForumAnnotationPublicationResult[] {
    const values = value && typeof value === "object" && !Array.isArray(value) &&
      "results" in value && Array.isArray(value.results) ? value.results : [];
    const byQueueKey = new Map<string, ForumAnnotationPublicationReceipt>();
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Partial<ForumAnnotationPublicationReceipt> & { error?: unknown };
      const operation = typeof candidate.queueKey === "string"
        ? operations.find((item) => item.queueKey === candidate.queueKey)
        : undefined;
      if (!operation || candidate.annotationId !== operation.annotationId || byQueueKey.has(operation.queueKey)) continue;
      if ((candidate.state !== "published" && candidate.state !== "retracted") ||
        typeof candidate.remoteAnnotationId !== "string" || !candidate.remoteAnnotationId.trim() ||
        typeof candidate.remoteRevision !== "number" || !Number.isInteger(candidate.remoteRevision) || candidate.remoteRevision <= 0 ||
        typeof candidate.syncedAt !== "string" || !Number.isFinite(Date.parse(candidate.syncedAt))) {
        continue;
      }
      const expectedState = operation.operation === "retract" ? "retracted" : "published";
      if (candidate.state !== expectedState) continue;
      byQueueKey.set(operation.queueKey, {
        annotationId: operation.annotationId,
        queueKey: operation.queueKey,
        remoteAnnotationId: candidate.remoteAnnotationId,
        remoteRevision: candidate.remoteRevision,
        state: candidate.state,
        syncedAt: candidate.syncedAt
      });
    }
    return operations.map((operation) => byQueueKey.get(operation.queueKey) ?? failedPublication(operation));
  }

  return {
    applyAnnotationPublications: async (operations: readonly ForumAnnotationPublicationOperation[]) => {
      try {
        const body = await postJson<unknown>("/v1/pdf-annotations:sync", { operations });
        return { results: normalizePublicationResults(operations, body) };
      } catch (error) {
        const message = error instanceof Error && error.message === "请先登录 Liteasy 再打开论坛发布页。"
          ? error.message
          : "论坛发布请求失败，请稍后重试。";
        return { results: operations.map((operation) => failedPublication(operation, message)) };
      }
    },
    confirmLiterature: (input: ForumLiteratureConfirmInput) =>
      postJson<ForumLiteratureConfirmResult>("/v1/literature:confirm", input),
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
    },
    resolveLiterature: (input: ForumLiteratureResolveInput) =>
      postJson<ForumLiteratureResolveResult>("/v1/literature:resolve", input)
  };
}

export type ForumClient = ReturnType<typeof createForumClient>;

export function openForumHandoff(handoffId: string, webBaseUrl = import.meta.env.VITE_FORUM_WEB_URL ?? "http://127.0.0.1:5174") {
  const url = `${webBaseUrl.replace(/\/$/, "")}/?handoff=${encodeURIComponent(handoffId)}`;
  window.location.assign(url);
}
