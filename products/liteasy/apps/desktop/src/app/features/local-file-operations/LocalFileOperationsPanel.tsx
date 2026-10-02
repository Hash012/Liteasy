import { Button, Checkbox, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import type { NoteFileEntry, NoteFileMount } from "../note-files/noteFileService";
import type { CopyItemStatus, LocalCopyTask } from "./localFileOperations";

export type LocalFileOperationsView = {
  available: boolean;
  busy: boolean;
  running: boolean;
  error: string;
  source: NoteFileMount | null;
  destination: NoteFileMount | null;
  entries: NoteFileEntry[];
  selected: string[];
  task: LocalCopyTask | null;
  history: LocalCopyTask[];
  confirmation: "copy" | "retry" | "undo" | null;
  chooseSource(): void;
  chooseDestination(): void;
  select(path: string, checked: boolean): void;
  preview(): void;
  open(task: LocalCopyTask): void;
  requestConfirmation(kind: "copy" | "retry" | "undo"): void;
  dismissConfirmation(): void;
  confirm(): void;
  cancel(): void;
};
const statuses: Record<LocalCopyTask["status"], string> = {
  preview: "等待审查", running: "正在复制", completed: "已完成", partial: "部分完成，请检查回执",
  cancelled: "已取消，已提交结果保留", undoing: "正在撤销", undone: "已撤销输出",
};
const itemStatuses: Record<CopyItemStatus, string> = {
  pending: "待执行", committing: "提交中", committed: "已提交", failed: "失败", conflict: "版本冲突",
  uncertain: "提交中断，需人工核对", undoing: "撤销中", undone: "已移入备份", undo_conflict: "撤销冲突，内容保留",
};
function bytes(value: number) { return `${(value / 1024).toFixed(1)} KiB`; }

export function LocalFileOperationsPanel({ model }: { model: LocalFileOperationsView }) {
  const task = model.task;
  const committed = task?.items.filter((item) => item.status === "committed").length ?? 0;
  return <section aria-label="本地文件任务" className="settings-section">
    <h3>本地文件任务</h3>
    <p>将勾选的 Markdown / Canvas 原样复制到新的输出目录。先审查逐文件计划，再确认执行。</p>
    {!model.available ? <p role="status">此操作需要桌面应用授权本地文件夹。PDF、EPUB 和其他格式暂不支持此复制任务。</p> : <>
      <p>每批最多 100 个文件；单文件 8 MiB、总计 32 MiB；同时处理 1 个文件。不调用模型或网络。</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button disabled={model.busy} onClick={model.chooseSource}>选择来源文件夹</Button>
        <Button disabled={model.busy} onClick={model.chooseDestination}>选择输出文件夹</Button>
      </div>
      <p>来源：{model.source?.location ?? "尚未授权"}<br />输出位置：{model.destination?.location ?? "尚未授权"}</p>
      {model.entries.length > 0 && <fieldset disabled={model.busy}>
        <legend>选择文件（{model.selected.length}/100）</legend>
        <div style={{ maxHeight: 220, overflow: "auto", display: "grid" }}>
          {model.entries.map((entry) => <Checkbox key={entry.path} label={entry.path} checked={model.selected.includes(entry.path)} disabled={!model.selected.includes(entry.path) && model.selected.length >= 100} onChange={(_, data) => model.select(entry.path, data.checked === true)} />)}
        </div>
      </fieldset>}
      <Button disabled={model.busy || !model.selected.length || !model.destination} onClick={model.preview}>生成逐文件计划</Button>
      {task && <div aria-label="文件任务计划与回执">
        <h4>{statuses[task.status]}</h4>
        <p>计划来源：{task.sourceRoot}<br />新增目录：{task.destinationRoot}/{task.outputDirectory}</p>
        <p>计划 {task.items.length} 项 / {bytes(task.totalBytes)}；已提交 {committed} 项 / {bytes(task.items.filter((item) => item.status === "committed").reduce((sum, item) => sum + item.byteLength, 0))}。模型调用 0，网络调用 0。</p>
        <ol>{task.items.map((item) => <li key={item.outputPath}>
          <div>{item.sourcePath} → {item.outputPath}（{bytes(item.byteLength)}）</div>
          <div>版本 {item.sourceRevision.slice(0, 12)} · {itemStatuses[item.status]}</div>
          {item.message && <p>{item.message}</p>}
          {item.backupPath && <p>备份：{task.destinationRoot}/{item.backupPath}</p>}
        </li>)}</ol>
        {!model.running && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {task.status === "preview" && <Button appearance="primary" disabled={model.busy} onClick={() => model.requestConfirmation("copy")}>审查并确认复制</Button>}
          {!task.undoRequested && ["partial", "cancelled", "running"].includes(task.status) && <Button disabled={model.busy} onClick={() => model.requestConfirmation("retry")}>审查并重试未完成项</Button>}
          {committed > 0 && <Button disabled={model.busy} onClick={() => model.requestConfirmation("undo")}>审查撤销已提交输出</Button>}
        </div>}
        {model.confirmation && <div role="group" aria-label="确认文件任务">
          <p>{model.confirmation === "undo" ? "撤销只处理回执中的已提交输出，并将其移入同目录下的备份。人工修改或替换的文件保留。" : "确认按以上版本和路径创建输出。已有输出不会覆盖；重试跳过已提交、版本冲突和需人工核对的文件。版本冲突需重新生成计划。"}</p>
          <Button appearance="primary" disabled={model.busy} onClick={model.confirm}>{model.confirmation === "undo" ? "确认撤销输出" : "确认执行此计划"}</Button>
          <Button disabled={model.busy} onClick={model.dismissConfirmation}>返回审查</Button>
        </div>}
      </div>}
      {model.running && <><Spinner size="tiny" label="逐项处理并保存回执" /><Button onClick={model.cancel}>取消后续文件</Button><p>取消后不启动下一项；当前临界提交按回执保留。</p></>}
      {model.history.length > 0 && <details><summary>最近文件任务（最多 50 项）</summary>
        <ul>{model.history.map((previous) => <li key={previous.id}><Button disabled={model.busy} onClick={() => model.open(previous)}>{previous.outputDirectory} · {statuses[previous.status]}</Button></li>)}</ul>
      </details>}
    </>}
    {model.error && <MessageBar intent="error"><MessageBarBody>{model.error}</MessageBarBody></MessageBar>}
  </section>;
}
