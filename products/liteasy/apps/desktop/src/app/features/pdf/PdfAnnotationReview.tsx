import { useState } from "react";
import { Button, Textarea, Tooltip } from "@fluentui/react-components";
import { CheckmarkRegular, DismissRegular, EditRegular } from "@fluentui/react-icons";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import type { PdfAnnotationReview as Review, PdfAnnotationV2 } from "./pdfAnnotationStorage";
import type { PdfEntryReviewState } from "./usePdfAnnotationReview";

export function PdfAnnotationReview({ annotation, state, onCancel, onSave }: {
  annotation: PdfAnnotationV2;
  state?: PdfEntryReviewState;
  onCancel(): void;
  onSave(expectedRevision: number, review: Review): Promise<void>;
}) {
  const [editing, setEditing] = useState<{ text: string; revision: number; review: Review } | null>(null);
  const [saving, setSaving] = useState(false);
  const review = state?.generated ?? annotation.review;
  async function save() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await onSave(editing.revision, { ...editing.review, text: editing.text, updatedAt: new Date().toISOString() });
      setEditing(null);
    } catch {
      // Keep the user's draft available when the durable save fails or the entry changed.
    } finally {
      setSaving(false);
    }
  }
  if (!review && !state?.pending && !state?.error) return null;
  return <section aria-label="AI review" className="pdf-entry-review">
    <header>
      <strong>AI review</strong>
      {state?.pending ? <>
        <span role="status">正在 review…</span>
        <Tooltip content="取消 AI review" relationship="description">
          <Button aria-label="取消 AI review" appearance="subtle" size="small" icon={<DismissRegular />} onClick={onCancel} />
        </Tooltip>
      </> : review && !editing ? <Tooltip content={state?.generated ? "核对并保存 review" : "编辑 AI review"} relationship="description">
        <Button aria-label={state?.generated ? "核对并保存 review" : "编辑 AI review"} appearance="subtle" size="small" icon={<EditRegular />}
          onClick={() => setEditing({ text: review.text, revision: annotation.revision, review })} />
      </Tooltip> : null}
    </header>
    {state?.error ? <p role="alert">{state.error}</p> : null}
    {editing ? <>
      <Textarea aria-label="AI review 内容" value={editing.text} resize="vertical" rows={5} disabled={saving}
        onChange={(_, data) => setEditing({ ...editing, text: data.value })} />
      <div className="pdf-annotation-editor-actions">
        <Tooltip content="保存 AI review" relationship="description">
          <Button aria-label="保存 AI review" appearance="primary" size="small" icon={<CheckmarkRegular />}
            disabled={saving} onClick={() => void save()} />
        </Tooltip>
        <Tooltip content="取消编辑 review" relationship="description">
          <Button aria-label="取消编辑 review" appearance="subtle" size="small" icon={<DismissRegular />}
            disabled={saving} onClick={() => setEditing(null)} />
        </Tooltip>
      </div>
    </> : review ? <PdfAnnotationMarkdown value={review.text} /> : null}
  </section>;
}
