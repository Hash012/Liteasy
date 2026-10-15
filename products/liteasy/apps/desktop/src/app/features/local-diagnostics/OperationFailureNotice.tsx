import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { redactDiagnostic } from "../context/objectContext";

/** Classify an operation failure; never rewrite user-authored content or its stored record. */
export function operationFailureSummary(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/来源当前不可访问|source.*(?:forbidden|not found)/i.test(message)) return "来源当前不可访问，请确认访问权限或稍后重试。";
  if (/本机存储暂不可用|local store unavailable|storage unavailable/i.test(message)) return "本机存储暂不可用，请稍后重试。";
  if (/revision_conflict|状态已变化|内容已被修改|conflict/i.test(message)) return "内容已被其他操作更新，请刷新后重试。";
  if (/object_forbidden|permission.denied|账号已切换|无权|权限/i.test(message)) return "当前账号无法完成此操作，请检查登录账号和访问权限。";
  if (/budget_exceeded|预算.*(?:不足|上限|用完)|超过.*限制/i.test(message)) return "本次操作超过了用量限制，请减少资料或调整预算后重试。";
  if (/timeout|timed out|超时/i.test(message)) return "操作等待超时，请检查网络后重试。";
  if (/ENOSPC|disk full|磁盘空间/i.test(message)) return "磁盘空间不足，请清理空间后重试。";
  if (/摘要不符|digest|schema|invalid_input|缺少包文件|包.*(?:无效|不存在)|入口.*不一致/i.test(message)) return "所用内容或扩展版本不完整，请重新导入或切换到可用版本。";
  return fallback;
}

export function OperationFailureNotice({ error, fallback }: { error: unknown; fallback: string }) {
  if (!error) return null;
  return <div className="operation-failure-notice"><p role="alert">{operationFailureSummary(error, fallback)}</p>
    <DisclosureSection title="技术详情"><pre>{redactDiagnostic(error instanceof Error ? error.message : String(error)).slice(0, 8000)}</pre></DisclosureSection>
  </div>;
}
