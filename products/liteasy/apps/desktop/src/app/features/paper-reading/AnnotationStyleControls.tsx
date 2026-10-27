import { useState } from "react";
import { Button, Field, Switch, Textarea } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import { annotationStyleMaxLength } from "./annotationStyle";
import type { AnnotationStyleController } from "./useAnnotationStyle";

export function AnnotationStyleControls({ style, disabled }: { style: AnnotationStyleController; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const busy = disabled || style.busy;
  return <section className="literature-guide-focus" aria-label="个人批注风格">
    <Button appearance="subtle" icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />} aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>个人批注风格{style.enabled ? " · 已启用" : ""}</Button>
    {expanded ? <div className="annotation-style-settings">
      <p className="literature-guide-hint">从个人文献中已保存的手动批注学习表达方式与关注点。样例会发送给当前模型；AI 标注、速问、查词和 review 不作为学习样例。</p>
      <div className="literature-guide-management">
        <Button size="small" disabled={busy} onClick={() => void style.learn()}>从手动批注学习</Button>
        <Button size="small" disabled={busy} onClick={() => void style.select()}>选择风格文件</Button>
        {style.learning ? <Button size="small" onClick={style.cancel}>停止学习</Button> : null}
      </div>
      {style.fileName ? <>
        <p className="literature-guide-hint">风格文件：{style.fileName}</p>
        <Switch checked={style.enabled} disabled={busy} onChange={(_, data) => style.setEnabled(data.checked)} label="后续 AI 标注使用此风格文件" />
      </> : null}
      {style.draft || style.fileName ? <>
        <Field label="批注风格内容" hint="可以修改后保存。风格只影响表达，原文定位与证据要求保持不变。">
          <Textarea aria-label="批注风格内容" value={style.draft} disabled={busy} rows={8} resize="vertical"
            maxLength={annotationStyleMaxLength} onChange={(_, data) => style.setDraft(data.value)} />
        </Field>
        <div className="literature-guide-management">
          <Button size="small" appearance="primary" disabled={busy || !style.draft.trim()} onClick={() => void style.save()}>保存风格文件</Button>
          {style.fileName ? <Button size="small" disabled={busy} onClick={() => void style.reload()}>重新读取文件</Button> : null}
          {style.dirty ? <span>草稿尚未保存</span> : null}
        </div>
      </> : null}
      {style.message ? <p className="literature-guide-status" role="status">{style.message}</p> : null}
    </div> : null}
    {style.error ? <p className="literature-guide-error" role="alert">{style.error}</p> : null}
  </section>;
}
