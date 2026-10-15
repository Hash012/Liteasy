import { paperServiceRequest, validatePaperService, type PaperServiceConfig } from "./paperServiceTransport";

type MetadataProvider = "crossref" | "openalex" | "semantic-scholar";
type MetadataConfig = PaperServiceConfig & { provider: MetadataProvider };

const connectionInfo = {
  crossref: {
    provider: "crossref", name: "Crossref", keyLabel: "了解 Crossref Plus 密钥",
    keyUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/",
    hint: "公共查询无需密钥；Crossref Plus 用户可选填。"
  },
  openalex: {
    provider: "openalex", name: "OpenAlex", keyLabel: "获取 OpenAlex API key",
    keyUrl: "https://openalex.org/settings/api",
    hint: "公共查询无需密钥；可申请免费密钥提高额度。"
  },
  "semantic-scholar": {
    provider: "semantic-scholar", name: "Semantic Scholar", keyLabel: "申请 Semantic Scholar API key",
    keyUrl: "https://www.semanticscholar.org/product/api",
    hint: "公共查询无需密钥，共享额度可能繁忙；可申请密钥。"
  }
} as const;

export function paperServiceConnectionInfo(provider: PaperServiceConfig["provider"]) {
  return provider === "crossref" || provider === "openalex" || provider === "semantic-scholar" ? connectionInfo[provider] : null;
}

const testDoi = "10.1038/nature14539";
class ConnectionFailure extends Error {}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function responseError(status: number) {
  if (status === 401) return "服务未接受当前密钥。请检查并重新保存密钥，或删除密钥后测试公共查询。";
  if (status === 403) return "服务拒绝了本次访问。请检查密钥权限、服务地址或网络访问限制。";
  if (status === 429) return "服务请求额度已用尽或当前繁忙。请稍后再试；使用公共查询时，可申请密钥提高可用额度。";
  if (status === 404) return "未找到测试论文接口。请检查服务类型与 API 地址是否对应。";
  if (status >= 500) return "文献服务暂时不可用，请稍后再试。";
  return "文献服务未完成查询，请检查 API 地址后重试。";
}

/** A bounded public record verifies the configured endpoint and its stored credentials. */
export async function testPaperServiceConnection(configInput: MetadataConfig, signal?: AbortSignal): Promise<{ title: string }> {
  signal?.throwIfAborted();
  let config: MetadataConfig;
  try {
    config = { ...validatePaperService(configInput), provider: configInput.provider };
  } catch {
    throw new ConnectionFailure("服务地址无效。请填写 HTTPS API 地址，不要在地址中包含密钥；本机服务可使用 HTTP。");
  }
  const path = config.provider === "crossref" ? `/works/${encodeURIComponent(testDoi)}`
    : config.provider === "openalex" ? `/works/${encodeURIComponent(`https://doi.org/${testDoi}`)}`
    : `/paper/${encodeURIComponent(`DOI:${testDoi}`)}`;
  const url = new URL(`${config.endpoint}${path}`);
  if (config.provider === "semantic-scholar") url.searchParams.set("fields", "title,externalIds");
  try {
    const response = await paperServiceRequest(config, url.href, {
      signal, timeoutMs: 15_000, maxResponseBytes: 256 * 1024
    });
    signal?.throwIfAborted();
    if (!response.ok) throw new ConnectionFailure(responseError(response.status));
    let payload: Record<string, unknown>;
    try { payload = record(await response.json()); }
    catch { throw new ConnectionFailure("服务返回的内容不是文献题录。请检查 API 地址，确认它不是服务首页或登录页面。"); }
    signal?.throwIfAborted();
    const item = config.provider === "crossref" ? record(payload.message) : payload;
    const title = config.provider === "crossref" ? (Array.isArray(item.title) ? item.title[0] : undefined) : item.title ?? item.display_name;
    const doi = config.provider === "crossref" ? item.DOI : config.provider === "openalex" ? item.doi : record(item.externalIds).DOI;
    if (typeof title !== "string" || !title.trim() || title.length > 1000 || typeof doi !== "string" ||
      doi.trim().replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() !== testDoi) {
      throw new ConnectionFailure("服务未返回预期的测试论文。请检查服务类型与 API 地址是否对应。");
    }
    return { title: title.trim() };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ConnectionFailure) throw error;
    const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (/timeout|timed\s*out|超时/i.test(detail)) throw new ConnectionFailure("连接测试超时。请检查网络或代理设置后重试。");
    throw new ConnectionFailure("无法连接文献服务。请检查网络、代理和 API 地址后重试。");
  }
}
