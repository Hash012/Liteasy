import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { OrganizationSidebarPanel } from "../../../app/features/organization/OrganizationSidebarPanel";
import { OrganizationEntryDialog } from "../../../app/features/organization/OrganizationEntryDialog";
import { ArtifactLibraryPane } from "../../../app/features/artifacts/ArtifactLibraryPane";
import type { ArtifactTab } from "../../../app/features/artifacts/artifact.types";
import { organizationUiList, organizationUiSummary } from "../../fixtures/organizationUiFixtures";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
const papers = [ { id: "larimar", title: "Larimar: Large Language Models with Episodic Memory Control", authors: ["Payel Das"], year: 2024 },
  { id: "cicada", title: "Cicada: Dependably Fast Multi-Core In-Memory Transactions", authors: ["Hyeontaek Lim"], year: 2017 } ];
const catalog: ArtifactTab[] = Array.from({ length: 24 }, (_, index) => ({ artifactId: `artifact-${index}`, createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  title: ["研究要点与阅读笔记", "记忆机制与方法比较", "组会汇报：从方法到实验结果"][index % 3], type: index % 3 === 0 ? "thin_reading" : index % 3 === 1 ? "mindmap" : "ppt",
  papers: index % 4 === 0 ? papers : [papers[index % 2]] }));
function Fixture() {
  const [dialog, setDialog] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [active, setActive] = useState("research");
  const dark = location.search.includes("dark");
  document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ height: "100vh", padding: 8 }}>
    <main className="management-fixture" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 8, height: "100%" }}>
      <section className="pane"><div className="pane-header">组织</div><div className="pane-body" style={{ padding: 10 }}>
        <OrganizationSidebarPanel accountSession={null} cloudEndpoint="http://127.0.0.1:9" list={{ ...organizationUiList, activeOrganizationId: active }}
          listStatus="success" listMessage="" onOpenWindow={() => setDialog(true)} onSelectOrganization={setActive} summary={organizationUiSummary} summaryStatus="success" summaryMessage=""
          onMarkNotificationsRead={() => setReadIds(organizationUiSummary.notifications.map((item) => `research:${item.id}`))} readNotificationIds={readIds} onOpenSharedLibrary={() => undefined} />
      </div></section>
      <section className="pane"><div className="pane-header">产物库</div><div className="pane-body" style={{ padding: 4, overflow: "hidden" }}>
        <ArtifactLibraryPane accountAvailable artifactCatalog={catalog} artifactCatalogLoadState={{ status: "ready" }} activePaperId="larimar" availablePaperIds={papers.map((paper) => paper.id)}
          exportRecords={[]} exportStatus="ready" onOpenArtifact={() => undefined} onOpenExport={() => undefined} onOpenPaper={() => undefined}
          onDeleteArtifact={() => ({ status: "success", message: "" })} onRenameArtifact={() => ({ status: "success", message: "" })}
          onReloadArtifactCatalog={() => undefined} onRefreshExports={() => undefined} onRemoveExport={() => undefined} onRevealExport={() => undefined} />
      </div></section>
    </main>
    {dialog ? <OrganizationEntryDialog list={organizationUiList} listMessage="" summary={organizationUiSummary} onSelectOrganization={setActive} onClose={() => setDialog(false)} onOpenSharedLibrary={() => undefined} /> : null}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
