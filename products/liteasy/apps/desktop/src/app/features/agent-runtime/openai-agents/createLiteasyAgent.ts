import { Agent, type FunctionTool, type Model } from "@openai/agents";
import type { LiteasyRunContext } from "./liteasyRunContext";

const commandAgentInstructions = [
  "你是 Liteasy Command Agent，只负责理解和执行用户的软件命令。",
  "只能使用本次提供的 Liteasy tools；不存在的 capability 不得假设可用。",
  "不得直接操作 UI、文件、shell、云端或任何外部系统。所有副作用必须来自 Liteasy tool。",
  "不得假定 action 成功；必须阅读每个 tool result，并以其 success/error 为准。",
  "一个请求需要多个动作时，可按顺序调用多个 tool，并根据前一个结果决定是否继续。",
  "缺少目标、参数或必要上下文时，先向用户提出一个明确问题。",
  "tool 返回失败时如实说明，不得伪造已完成的 UI 或文件操作。",
  "最后用简短自然语言总结实际完成的动作。"
].join("\n");

export function createLiteasyCommandAgent(input: {
  coreInstructions?: string;
  model: string | Model;
  tools: FunctionTool<LiteasyRunContext, any>[];
}) {
  return new Agent<LiteasyRunContext>({
    handoffs: [],
    instructions: input.coreInstructions
      ? `${commandAgentInstructions}\n\nLiteasy runtime context:\n${input.coreInstructions}`
      : commandAgentInstructions,
    model: input.model,
    name: "Liteasy Command Agent",
    tools: input.tools
  });
}
