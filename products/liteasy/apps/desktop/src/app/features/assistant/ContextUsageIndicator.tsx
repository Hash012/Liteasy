import { Tooltip } from "@fluentui/react-components";
import type { AgentContextUsage } from "./assistant.types";

export function ContextUsageIndicator({ usage }: { usage: AgentContextUsage }) {
  const maximum = Math.max(1, Math.floor(Number.isFinite(usage.maxTokens) ? usage.maxTokens : 32768));
  const used = Math.max(0, Math.ceil(Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0));
  const percentage = Math.round(used / maximum * 100);
  const label = `上下文 ${usage.estimated ? "约 " : ""}${percentage}% · 上限 ${maximum.toLocaleString()} tokens`;
  const detail = `${usage.estimated ? "估算" : "已用"} ${used.toLocaleString()} / ${maximum.toLocaleString()} tokens。包含本轮发给模型的指令、对话与已读取资料；只加入资产索引不会自动载入全文。`;
  return <Tooltip content={detail} relationship="description">
    <div className={`assistant-context-usage${percentage >= 90 ? " near-limit" : ""}`} aria-label={label} title={detail}>
      <span className="assistant-context-usage-track" role="meter" aria-label="上下文占用"
        aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(used, maximum)} aria-valuetext={label}>
        <span style={{ width: `${Math.min(percentage, 100)}%` }} />
      </span>
      <span>{label}</span>
    </div>
  </Tooltip>;
}
