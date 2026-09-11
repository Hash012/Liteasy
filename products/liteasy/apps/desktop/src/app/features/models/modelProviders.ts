import type { SettingsState } from "../settings/settings.types";

export type DirectModelProtocol = "openai" | "anthropic";
export type DirectOutputFormat = "json_schema" | "json_object" | "prompt";
export type DirectModelConfig = {
  provider: string;
  endpoint: string;
  model: string;
  protocol: DirectModelProtocol;
  outputFormat: DirectOutputFormat;
};
export type ModelProvider = DirectModelConfig & {
  label: string;
  models: readonly string[];
  docs: string;
  hint?: string;
};

function provider(provider: string, label: string, endpoint: string, models: string[], docs: string,
  options: Partial<Pick<ModelProvider, "protocol" | "outputFormat" | "hint">> = {}): ModelProvider {
  return { provider, label, endpoint, models, model: models[0] ?? "", protocol: "openai", outputFormat: "prompt", docs, ...options };
}

// Model IDs remain editable: availability depends on the user's provider account.
export const modelProviders: readonly ModelProvider[] = [
  provider("openai", "OpenAI", "https://api.openai.com/v1", ["gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"], "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create", { outputFormat: "json_schema" }),
  provider("anthropic", "Anthropic / Claude", "https://api.anthropic.com/v1", ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"], "https://platform.claude.com/docs/en/api/messages", { protocol: "anthropic" }),
  provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", ["gemini-2.5-flash", "gemini-2.5-pro"], "https://ai.google.dev/gemini-api/docs/openai", { outputFormat: "json_schema" }),
  provider("deepseek", "DeepSeek", "https://api.deepseek.com", ["deepseek-flash", "deepseek-pro"], "https://api-docs.deepseek.com/", { outputFormat: "json_object" }),
  provider("qwen", "阿里云百炼 / 通义千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", ["qwen-plus", "qwen-turbo", "qwen-max"], "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope", { hint: "请按百炼控制台的地域和业务空间填写 API 地址；新业务空间请使用专属域名。" }),
  provider("moonshot", "Moonshot / Kimi", "https://api.moonshot.ai/v1", ["kimi-k3", "kimi-k2.5"], "https://platform.moonshot.ai/docs/guide/start-using-kimi-api", { hint: "中国区账号可改为 https://api.moonshot.cn/v1。" }),
  provider("zhipu", "智谱 / GLM", "https://open.bigmodel.cn/api/paas/v4", ["glm-4.7", "glm-4.5"], "https://docs.bigmodel.cn/api-reference/模型-api/对话补全"),
  provider("minimax", "MiniMax", "https://api.minimax.io/v1", ["MiniMax-M2.5", "MiniMax-M2.1"], "https://platform.minimax.io/docs/api-reference/text-openai-api", { hint: "国内平台账号请使用控制台给出的 API 地址。" }),
  provider("doubao", "火山方舟 / 豆包", "https://ark.cn-beijing.volces.com/api/v3", [], "https://www.volcengine.com/docs/82379/1399008", { hint: "填写方舟控制台中的模型 ID 或已开通的推理接入点 ID（ep-…）。" }),
  provider("siliconflow", "硅基流动 / SiliconFlow", "https://api.siliconflow.cn/v1", ["Qwen/Qwen3-8B", "deepseek-ai/DeepSeek-V3.2"], "https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions"),
  provider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", ["openai/gpt-5-mini", "anthropic/claude-sonnet-4.5"], "https://openrouter.ai/docs/quickstart"),
  provider("groq", "Groq", "https://api.groq.com/openai/v1", ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"], "https://console.groq.com/docs/openai"),
  provider("mistral", "Mistral AI", "https://api.mistral.ai/v1", ["mistral-small-latest", "mistral-large-latest"], "https://docs.mistral.ai/api/endpoint/chat", { outputFormat: "json_object" }),
  provider("xai", "xAI / Grok", "https://api.x.ai/v1", ["grok-4.6"], "https://docs.x.ai/docs/api-reference"),
  provider("together", "Together AI", "https://api.together.ai/v1", ["meta-llama/Llama-3.3-70B-Instruct-Turbo"], "https://docs.together.ai/docs/openai-api-compatibility"),
  provider("azure", "Azure OpenAI", "", [], "https://learn.microsoft.com/azure/ai-foundry/openai/api-version-lifecycle", { outputFormat: "json_schema", hint: "使用资源的 /openai/v1 地址，模型填写部署名称。" }),
  provider("ollama", "Ollama（本机）", "http://127.0.0.1:11434/v1", ["qwen3:8b", "llama3.3"], "https://docs.ollama.com/api/openai-compatibility", { hint: "先在本机启动 Ollama 并下载模型；无需 API key。" }),
  provider("custom", "自定义兼容服务", "", [], "", { hint: "填写包含版本路径的 API 基础地址，支持 OpenAI Chat Completions 或 Anthropic Messages。" })
];

export function getModelProvider(id: string) {
  return modelProviders.find((entry) => entry.provider === id) ?? modelProviders[0];
}

export function isDirectModelMode(settings: Partial<SettingsState>) {
  return settings["models.connection_mode"] === "direct";
}

export function getDirectModelConfig(settings: Partial<SettingsState>): DirectModelConfig {
  const preset = getModelProvider(settings["models.direct_provider"] ?? "openai");
  return {
    provider: preset.provider,
    endpoint: settings["models.direct_endpoint"] ?? preset.endpoint,
    model: settings["models.direct_model"] ?? preset.model,
    protocol: settings["models.direct_protocol"] ?? preset.protocol,
    outputFormat: settings["models.direct_output_format"] ?? preset.outputFormat
  };
}

export function validateDirectModelConfig(config: DirectModelConfig) {
  let url: URL;
  try { url = new URL(config.endpoint.trim()); } catch { throw new Error("请填写有效的 API 基础地址。"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("API 地址须使用 HTTPS；本机服务可以使用 HTTP。");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("API 地址不能包含密钥、查询参数或片段。");
  if (!modelProviders.some((entry) => entry.provider === config.provider)) throw new Error("请选择 API 服务商。");
  if (!config.model.trim()) throw new Error("请填写模型 ID 或部署名称。");
  if (!["openai", "anthropic"].includes(config.protocol)) throw new Error("请选择支持的 API 协议。");
  if (!["json_schema", "json_object", "prompt"].includes(config.outputFormat)) throw new Error("请选择支持的结构化输出方式。");
  return { ...config, endpoint: url.toString().replace(/\/+$/, ""), model: config.model.trim() };
}

export function directModelNeedsKey(config: DirectModelConfig) {
  return !(config.provider === "ollama" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.endpoint).hostname));
}
