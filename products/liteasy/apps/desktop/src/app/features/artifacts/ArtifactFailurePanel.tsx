import { useState } from "react";
import { Button } from "@fluentui/react-components";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import type { ArtifactDiagnostic } from "./artifactDiagnostic";

export function ArtifactFailurePanel({ diagnostic, onAnalyze }: { diagnostic: ArtifactDiagnostic; onAnalyze(): void }) {
  const [status, setStatus] = useState("");
  return <section aria-label="任务失败说明">
    <p role="alert">{diagnostic.summary}</p>
    <Button appearance="primary" onClick={onAnalyze}>让 AI 分析错误</Button>
    <DisclosureSection title="查看诊断日志">
      <p>以下内容可像普通资料一样加入对话。密钥已隐藏；不会自动发送。</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit" }}>{diagnostic.context.message}</pre>
      <Button onClick={() => void navigator.clipboard.writeText(diagnostic.context.message).then(() => setStatus("日志已复制"), () => setStatus("复制失败，可选中日志手动复制"))}>复制日志</Button>
      <Button onClick={() => {
        const url = URL.createObjectURL(new Blob([diagnostic.context.message], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = "Liteasy-任务诊断日志.txt"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出日志</Button>
      {status ? <p role="status">{status}</p> : null}
    </DisclosureSection>
  </section>;
}
