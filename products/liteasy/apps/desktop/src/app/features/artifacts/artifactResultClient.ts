import type { AgentArtifactResult } from "./artifact.types";
import { IntuitionGraphDocumentSchema } from "../intuition-graph/intuitionGraph.schema";
import { loadStoredAccountSession } from "../account/accountSessionStorage";

type ArtifactResultTransport = (
  url: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string; signal?: AbortSignal }
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
}>;

function endpoint(baseEndpoint: string) {
  return `${baseEndpoint.replace(/\/$/, "")}/v1/agent-artifacts`;
}

function requireAccessToken(getAccessToken: () => string | undefined) {
  const token = getAccessToken()?.trim();
  if (!token) throw new Error("请先登录，再访问 Agent 产物。");
  return token;
}

function isArtifactResult(value: unknown): value is AgentArtifactResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AgentArtifactResult>;
  return (
    candidate.version === "liteasy.agent-artifact/v1" &&
    typeof candidate.artifactId === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.answer === "string" &&
    Array.isArray(candidate.papers) &&
    Array.isArray(candidate.citations) &&
    (candidate.mineruTextChunks === undefined || Array.isArray(candidate.mineruTextChunks)) &&
    (candidate.uiDsl === undefined || Boolean(candidate.uiDsl)) &&
    (candidate.thinReadingDocument === undefined || typeof candidate.thinReadingDocument === "object") &&
    (candidate.intuitionGraph === undefined || IntuitionGraphDocumentSchema.safeParse(candidate.intuitionGraph).success) &&
    candidate.agent?.status === "completed"
  );
}

export function createArtifactResultClient(input: {
  getAccessToken?: () => string | undefined;
  getBaseEndpoint: () => string;
  transport?: ArtifactResultTransport;
}) {
  const transport = input.transport ?? fetch;
  const getAccessToken = input.getAccessToken ?? (() => loadStoredAccountSession()?.sessionId);
  const authorizationHeaders = () => ({
    Authorization: `Bearer ${requireAccessToken(getAccessToken)}`
  });
  return {
    async delete(artifactId: string) {
      const response = await transport(
        `${endpoint(input.getBaseEndpoint())}/${encodeURIComponent(artifactId)}`,
        { headers: authorizationHeaders(), method: "DELETE" }
      );
      const payload = await response.json() as {
        artifactId?: string;
        code?: string;
        deleted?: boolean;
        error?: string;
        message?: string;
      };
      if (!response.ok || payload.deleted !== true || payload.artifactId !== artifactId) {
        throw new Error(payload.message ?? payload.code ?? payload.error ?? `删除 Agent 产物失败：HTTP ${response.status}`);
      }
    },

    async list() {
      const response = await transport(endpoint(input.getBaseEndpoint()), {
        headers: authorizationHeaders()
      });
      if (!response.ok) {
        throw new Error(`加载 Agent 产物失败：HTTP ${response.status}`);
      }
      const payload = await response.json() as { artifacts?: unknown[] };
      return (payload.artifacts ?? []).filter(isArtifactResult);
    },

    async rename(artifactId: string, title: string) {
      const response = await transport(
        `${endpoint(input.getBaseEndpoint())}/${encodeURIComponent(artifactId)}`,
        {
          body: JSON.stringify({ title }),
          headers: { ...authorizationHeaders(), "Content-Type": "application/json" },
          method: "PATCH"
        }
      );
      const payload = await response.json() as { artifact?: unknown; error?: string };
      if (!response.ok || !isArtifactResult(payload.artifact)) {
        throw new Error(payload.error ?? `重命名 Agent 产物失败：HTTP ${response.status}`);
      }
      return payload.artifact;
    },

    async save(document: AgentArtifactResult, signal?: AbortSignal) {
      const response = await transport(endpoint(input.getBaseEndpoint()), {
        body: JSON.stringify(document),
        headers: { ...authorizationHeaders(), "Content-Type": "application/json" },
        method: "POST",
        ...(signal ? { signal } : {})
      });
      const payload = await response.json() as { error?: string; path?: string };
      if (!response.ok || !payload.path) {
        throw new Error(payload.error ?? `保存 Agent 产物失败：HTTP ${response.status}`);
      }
      return payload.path;
    }
  };
}

export type ArtifactResultClient = ReturnType<typeof createArtifactResultClient>;
