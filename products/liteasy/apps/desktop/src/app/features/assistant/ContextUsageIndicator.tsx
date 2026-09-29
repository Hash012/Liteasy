import { Tooltip } from "@fluentui/react-components";
import type { AgentContextUsage } from "./assistant.types";

export function ContextUsageIndicator({ usage }: { usage: AgentContextUsage }) {
  const maximum = Math.max(1, Math.floor(Number.isFinite(usage.maxTokens) ? usage.maxTokens : 32768));
  const used = Math.max(0, Math.ceil(Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0));
  const percentage = Math.round(used / maximum * 100);
  const label = `上下文占用 ${usage.estimated ? "约 " : ""}${percentage}%`;
  const detail = <div className="assistant-context-usage-detail">
    <strong>{label}</strong>
    <dl><div><dt>{usage.estimated ? "已用（估算）" : "已用"}</dt><dd>{used.toLocaleString()} tokens</dd></div>
      <div><dt>上限</dt><dd>{maximum.toLocaleString()} tokens</dd></div></dl>
    {used > maximum ? <span>已超出上下文上限</span> : percentage >= 90 ? <span>接近上下文上限</span> : null}
  </div>;
  return <Tooltip content={detail} relationship="description" positioning="above" showDelay={150}>
    <span className={`assistant-context-usage${percentage >= 90 ? " near-limit" : ""}`} role="meter" tabIndex={0}
      aria-label="上下文占用" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(used, maximum)}
      aria-valuetext={`${label}，已用${usage.estimated ? "约" : ""} ${used.toLocaleString()} tokens，上限 ${maximum.toLocaleString()} tokens`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className="assistant-context-ring-track" cx="12" cy="12" r="8" />
        <circle className="assistant-context-ring-fill" cx="12" cy="12" r="8" pathLength="100"
          strokeDasharray={`${Math.min(used / maximum * 100, 100)} 100`} transform="rotate(-90 12 12)" />
      </svg>
    </span>
  </Tooltip>;
}
