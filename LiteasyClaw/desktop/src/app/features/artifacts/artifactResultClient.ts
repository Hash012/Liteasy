import type { AgentArtifactResult } from "./artifact.types";

type ArtifactResultTransport = (
  url: string,
  init?: { body?: string; headers?: Record<string, string>; method?: string }
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
}>;

function endpoint(baseEndpoint: string) {
  return `${baseEndpoint.replace(/\/$/, "")}/v1/agent-artifacts`;
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
    Boolean(candidate.uiDsl) &&
    candidate.agent?.status === "completed"
  );
}

export function createArtifactResultClient(input: {
  getBaseEndpoint: () => string;
  transport?: ArtifactResultTransport;
}) {
  const transport = input.transport ?? fetch;
  return {
    async list() {
      const response = await transport(endpoint(input.getBaseEndpoint()));
      if (!response.ok) {
        throw new Error(`加载 Agent 产物失败：HTTP ${response.status}`);
      }
      const payload = await response.json() as { artifacts?: unknown[] };
      return (payload.artifacts ?? []).filter(isArtifactResult);
    },

    async save(document: AgentArtifactResult) {
      const response = await transport(endpoint(input.getBaseEndpoint()), {
        body: JSON.stringify(document),
        headers: { "Content-Type": "application/json" },
        method: "POST"
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
