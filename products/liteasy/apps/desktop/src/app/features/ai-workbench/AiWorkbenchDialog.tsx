import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { artifactPromptTask } from "../ai-prompts/generationPrompts";
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Tab, TabList } from "@fluentui/react-components";
import { ChevronRightRegular, DismissRegular, DocumentBulletListRegular, DocumentSearchRegular, FolderRegular, OrganizationRegular, SlideTextRegular, SearchRegular, TableRegular } from "@fluentui/react-icons";
import type { ArtifactType } from "../artifacts/artifact.types";
import type { LocalLibrarySnapshot } from "../library/localLibrary.types";
import type { Paper } from "../workspace/workspace.types";
import type { ReadingCatalogEntry } from "../library/readingCatalog.types";
import { catalogSearchMetadata } from "../search/searchMetadata";
import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { aiPaperMatches, buildAiPaperFolders, type AiPaperFolder } from "./aiPaperSelection";
import "./aiWorkbench.css";

// Keep the feature independent of controllers; the shell supplies these callbacks.
export type AiWorkbenchDialogProps = {
  open: boolean; papers: Paper[]; openedPapers: Paper[]; activePaperId?: string;
  searchEntries?: ReadingCatalogEntry[];
  snapshot: LocalLibrarySnapshot | null; selectedIds: string[]; confirmed: Paper[] | null;
  message: string; selectionValid: boolean;
  onClose(): void; onToggle(id: string): void; onIncludeOpened(): void; onClear(): void;
  onConfirm(): void; onStart(type: ArtifactType, systemPrompt?: string): void;
};
const capabilities = [
  { type: "thin_reading", label: "薄读", detail: "逐篇梳理研究问题、方法和结论", icon: <DocumentSearchRegular /> },
  { type: "tree", label: "生成提纲", detail: "围绕所选论文组织主题与论点", icon: <DocumentBulletListRegular /> },
  { type: "ppt", label: "生成 PPT", detail: "制作有文献依据的演示文稿", icon: <SlideTextRegular /> },
  { type: "mindmap", label: "生成思维导图", detail: "串联概念、方法与证据", icon: <OrganizationRegular /> },
  { type: "comparison_table", label: "生成对比表", detail: "比较多篇论文的贡献与差异", icon: <TableRegular /> }
] satisfies { type: ArtifactType; label: string; detail: string; icon: React.ReactNode }[];

