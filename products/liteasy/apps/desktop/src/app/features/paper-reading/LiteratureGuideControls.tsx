import { getGenerationPrompt } from "../ai-prompts/generationPrompts";
import { useGenerationPromptSettings } from "../ai-prompts/GenerationPromptContext";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, Spinner, Tooltip } from "@fluentui/react-components";
import { SparkleRegular, DismissRegular, EyeRegular, EyeOffRegular, DeleteRegular, ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { guideCategories, guideModes, type GuideCategory, type GuideMode, type GuideOptions } from "./literatureGuide.types";
import "./literatureGuide.css";

export type LiteratureGuideState = { mode: GuideMode; options: GuideOptions; busy: boolean; visible: boolean; count: number; resume: boolean; message: string; error: string;
  ready: boolean; setMode(value: GuideMode): void; setOptions(value: GuideOptions): void; start(systemPrompt?: string): void; cancel(): void; toggle(): void; clear(): void };
const modeDescriptions: Record<GuideMode, string> = {
  detailed: "补足必要背景，解释术语、关键论断和推理步骤。",
  balanced: "略过常见概念，重点讲清影响理解的概念与因果。",
  advanced: "评析精妙设计、隐含假设、推理转折与适用边界。",
  auto: "参考你的研究熟悉度选择深度；缺少相关画像时采用均衡。"
};
export function LiteratureGuideControls({ guide }: { guide: LiteratureGuideState }) {
  const settings = useGenerationPromptSettings();
  const [open, setOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [prompt, setPrompt] = useState<string>();
  return <div className="literature-guide-controls" role="group" aria-label="文献 AI 标注">
    <Tooltip content={guide.error || guide.message || "设置讲解深度、重点与提示词，为原文添加可点击的虚线讲解"} relationship="description">
      <Button size="small" appearance="subtle" icon={guide.busy ? <Spinner size="extra-tiny" /> : <SparkleRegular />} onClick={() => setOpen(true)}>AI 标注{guide.count ? <span className="literature-guide-count">{guide.count}</span> : null}{guide.error ? " · 未完成" : ""}</Button>
    </Tooltip>
    <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
      <DialogSurface className="literature-guide-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label="关闭 AI 标注设置" icon={<DismissRegular />} onClick={() => setOpen(false)} />}>AI 标注</DialogTitle>
          <DialogContent className="literature-guide-options">
            <p className="literature-guide-hint">为论文添加简明讲解，点击原文虚线即可查看。关闭此窗口后，任务仍会继续。</p>
            <Field label="讲解深度" hint={modeDescriptions[guide.mode]}>
              <Select aria-label="AI 标注模式" value={guide.mode} disabled={guide.busy} onChange={(_, data) => guide.setMode(data.value as GuideMode)}>
                {Object.entries(guideModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <section className="literature-guide-focus">
              <Button appearance="subtle" icon={focusOpen ? <ChevronDownRegular /> : <ChevronRightRegular />} aria-expanded={focusOpen} onClick={() => setFocusOpen(!focusOpen)}>讲解重点 · 已选 {guide.options.categories.length} 类</Button>
              {focusOpen ? <div role="group" aria-label="讲解重点" className="literature-guide-categories">
                {Object.entries(guideCategories).map(([key, label]) => <Checkbox key={key} label={label} disabled={guide.busy} checked={guide.options.categories.includes(key as GuideCategory)} onChange={(_, data) => guide.setOptions({ ...guide.options, categories: data.checked ? [...guide.options.categories, key as GuideCategory] : guide.options.categories.filter((value) => value !== key) })} />)}
              </div> : null}
              {!guide.options.categories.length ? <p role="alert">请至少选择一类讲解重点。</p> : null}
            </section>
            <GenerationPromptEditor task="literature_annotation" value={prompt} disabled={guide.busy} onChange={(value) => {
              setPrompt(value); guide.setOptions({ ...guide.options, systemPrompt: value ?? "" });
            }} />
            <Field label="已有标注" hint="只处理所选类别；手动批注、已修改或已发布的讲解始终保留。">
              <Select aria-label="已有标注处理方式" disabled={guide.busy} value={guide.options.existing} onChange={(_, data) => guide.setOptions({ ...guide.options, existing: data.value as GuideOptions["existing"] })}>
                <option value="replace">更新已有 AI 标注</option><option value="append">保留已有，仅补充新标注</option>
              </Select>
            </Field>
            <p className="literature-guide-hint">每次最多处理 60 页，可继续或随时停止。无法唯一定位原文的内容会跳过。</p>
            {guide.count ? <div className="literature-guide-management"><span>已有 {guide.count} 处讲解</span>
              <Button size="small" appearance="subtle" icon={guide.visible ? <EyeRegular /> : <EyeOffRegular />} onClick={guide.toggle}>{guide.visible ? "隐藏 AI 标注" : "显示 AI 标注"}</Button>
              <Tooltip content="删除未修改的自动标注，保留手动修改和已发布的讲解" relationship="description"><Button size="small" appearance="subtle" disabled={guide.busy} icon={<DeleteRegular />} onClick={guide.clear}>删除 AI 标注</Button></Tooltip>
            </div> : null}
            {guide.message ? <p className="literature-guide-status" role="status">{guide.message}</p> : null}
            {guide.error ? <p className="literature-guide-error" role="alert">{guide.error}</p> : null}
            {!guide.ready ? <p className="literature-guide-hint">请等待论文与批注加载完成后开始。</p> : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>返回阅读</Button>
            {guide.busy ? <Button appearance="primary" onClick={guide.cancel}>停止 AI 标注</Button> : <Button appearance="primary" disabled={!guide.ready || !guide.options.categories.length} onClick={() => guide.start(getGenerationPrompt("literature_annotation", settings, prompt))}>{guide.resume ? "继续标注" : "开始标注"}</Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </div>;
}
