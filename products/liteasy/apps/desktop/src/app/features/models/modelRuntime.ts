import type { SettingsState } from "../settings/settings.types";
import { createModelGateway } from "./modelGateway";
import { createHttpModelClient, type ModelTransport } from "./modelHttpClient";
import { getModelPolicyFromSettings } from "./modelPolicy";
import { isTrustedRemoteModelProxyEndpoint } from "./modelProxyTrust";

type ModelRuntimeDeps = {
  cloudTransport?: ModelTransport;
};

const directModelUpstreamHosts = [
  "api.mosshubs.com",
  "api.openai.com",
  "nowcoding.ai"
];

function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function validateModelProxyEndpoint(
  endpoint: string,
  options: { hasTrustedTransport?: boolean } = {}
) {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("模型云代理地址无效，请填写 Liteasy 模型代理服务地址。");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("模型云代理地址不能包含凭据、查询参数或片段。");
  }
  if (directModelUpstreamHosts.some((hostname) => parsed.hostname.toLowerCase() === hostname)) {
    throw new Error("已阻止前端直连模型上游；请改用 Liteasy 本地或云端模型代理地址。");
  }
  const allowedProtocol = parsed.protocol === "https:" || (
    parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)
  );
  if (!allowedProtocol) {
    throw new Error("模型云代理必须使用 HTTPS；本机代理可使用 loopback HTTP 地址。");
  }
  if (
    parsed.protocol === "https:" &&
    !options.hasTrustedTransport &&
    !isTrustedRemoteModelProxyEndpoint(endpoint)
  ) {
    throw new Error("远程模型代理尚未通过控制面策略验证，请先同步云端模型策略。");
  }
  return endpoint;
}

export function createModelGatewayFromSettings(
  settings: SettingsState,
  deps: ModelRuntimeDeps = {}
) {
  const endpoint = settings["models.cloud_proxy_endpoint"];
  return createModelGateway({
    cloudModel: createHttpModelClient({
      endpoint: validateModelProxyEndpoint(endpoint, {
        hasTrustedTransport: deps.cloudTransport !== undefined
      }),
      source: "cloud_proxy",
      transport: deps.cloudTransport
    }),
    policy: getModelPolicyFromSettings(settings)
  });
}
