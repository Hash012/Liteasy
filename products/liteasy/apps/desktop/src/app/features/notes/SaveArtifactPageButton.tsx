import { useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { NotebookAddRegular } from "@fluentui/react-icons";
import { useObjectWorkbench } from "../objects/objectWorkbenchPort";
import { useNotes } from "./notesPort";

export function SaveArtifactPageButton({ artifactId, pageId, title, text, paperIds, paperAnchors }: {
  paperAnchors?: import("../paper-anchors/paperAnchorEntity").PaperAnchorEntity[];
  artifactId: string; pageId: string; title: string; text: string; paperIds: readonly string[];
}) {
  const workbench = useObjectWorkbench();
  const notes = useNotes();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (!notes || !workbench?.captureArtifactPage) return null;
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const ref = await workbench!.captureArtifactPage!({ artifactId, pageId, title, text, paperIds: [...paperIds], paperAnchors });
      await notes!.collect({ kind: "object", ref }, "default/artifact");
      setMessage("已收藏到 Notes");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "收藏失败，请重试。");
    } finally { setSaving(false); }
  }
  return <>
    <Tooltip content={message || "将当前页收藏到 Notes"} relationship="description">
      <Button appearance="subtle" aria-label="将当前页收藏到 Notes" disabled={saving}
        icon={<NotebookAddRegular />} onClick={() => void save()} />
    </Tooltip>
    {message ? <span role="status">{message}</span> : null}
  </>;
}
