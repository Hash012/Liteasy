export type ModelExecutionSource = "cloud_proxy";

export type ModelExecutionTrace = {
  backend: "dev_cloud" | "http_service";
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
  return `${getSourceLabel(trace.source)} -> ${getBackendLabel(trace)}`;
}
