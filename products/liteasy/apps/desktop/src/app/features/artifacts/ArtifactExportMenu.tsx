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

  async function runExport(format: ArtifactDocumentFormat) {
    try {
      const outcome = await onExport(tab, format);
      if (outcome.status === "cancelled") {
        setMessage("");
      } else if (outcome.record.location === "desktop") {
        setMessage(`已导出到 ${outcome.record.path}`);
      } else {
        setMessage("文档已导出，由浏览器下载设置管理。");
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
            <MenuItem icon={<CodeRegular />} onClick={() => void runExport("html")}>HTML (.html)</MenuItem>
            <MenuItem icon={<DocumentPdfRegular />} onClick={() => void runExport("pdf")}>PDF (.pdf)</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <span aria-live="polite" className="artifact-export-message">{message}</span>
    </div>
  );
}
