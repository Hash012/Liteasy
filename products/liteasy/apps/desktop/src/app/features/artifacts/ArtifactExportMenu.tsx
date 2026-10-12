import { useDocumentExportPort } from "../document-export/documentExportPort";
import { DocumentExportDialog } from "../document-export/DocumentExportDialog";
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  CodeRegular,
  DocumentPdfRegular,
  DocumentTextRegular
} from "@fluentui/react-icons";
import { useState } from "react";
import type {
  ArtifactDocumentFormat,
  ArtifactExportOutcome
} from "./artifactExport.types";
import type { ArtifactTab } from "./artifact.types";

type ArtifactExportMenuProps = {
  onExport: (
    tab: ArtifactTab,
    format: ArtifactDocumentFormat
  ) => Promise<ArtifactExportOutcome>;
  tab: ArtifactTab;
};

export function ArtifactExportMenu({ onExport, tab }: ArtifactExportMenuProps) {
  const [message, setMessage] = useState("");
  const port = useDocumentExportPort();
  const [format, setFormat] = useState<ArtifactDocumentFormat>();

  async function runExport(format: ArtifactDocumentFormat) {
    if (port) { setFormat(format); return; }
    try {
      const outcome = await onExport(tab, format);
      if (outcome.status === "cancelled") {
        setMessage("");
      } else if (outcome.record.location === "desktop") {
        setMessage(`已导出到 ${outcome.record.path}`);
      } else {
        setMessage("已交给浏览器下载，保存位置由浏览器管理。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败，请重试。");
    }
  }

  return (
    <div className="artifact-export-control">
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button
            aria-label="导出为文档"
            appearance="subtle"
            icon={<ArrowDownloadRegular />}
            size="small"
            title={`导出产物：${tab.title}`}
          >
            导出为文档
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<DocumentTextRegular />} onClick={() => void runExport("markdown")}>Markdown (.md)</MenuItem>
            <MenuItem icon={<DocumentTextRegular />} onClick={() => void runExport("docx")}>Word (.docx)</MenuItem>
            <MenuItem icon={<CodeRegular />} onClick={() => void runExport("html")}>HTML (.html)</MenuItem>
            <MenuItem icon={<DocumentPdfRegular />} onClick={() => void runExport("pdf")}>PDF (.pdf)</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {port && format ? <DocumentExportDialog open title={tab.title} initialFormat={format} allowSubtree={Boolean(tab.thinReadingDocument)}
        nodes={tab.thinReadingDocument ? Object.values(tab.thinReadingDocument.nodes).map(node => ({ id: node.id, title: node.title })) : []}
        compile={(options, signal) => port.compileArtifact(tab, options, signal)} publish={port.publish}
        onClose={() => setFormat(undefined)} onOutcome={outcome => { if (outcome.status === "cancelled") setMessage(""); else setMessage(outcome.record.location === "desktop" ? `已导出到 ${outcome.record.path}${outcome.warnings?.length ? "（导出历史未保存）" : ""}` : "已交给浏览器下载，保存位置由浏览器管理。"); }} /> : null}
      <span aria-live="polite" className="artifact-export-message">{message}</span>
    </div>
  );
}
