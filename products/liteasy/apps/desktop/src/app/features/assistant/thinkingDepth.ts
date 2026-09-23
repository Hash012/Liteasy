export const thinkingDepths = ["quick", "balanced", "deliberate"] as const;
export type ThinkingDepth = typeof thinkingDepths[number];
export const thinkingDepthLabels: Record<ThinkingDepth, string> = {
  quick: "快速", balanced: "均衡", deliberate: "熟虑",
};

/** A provider-independent reasoning preference; never requests private reasoning traces. */
export function thinkingDepthInstruction(depth: ThinkingDepth = "balanced"): string {
  const instructions: Record<ThinkingDepth, string> = {
    quick: "优先快速回应，聚焦核心问题和必要验证，简洁给出结论；不要省略影响正确性的证据核验。",
    balanced: "兼顾响应速度与分析深度，检查关键依据后给出清晰的结论和必要解释。",
    deliberate: "仔细分析约束与证据，比较可行方案，复核关键推断和边界情况，再给出结论、依据与不确定性。",
  };
  return `用户选择的思考深度：${thinkingDepthLabels[depth]}。${instructions[depth]}只呈现结论与必要依据，不输出内部思维链。`;
}
