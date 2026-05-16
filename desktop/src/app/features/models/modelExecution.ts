import type { ModelAccessMode } from "./modelGateway";

export type ModelExecutionTrace = {
  backend: "desktop_mock" | "dev_cloud" | "http_service";
  endpoint: string;
  mode: "live" | "mock" | "mock_fallback" | "unknown";
  provider: string;
  source: ModelAccessMode;
};

function getSourceLabel(source: ModelAccessMode) {
  return source === "cloud_proxy" ? "云代理" : "本地直连";
}

function getBackendLabel(trace: ModelExecutionTrace) {
  if (trace.backend === "desktop_mock") {
    return "桌面内置 Mock";
  }

  if (trace.backend === "dev_cloud") {
    if (trace.mode === "live") {
      return `云端服务 -> ${trace.provider === "openai" ? "OpenAI" : trace.provider}`;
    }

    return "云端服务回退 Mock";
  }

  return "HTTP 模型服务";
}

export function formatModelExecutionLabel(trace: ModelExecutionTrace) {
  return `${getSourceLabel(trace.source)} -> ${getBackendLabel(trace)}`;
}
