import { ExtensionSettings, extensionSettingsMatch } from "../features/extensions/ExtensionSettings";
import { useExtensionWorkbench } from "../features/extensions/extensionWorkbenchContext";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button, Input, Tooltip } from "@fluentui/react-components";
import { AppsListRegular, BotRegular, CloudSyncRegular, DismissRegular, DocumentSearchRegular, FolderRegular, PaintBrushRegular, SearchRegular } from "@fluentui/react-icons";
import { PaperServicesSettingsPanel } from "../features/paper-services/PaperServicesSettingsPanel";
import { WebDavSettingsPanel } from "../features/webdav/WebDavSettingsPanel";
import { DataLocationSettings } from "../features/settings/DataLocationSettings";
import { RecommendationSettingsPanel } from "../features/settings/RecommendationSettingsPanel";
import { AnnotationSyncSettingsPanel } from "../features/settings/AnnotationSyncSettingsPanel";
import { AgentSettingsPanel } from "../features/agent-core/AgentSettingsPanel";
import { ViewSettingsPanel } from "../features/settings/ViewSettingsPanel";
import { ModelConnectionPanel } from "../features/models/ModelConnectionPanel";
import type { AgentCoreCatalogEntry } from "../features/agent-core/agentCoreConfig";
import { LibraryLocationPanel } from "../features/library/LibraryLocationPanel";
import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { SettingsState, UpdateSettingCommand } from "../features/settings/settings.types";
import { matchesSettingsSearch, settingsCategories, settingsSections, type SettingsCategory, type SettingsSectionId } from "../features/settings/settingsNavigation";
import "../features/settings/settingsPage.css";
import { LocalMcpSettingsPanel } from "../features/local-mcp/LocalMcpSettingsPanel";

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


const categoryIcons: Record<SettingsCategory, ReactElement> = {
  extensions: <AppsListRegular />,
  all: <AppsListRegular />, appearance: <PaintBrushRegular />, ai: <BotRegular />,
  papers: <DocumentSearchRegular />, storage: <FolderRegular />, sync: <CloudSyncRegular />
};

export function SettingsPane(props: SettingsPaneProps) {
  const extensions = useExtensionWorkbench();
  const [category, setCategory] = useState<SettingsCategory>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const detail = extensions?.settingsRequest;
    if (!detail) return;
    const pkg = extensions?.packages.snapshot.packages.find((item) => item.manifest.id === detail.owner);
    const group = pkg?.manifest.contributes.settings.find((item) => item.id === detail.group);
    if (group) { setCategory("extensions"); setQuery(group.title); }
  }, [extensions?.settingsRequest, extensions?.packages.snapshot]);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const searching = query.trim().length > 0;
  const visibleSections = settingsSections.filter((section) => searching
    ? matchesSettingsSearch(section, query)
    : category === "all" || section.category === category);
  const visibleExtensionCount = extensions?.packages.snapshot.packages.flatMap((pkg) => pkg.manifest.contributes.settings.filter((group) => extensionSettingsMatch(pkg, group.id, query))).length ?? 0;
  const visibleIds = new Set<SettingsSectionId>(visibleSections.map((section) => section.id));
  const shared = { settings: props.settings, onUpdateSetting: props.onUpdateSetting };
  const panels: Record<SettingsSectionId, ReactNode> = {
    appearance: <ViewSettingsPanel {...shared} />,
    models: <ModelConnectionPanel {...shared} expandAdvanced={searching} />,
    assistant: <AgentSettingsPanel {...shared} expandCapabilities={searching} onOpenSkillDocument={props.onOpenSkillDocument} />,
    "local-mcp": <LocalMcpSettingsPanel />,
    papers: <PaperServicesSettingsPanel {...shared} />,
    recommendations: <RecommendationSettingsPanel {...shared} />,
    data: <DataLocationSettings embedded />,
    library: <LibraryLocationPanel
      loadLegacyRoots={props.loadLegacyLibraryRoots} onBackup={props.onBackupLibrary}
      onChangeRoot={props.onChangeLibraryRoot} onOpenInFileManager={props.onOpenLibraryInFileManager}
      onSelectLegacyRoot={props.onSelectLegacyLibraryRoot} rootPath={props.libraryRootPath} />,
    webdav: <WebDavSettingsPanel key={props.libraryRootPath ?? "default"} embedded />,
    metadata: <DocumentMetadataSyncPanel lastResult={props.documentMetadataSyncResult}
      message={props.documentMetadataSyncMessage ?? ""} onRetrySync={props.onRetryDocumentMetadataSync}
      status={props.documentMetadataSyncStatus} />,
    annotations: <AnnotationSyncSettingsPanel {...shared} />
  };
  function resetScroll() {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }
  function clearSearch() {
    setQuery("");
    resetScroll();
    searchRef.current?.focus();
  }
  return <section aria-label="应用设置" className="settings-page">
    <header className="settings-page-header">
      <div><h1>设置</h1><p>让 Liteasy 更适合你的研究习惯</p></div>
      <Input ref={searchRef} className="settings-search" aria-label="搜索设置"
        placeholder="搜索设置，如模型、主题、保存位置" value={query}
        contentBefore={<SearchRegular aria-hidden="true" />}
        contentAfter={query ? <Tooltip content="清除搜索" relationship="description">
          <Button appearance="subtle" size="small" aria-label="清除设置搜索" icon={<DismissRegular />} onClick={clearSearch} />
        </Tooltip> : undefined}
        onChange={(_, data) => { setQuery(data.value); resetScroll(); }}
        onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); clearSearch(); } }} />
    </header>
    <div className="settings-page-body">
      <nav aria-label="设置分类" className="settings-categories">
        {settingsCategories.map((item) => <Button key={item.id} appearance="subtle"
          aria-pressed={!searching && category === item.id} icon={categoryIcons[item.id]}
          onClick={() => { setCategory(item.id); setQuery(""); resetScroll(); }}>
          {item.label}
        </Button>)}
      </nav>
      <div className="settings-content" ref={contentRef}>
        {searching ? <p className="settings-search-summary" role="status">找到 {visibleSections.length + visibleExtensionCount} 个设置分组 · 搜索全部分类</p> : null}
        {searching && visibleSections.length + visibleExtensionCount === 0 ? <div className="settings-empty">
          <SearchRegular aria-hidden="true" /><h2>没有找到相关设置</h2>
          <p>试试“API”“字体”或“同步”等关键词。</p>
          <Button onClick={clearSearch}>清除搜索</Button>
        </div> : null}
        <ExtensionSettings query={query} category={category} />
        {/* Keep forms mounted so switching categories or searching never discards unsaved input. */}
        {settingsSections.map((section) => <section key={section.id}
          aria-label={section.id === "recommendations" ? "论文推荐设置" : section.title}
          className="settings-card" hidden={!visibleIds.has(section.id)}>
          <header className="settings-card-header">
            <h2 id={`${id}-${section.id}`}>{section.title}</h2>
            <p>{section.description}</p>
          </header>
          <div className="settings-card-content">{panels[section.id]}</div>
        </section>)}
      </div>
    </div>
  </section>;
}