export function AiWorkbenchDialog(props: AiWorkbenchDialogProps) {
  const [task, setTask] = useState<ArtifactType>();
  const [prompt, setPrompt] = useState<string>();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("recent");
  const [limits, setLimits] = useState<Record<string, number>>({});
  useEffect(() => { if (props.open) { setQuery(""); setView("recent"); setLimits({}); setTask(undefined); setPrompt(undefined); } }, [props.open]);
  const selected = new Set(props.selectedIds);
  const metadata = useMemo(() => new Map(props.searchEntries?.map((entry) => [entry.id, catalogSearchMetadata(entry)])), [props.searchEntries]);
  const folders = useMemo(() => buildAiPaperFolders(props.papers, props.snapshot, query, metadata), [props.papers, props.snapshot, query, metadata]);
  const openedIds = new Set(props.openedPapers.map((paper) => paper.id));
  const recent = props.papers.filter((paper) => openedIds.has(paper.id) && aiPaperMatches(paper, query, metadata.get(paper.id)));
  function paperRows(papers: Paper[], key: string) {
    const limit = limits[key] ?? 50;
    return <>
      {papers.slice(0, limit).map((paper) => <div className={`ai-paper-row${selected.has(paper.id) ? " selected" : ""}`} key={paper.id}>
        <Checkbox checked={selected.has(paper.id)} disabled={!paper.sourcePath} onChange={() => props.onToggle(paper.id)}
          label={<span className="ai-paper-label"><strong><SearchHighlight text={paper.title} query={query} /></strong><small>{paper.id === props.activePaperId ? "当前阅读" : openedIds.has(paper.id) ? "已打开" : paper.sourcePath?.split(/[\\/]/).at(-1)}{!paper.sourcePath ? "全文不可用" : ""}</small></span>} />
      </div>)}
      {papers.length > limit ? <Button appearance="subtle" onClick={() => setLimits((previous) => ({ ...previous, [key]: limit + 50 }))}>显示更多论文（{papers.length - limit}）</Button> : null}
    </>;
  }
  function folderRows(folder: AiPaperFolder) {
    return <details className="ai-paper-folder" key={folder.id} open={query ? true : undefined}>
      <summary><ChevronRightRegular className="ai-folder-chevron" aria-hidden="true" /><FolderRegular aria-hidden="true" />{folder.name}</summary>
      <div>{folder.children.map(folderRows)}{paperRows(folder.papers, folder.id)}</div>
    </details>;
  }
  return <Dialog open={props.open} onOpenChange={(_, data) => { if (!data.open) props.onClose(); }}>
    <DialogSurface className="ai-workbench-dialog" style={{ width: "min(940px, calc(100vw - 32px))", maxWidth: "none" }}>
      <DialogBody>
        <DialogTitle action={<Button appearance="subtle" aria-label="关闭 AI 工作台" title="关闭" icon={<DismissRegular />} onClick={props.onClose} />}>
          <span className="ai-workbench-brand">AI</span> 论文工作台
        </DialogTitle>
        <DialogContent className="ai-workbench-content">
          <section className="ai-workbench-papers" aria-label="选择任务论文">
            <h3>1. 选择论文</h3>
            <Input aria-label="搜索任务论文" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} placeholder="搜索标题、作者或文件名" />
            <SearchOptions query={query} onChange={setQuery} tags={[...metadata.values()].flatMap((item) => item.tags ?? [])} />
            <TabList selectedValue={view} onTabSelect={(_, data) => setView(String(data.value))}>
              <Tab value="recent">近期论文（{props.openedPapers.length}）</Tab><Tab value="library">文献目录</Tab>
            </TabList>
            <div className="ai-paper-picker-scroll">
              {view === "recent" ? <>
                <Button appearance="subtle" disabled={!props.openedPapers.some((paper) => paper.sourcePath)} onClick={props.onIncludeOpened}>纳入已打开论文</Button>
                {paperRows(recent, "recent")}
                {!recent.length ? <p className="ai-workbench-muted">{query ? "没有匹配的近期论文。" : "暂无打开的论文，可从文献目录选择。"}</p> : null}
              </> : <>
                {folders.children.map(folderRows)}{paperRows(folders.papers, "root")}
                {!folders.children.length && !folders.papers.length ? <p className="ai-workbench-muted">没有找到论文，请先在文献库导入 PDF。</p> : null}
              </>}
            </div>
            <div className="ai-paper-confirm">
              <span>已选 {props.selectedIds.length} 篇</span>
              <Button appearance="subtle" disabled={!props.selectedIds.length} onClick={props.onClear}>清空</Button>
              <Button appearance="primary" disabled={!props.selectionValid || Boolean(props.confirmed)} onClick={props.onConfirm}>{props.confirmed ? "已确认选择" : "确认选择"}</Button>
            </div>
          </section>
          <section className="ai-workbench-capabilities" aria-label="选择 AI 能力">
            <h3>2. 选择 AI 能力</h3>
            <p className="ai-workbench-muted">{props.confirmed ? `本次任务使用已确认的 ${props.confirmed.length} 篇论文。更改勾选后需重新确认。` : "确认左侧论文后，即可开始。"}</p>
            {props.confirmed ? <ul className="ai-confirmed-papers" aria-label="已确认的任务论文">{props.confirmed.map((paper) => <li key={paper.id}>{paper.title}</li>)}</ul> : null}
            <div className="ai-capability-list">{capabilities.map((capability) => <Button key={capability.type} className="ai-capability" appearance="outline"
              aria-label={capability.label} disabled={!props.confirmed} icon={capability.icon} aria-pressed={task === capability.type} onClick={() => { setTask(capability.type); setPrompt(undefined); }}>
              <span><strong>{capability.label}</strong><small>{capability.detail}</small></span>
            </Button>)}</div>
            {task ? <div className="ai-generation-options">
              <GenerationPromptEditor key={task} task={artifactPromptTask(task)} value={prompt} onChange={setPrompt} disabled={!props.confirmed} />
              <Button appearance="primary" disabled={!props.confirmed} onClick={() => props.onStart(task, prompt)}>开始生成</Button>
            </div> : null}
            {props.message ? <p role="status" className="ai-workbench-result">{props.message}</p> : null}
          </section>
        </DialogContent>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
