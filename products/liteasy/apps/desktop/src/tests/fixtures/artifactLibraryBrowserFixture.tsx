import { useState } from "react";
import { ArtifactLibraryPane } from "../../app/features/artifacts/ArtifactLibraryPane";
import type { ArtifactExportRecord } from "../../app/features/artifacts/artifactExport.types";
import type { ArtifactTab } from "../../app/features/artifacts/artifact.types";

const savedArtifact: ArtifactTab = {
  artifactId: "artifact-thin-reading-fixture",
  createdAt: "2026-08-09T01:00:00.000Z",
  papers: [{ id: "paper-attention", title: "Attention Is All You Need" }],
  title: "Transformer 论文薄读",
  type: "thin_reading"
};

const initialExports: ArtifactExportRecord[] = [{
  artifactId: savedArtifact.artifactId,
  exportedAt: "2026-08-09T04:00:00.000Z",
  fileName: "Transformer 论文薄读.md",
  format: "markdown",
  id: "export-available",
  location: "desktop",
  path: "/Users/researcher/Documents/Liteasy/exports/Transformer 论文薄读.md",
  status: "available",
  title: "Transformer 论文薄读"
}, {
  artifactId: savedArtifact.artifactId,
  exportedAt: "2026-08-09T03:00:00.000Z",
  fileName: "Transformer 论文薄读.pdf",
  format: "pdf",
  id: "export-missing",
  location: "desktop",
  path: "/Users/researcher/Documents/Liteasy/exports/archive/Transformer 论文薄读.pdf",
  status: "missing",
  title: "Transformer 论文薄读"
}, {
  artifactId: "artifact-browser-fixture",
  exportedAt: "2026-08-09T02:00:00.000Z",
  fileName: "研究脉络.html",
  format: "html",
  id: "export-browser",
  location: "browser",
  status: "browser_managed",
  title: "研究脉络"
}];

export default function ArtifactLibraryBrowserFixture() {
  const [artifacts, setArtifacts] = useState([savedArtifact]);
  const [exports, setExports] = useState(initialExports);

  return (
    <main style={{ boxSizing: "border-box", height: "100vh", padding: 12 }}>
      <aside className="pane left" style={{ height: "100%", maxWidth: 420, width: "100%" }}>
        <div className="pane-header">产物库</div>
        <div className="pane-body" style={{ padding: 0 }}>
          <ArtifactLibraryPane
            accountAvailable
            artifactCatalog={artifacts}
            artifactCatalogLoadState={{ status: "ready" }}
            exportRecords={exports}
            exportStatus="ready"
            onDeleteArtifact={(artifactId) => {
              setArtifacts((current) => current.filter((item) => item.artifactId !== artifactId));
            }}
            onOpenArtifact={() => undefined}
            onOpenExport={() => undefined}
            onReloadArtifactCatalog={() => undefined}
            onRefreshExports={() => undefined}
            onRemoveExport={(recordId) => {
              setExports((current) => current.filter((record) => record.id !== recordId));
            }}
            onRenameArtifact={(artifactId, name) => {
              setArtifacts((current) => current.map((item) => (
                item.artifactId === artifactId ? { ...item, title: name } : item
              )));
            }}
            onRevealExport={() => undefined}
          />
        </div>
      </aside>
    </main>
  );
}
