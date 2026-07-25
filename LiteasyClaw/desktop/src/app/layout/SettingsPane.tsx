import { useState } from "react";
import { ChevronDownRegular, ChevronRightRegular, DatabaseRegular, SettingsRegular, BotRegular } from "@fluentui/react-icons";
import { AgentSettingsPanel } from "../features/agent-core/AgentSettingsPanel";
import type { AgentCoreCatalogEntry } from "../features/agent-core/agentCoreConfig";
import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";

type SettingsPaneProps = {
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  onRetryDocumentMetadataSync?: () => void;
};

export function SettingsPane({
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  onOpenSkillDocument,
  onRetryDocumentMetadataSync,
}: SettingsPaneProps) {
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [syncExpanded, setSyncExpanded] = useState(true);
  return (
    <section aria-label="左边栏设置" className="settings-panel">
      <div aria-hidden="true" className="settings-panel-icon"><SettingsRegular /></div>
      <section className="sidebar-section settings-agent-section">
        <button aria-expanded={agentExpanded} aria-label={`${agentExpanded ? "收起" : "展开"} Agent 设置`} className="sidebar-section-header" onClick={() => setAgentExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{agentExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <BotRegular />
          <span>Agent</span>
        </button>
        {agentExpanded ? <div className="sidebar-section-content">
          <AgentSettingsPanel onOpenSkillDocument={onOpenSkillDocument} />
        </div> : null}
      </section>
      <section className="sidebar-section settings-sync-section">
        <button aria-expanded={syncExpanded} aria-label={`${syncExpanded ? "收起" : "展开"}文献同步`} className="sidebar-section-header" onClick={() => setSyncExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{syncExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <DatabaseRegular />
          <span>文献同步</span>
        </button>
        {syncExpanded ? <div className="sidebar-section-content">
          <DocumentMetadataSyncPanel
            lastResult={documentMetadataSyncResult}
            message={documentMetadataSyncMessage ?? ""}
            onRetrySync={onRetryDocumentMetadataSync}
            status={documentMetadataSyncStatus}
          />
        </div> : null}
      </section>
    </section>
  );
}
