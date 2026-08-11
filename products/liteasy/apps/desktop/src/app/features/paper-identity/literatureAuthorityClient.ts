import { loadStoredAccountSession } from "../account/accountSessionStorage";
import { readCloudServiceError } from "../network/cloudErrorMessage";
import { normalizeLiteratureRecord } from "./literatureRecord";
import type {
  LiteratureConfirmInput,
  LiteratureRelationsResult,
  LiteratureResolveInput,
  LiteratureResolveResult
} from "./literature.types";

type LiteratureAuthorityClientOptions = {
  endpoint: string;
  fetchImpl?: typeof fetch;
  getSessionId?: () => string | undefined;
};

function apiUrl(endpoint: string, path: string) {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

export function createLiteratureAuthorityClient({
  endpoint,
  fetchImpl = fetch,
  getSessionId = () => loadStoredAccountSession()?.sessionId
}: LiteratureAuthorityClientOptions) {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("请先登录，再确认文献身份。");
    let response: Response;
    try {
      response = await fetchImpl(apiUrl(endpoint, path), {
        ...init,
        headers: {
          Authorization: `Bearer ${sessionId}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" })
        }
      });
    } catch {
      throw new Error("文献身份服务暂时无法连接，请检查网络后重试。");
    }
    if (!response.ok) {
      throw await readCloudServiceError(response, {
        code: "literature_identity_request_failed",
        message: "文献身份请求未完成，请稍后重试。"
      });
    }
    return await response.json() as T;
  }

  return {
    async confirmLiterature(input: LiteratureConfirmInput) {
      const result = await request<{ literature: unknown }>("/v1/literature:confirm", {
        body: JSON.stringify(input),
        method: "POST"
      });
      return { literature: normalizeLiteratureRecord(result.literature) };
    },
    literatureRelations(literatureId: string) {
      return request<LiteratureRelationsResult>(
        `/v1/literature/${encodeURIComponent(literatureId)}/relations`,
        { method: "GET" }
      );
    },
    resolveLiterature(input: LiteratureResolveInput) {
      return request<LiteratureResolveResult>("/v1/literature:resolve", {
        body: JSON.stringify(input),
        method: "POST"
      });
    },
    async verifyLiterature(reference: { literatureId: string; revision: number }) {
      const result = await request<{ literature: unknown }>("/v1/literature:verify", {
        body: JSON.stringify(reference),
        method: "POST"
      });
      return normalizeLiteratureRecord(result.literature);
    }
  };
}

export type LiteratureAuthorityClient = ReturnType<typeof createLiteratureAuthorityClient>;
