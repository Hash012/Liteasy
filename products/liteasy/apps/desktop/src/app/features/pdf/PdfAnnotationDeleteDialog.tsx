import { useEffect, useRef } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";

export function PdfAnnotationDeleteDialog({ annotation, onCancel, onConfirm, restoreFocus }: {
  annotation: PdfAnnotationV2; onCancel(): void; onConfirm(): void; restoreFocus(): void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Focus after the opening pointer event and modal registration have settled.
    const frame = requestAnimationFrame(() => cancelButton.current?.focus());
    return () => { cancelAnimationFrame(frame); requestAnimationFrame(restoreFocus); };
  }, []);
  const publication = annotation.publication;
  const needsRetraction = Boolean(publication.remoteAnnotationId || publication.pendingCreateOperation ||
    publication.state === "pending_create" || publication.state === "pending_retract");
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onCancel(); }}>
    <DialogSurface aria-label="删除批注确认" className="pdf-annotation-delete-dialog">
      <DialogBody>
        <DialogTitle>删除这条批注？</DialogTitle>
        <DialogContent>
          <p>第 {annotation.page} 页 · {annotation.excerpt}</p>
          <p>{needsRetraction ? "将先从论坛撤回，确认撤回成功后再删除本地批注。撤回失败时会保留批注。" : "此操作将删除原文标记和这条批注的内容。"}</p>
        </DialogContent>
        <DialogActions>
          <Button ref={cancelButton} appearance="secondary" onClick={onCancel}>保留批注</Button>
          <Button appearance="primary" onClick={onConfirm}>确认删除</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
