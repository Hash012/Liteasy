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
import {
  exportArtifactDocument,
  type ArtifactDocumentFormat
} from "./artifactDocumentExport";
import type { ArtifactTab } from "./artifact.types";

type ArtifactExportMenuProps = {
  tab: ArtifactTab;
};

const successMessages: Record<ArtifactDocumentFormat, string> = {
  html: "HTML 文档已导出。",
  markdown: "Markdown 文档已导出。",
  pdf: "PDF 文档已导出。"
};

export function ArtifactExportMenu({ tab }: ArtifactExportMenuProps) {
  const [message, setMessage] = useState("");

  async function runExport(format: ArtifactDocumentFormat) {
    try {
      await exportArtifactDocument(tab, format);
      setMessage(successMessages[format]);
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
            <MenuItem icon={<CodeRegular />} onClick={() => void runExport("html")}>HTML (.html)</MenuItem>
            <MenuItem icon={<DocumentPdfRegular />} onClick={() => void runExport("pdf")}>PDF (.pdf)</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <span aria-live="polite" className="artifact-export-message">{message}</span>
    </div>
  );
}
