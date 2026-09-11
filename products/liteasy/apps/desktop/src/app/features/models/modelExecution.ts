export type ModelExecutionSource = "cloud_proxy" | "direct_api";

export type ModelExecutionTrace = {
  backend: "dev_cloud" | "http_service" | "direct_api";
  endpoint: string;
  mode: "live" | "unknown";
  provider: string;
  source: ModelExecutionSource;
};

function getSourceLabel(_source: ModelExecutionSource) {
  return "云端模型能力";
}

function getBackendLabel(trace: ModelExecutionTrace) {
  if (trace.backend === "dev_cloud") {
    if (trace.mode === "live") {
      return `云端服务 -> ${trace.provider === "openai" ? "OpenAI" : trace.provider}`;
    }
    return "云端模型服务";
  }

  return "HTTP 模型服务";
}

export function formatModelExecutionLabel(trace: ModelExecutionTrace) {
  if (trace.source === "direct_api") return `自备 API → ${trace.provider}`;
  return `${getSourceLabel(trace.source)} -> ${getBackendLabel(trace)}`;
}
