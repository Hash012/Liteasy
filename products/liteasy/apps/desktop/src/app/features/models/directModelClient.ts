import type { GenerateAnswerInput, ModelGenerationResult } from "./modelGateway";
import { directModelTransport, type DirectModelTransport } from "./directModelTransport";
import { validateDirectModelConfig, type DirectModelConfig } from "./modelProviders";

function parseResponseJson(value: string) {
  try { return JSON.parse(value); }
  catch { throw new Error("模型响应格式无效，请检查 API 协议与服务商状态。"); }
}

export function buildDirectModelBody(config: DirectModelConfig, input: GenerateAnswerInput) {
  const prompt = input.outputFormat
    ? `${input.prompt}\n\nReturn only JSON matching this schema, without Markdown fences:\n${JSON.stringify(input.outputFormat.schema)}`
    : input.prompt;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    stream: Boolean(input.onDelta)
  };
  if (config.protocol === "anthropic") body.max_tokens = 8192;
  else if (input.outputFormat && config.outputFormat !== "prompt") {
    body.response_format = config.outputFormat === "json_schema"
      ? { type: "json_schema", json_schema: input.outputFormat }
      : { type: "json_object" };
  }
  return body;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.type === "text" ? part.text ?? "" : "").join("");
  return "";
}

// Decode bytes incrementally: UTF-8 characters and SSE frames can cross IPC chunks.
export function createDirectModelStream(protocol: DirectModelConfig["protocol"], onDelta: NonNullable<GenerateAnswerInput["onDelta"]>, onReasoningDelta?: GenerateAnswerInput["onReasoningDelta"]) {
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let reasoning = "";
  let completed = false;
  let failure: Error | undefined;
  function frame(raw: string) {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { completed = true; return; }
    const event = parseResponseJson(data);
    if (event.error || event.type === "error") throw new Error("模型服务返回流式错误，请检查服务商状态及模型额度。");
    let delta = "";
    let reasoningDelta = "";
    if (protocol === "anthropic") {
      if (event.type === "content_block_start" && event.content_block?.type === "text") delta = event.content_block.text ?? "";
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") delta = event.delta.text ?? "";
      if (event.type === "content_block_start" && event.content_block?.type === "thinking") reasoningDelta = event.content_block.thinking ?? "";
      if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") reasoningDelta = event.delta.thinking ?? "";
      if (event.type === "message_stop") completed = true;
      if (event.type === "message_delta" && event.delta?.stop_reason === "max_tokens") throw new Error("模型输出达到长度上限，请缩小生成范围后重试。");
    } else {
      const choice = event.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("模型输出达到长度上限，请缩小生成范围后重试。");
      if (choice?.finish_reason === "content_filter") throw new Error("模型服务未能返回内容，请调整请求后重试。");
      delta = textContent(choice?.delta?.content);
      reasoningDelta = textContent(choice?.delta?.reasoning_content ?? choice?.delta?.reasoning);
    }
    if (reasoningDelta) { reasoning += reasoningDelta; onReasoningDelta?.(reasoningDelta, reasoning); }
    if (delta) { answer += delta; onDelta(delta, answer); }
  }
  function consume() {
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      frame(raw);
    }
  }
  return {
    push(chunk: Uint8Array) {
      if (failure) return;
      try { buffer += decoder.decode(chunk, { stream: true }); consume(); }
      catch (error) { failure = error instanceof Error ? error : new Error("模型流式响应无效。"); }
    },
    finish() {
      if (failure) throw failure;
      buffer += decoder.decode();
      consume();
      if (buffer.trim()) frame(buffer);
      if (!completed) throw new Error("模型连接提前结束，响应未完成，请重试。");
      if (!answer.trim()) throw new Error("模型未返回文本，请检查所选模型是否支持对话。");
      return answer;
    }
  };
}

export function createDirectModelClient(inputConfig: DirectModelConfig, transport: DirectModelTransport = directModelTransport) {
  return async (input: GenerateAnswerInput): Promise<ModelGenerationResult> => {
    input.signal?.throwIfAborted();
    const config = validateDirectModelConfig(inputConfig);
    const stream = input.onDelta ? createDirectModelStream(config.protocol, input.onDelta, input.onReasoningDelta) : undefined;
    const raw = await transport({ config, body: buildDirectModelBody(config, input), signal: input.signal, onChunk: stream?.push });
    input.signal?.throwIfAborted();
    let answer: string;
    if (stream) answer = stream.finish();
    else {
      const result = parseResponseJson(raw);
      const stop = config.protocol === "anthropic" ? result.stop_reason : result.choices?.[0]?.finish_reason;
      if (stop === "length" || stop === "max_tokens") throw new Error("模型输出达到长度上限，请缩小生成范围后重试。");
      answer = textContent(config.protocol === "anthropic" ? result.content : result.choices?.[0]?.message?.content);
      const reasoning = config.protocol === "anthropic"
        ? (result.content ?? []).filter((part: { type: string }) => part.type === "thinking").map((part: { thinking: string }) => part.thinking).join("\n")
        : textContent(result.choices?.[0]?.message?.reasoning_content ?? result.choices?.[0]?.message?.reasoning);
      if (reasoning) input.onReasoningDelta?.(reasoning, reasoning);
      if (!answer.trim()) throw new Error("模型未返回文本，请检查所选模型是否支持对话。");
    }
    return { answer, trace: { backend: "direct_api", endpoint: config.endpoint, mode: "live", provider: config.provider, source: "direct_api" } };
  };
}
