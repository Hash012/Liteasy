import { Button, Spinner } from "@fluentui/react-components";
import "./thinReading.css";

type ThinReadingGenerationStatusProps = {
  failureMessage?: string;
  floating?: boolean;
  locale?: "en" | "zh";
  onOpenDetails?: () => void;
  status?: "running" | "failed" | "cancelled";
};

/** Keep reading focused; the associated conversation holds the detailed generation history. */
export function ThinReadingGenerationStatus({
  failureMessage,
  floating = false,
  locale = "zh",
  onOpenDetails,
  status = "running"
}: ThinReadingGenerationStatusProps) {
  const message = status === "failed"
    ? failureMessage || (locale === "zh" ? "生成未完成" : "Generation failed")
    : status === "cancelled"
      ? (locale === "zh" ? "薄读生成已取消。" : "Generation cancelled")
      : (locale === "zh" ? "生成中" : "Generating");
  return (
    <div
      aria-live="polite"
      className={`thin-reading__generation-status${floating ? " is-floating" : ""}`}
      role="status"
    >
      {status === "running" ? <Spinner aria-hidden="true" size="tiny" /> : null}
      <span>{message}</span>
      <Button
        appearance="subtle"
        disabled={!onOpenDetails}
        onClick={onOpenDetails}
        size="small"
        title={locale === "zh" ? "在 AI 对话中查看生成详情" : "View generation details in the AI conversation"}
      >{locale === "zh" ? "详情" : "Details"}</Button>
    </div>
  );
}
