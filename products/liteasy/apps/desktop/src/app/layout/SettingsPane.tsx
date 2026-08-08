import { useState } from "react";
import { BotRegular, ChevronDownRegular, ChevronRightRegular, DatabaseRegular, EyeRegular, FolderRegular, SettingsRegular } from "@fluentui/react-icons";
import { AgentSettingsPanel } from "../features/agent-core/AgentSettingsPanel";
import { ViewSettingsPanel } from "../features/settings/ViewSettingsPanel";
import type { AgentCoreCatalogEntry } from "../features/agent-core/agentCoreConfig";
import { LibraryLocationPanel } from "../features/library/LibraryLocationPanel";
import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { SettingsState, UpdateSettingCommand } from "../features/settings/settings.types";

type SettingsPaneProps = {
  documentMetadataSyncMessage?: string;
  libraryRootPath?: string | null;
  loadLegacyLibraryRoots?: () => Promise<string[]>;
  onBackupLibrary?: (destinationDirectory: string) => Promise<string>;
  onChangeLibraryRoot?: (nextRootPath: string) => Promise<void>;
  onOpenLibraryInFileManager?: () => Promise<void>;
  onSelectLegacyLibraryRoot?: (legacyRootPath: string) => Promise<void>;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  onRetryDocumentMetadataSync?: () => void;
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  settings?: Partial<SettingsState>;
};

export function SettingsPane({
  documentMetadataSyncMessage,
  libraryRootPath,
  loadLegacyLibraryRoots,
  onBackupLibrary,
  onChangeLibraryRoot,
  onOpenLibraryInFileManager,
  onSelectLegacyLibraryRoot,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  onOpenSkillDocument,
  onRetryDocumentMetadataSync,
  onUpdateSetting,
  settings
}: SettingsPaneProps) {
  const [viewExpanded, setViewExpanded] = useState(true);
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [syncExpanded, setSyncExpanded] = useState(true);
  const [libraryExpanded, setLibraryExpanded] = useState(libraryRootPath == null);
  return (
    <section aria-label="左边栏设置" className="settings-panel">
      <div aria-hidden="true" className="settings-panel-icon"><SettingsRegular /></div>
      <section className="sidebar-section settings-view-section">
        <button aria-expanded={viewExpanded} aria-label={`${viewExpanded ? "收起" : "展开"} View 设置`} className="sidebar-section-header" onClick={() => setViewExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{viewExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <EyeRegular />
          <span>View</span>
        </button>
        {viewExpanded ? <div className="sidebar-section-content">
          <ViewSettingsPanel onUpdateSetting={onUpdateSetting} settings={settings} />
        </div> : null}
      </section>
      <section className="sidebar-section settings-agent-section">
        <button aria-expanded={agentExpanded} aria-label={`${agentExpanded ? "收起" : "展开"} Agent 设置`} className="sidebar-section-header" onClick={() => setAgentExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{agentExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <BotRegular />
          <span>Agent</span>
        </button>
        {agentExpanded ? <div className="sidebar-section-content">
          <AgentSettingsPanel
            onOpenSkillDocument={onOpenSkillDocument}
            onUpdateSetting={onUpdateSetting}
            settings={settings}
          />
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
      <section className="sidebar-section settings-library-section">
        <button aria-expanded={libraryExpanded} aria-label={`${libraryExpanded ? "收起" : "展开"}文献库位置`} className="sidebar-section-header" onClick={() => setLibraryExpanded((current) => !current)} type="button">
          <span aria-hidden="true" className="sidebar-section-disclosure">{libraryExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}</span>
          <FolderRegular />
          <span>文献库位置</span>
        </button>
        {libraryExpanded ? <div className="sidebar-section-content">
          <LibraryLocationPanel
            loadLegacyRoots={loadLegacyLibraryRoots}
            onBackup={onBackupLibrary}
            onChangeRoot={onChangeLibraryRoot}
            onOpenInFileManager={onOpenLibraryInFileManager}
            onSelectLegacyRoot={onSelectLegacyLibraryRoot}
            rootPath={libraryRootPath}
          />
        </div> : null}
      </section>
    </section>
  );
}
