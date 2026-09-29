import { Button, Select, Tooltip } from "@fluentui/react-components";
import { SparkleRegular, DismissRegular, EyeRegular, EyeOffRegular, DeleteRegular } from "@fluentui/react-icons";
import { guideModes, type GuideMode } from "./literatureGuide.types";
import "./literatureGuide.css";

export type LiteratureGuideState = { mode: GuideMode; busy: boolean; visible: boolean; count: number; resume: boolean; message: string; error: string;
  ready: boolean; setMode(value: GuideMode): void; start(): void; cancel(): void; toggle(): void; clear(): void };
export function LiteratureGuideControls({ guide }: { guide: LiteratureGuideState }) {
  return <div className="literature-guide-controls" role="group" aria-label="文献 AI 标注">
    <Tooltip content="为术语、论断与推理添加简明讲解；点击虚线查看。每次最多处理 60 页，可继续或停止。" relationship="description">
      <Button size="small" appearance="subtle" icon={<SparkleRegular />} disabled={!guide.ready || guide.busy} onClick={guide.start}>{guide.resume ? "继续标注" : guide.count ? "重新标注" : "AI 标注"}</Button>
    </Tooltip>
    <Select size="small" aria-label="AI 标注模式" value={guide.mode} disabled={guide.busy} onChange={(_, data) => guide.setMode(data.value as GuideMode)}>
      {Object.entries(guideModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
    {guide.busy ? <Tooltip content="停止生成，保留已完成标注" relationship="description"><Button size="small" appearance="subtle" aria-label="停止 AI 标注" icon={<DismissRegular />} onClick={guide.cancel} /></Tooltip> : null}
    {guide.count ? <>
      <Tooltip content={guide.visible ? "隐藏 AI 标注" : "显示 AI 标注"} relationship="description"><Button size="small" appearance="subtle" aria-label={guide.visible ? "隐藏 AI 标注" : "显示 AI 标注"} aria-pressed={guide.visible} icon={guide.visible ? <EyeRegular /> : <EyeOffRegular />} onClick={guide.toggle} /></Tooltip>
      <Tooltip content="删除自动标注，保留已手动修改的讲解和其他批注" relationship="description"><Button size="small" appearance="subtle" aria-label="删除 AI 标注" disabled={guide.busy} icon={<DeleteRegular />} onClick={guide.clear} /></Tooltip>
    </> : null}
    {guide.message ? <span className="literature-guide-status" role="status" title={guide.message}>{guide.message}</span> : null}
    {guide.error ? <span className="literature-guide-error" role="alert">{guide.error}</span> : null}
  </div>;
}
