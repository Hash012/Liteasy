import { useMemo } from "react";
import { ArtifactTabs } from "../../app/features/artifacts/ArtifactTabs";
import { createArtifactExportClient } from "../../app/features/artifacts/artifactExportClient";
import { createArtifactExportPayload } from "../../app/features/artifacts/artifactDocumentExport";
import type { ArtifactTab } from "../../app/features/artifacts/artifact.types";

const artifact: ArtifactTab = {
  answer: "QVLA 使用动作空间敏感度来识别对视觉控制最关键的区域。",
  artifactId: "artifact-export-browser-fixture",
  outlineNodes: [{
    id: "root",
    kind: "root",
    label: "QVLA 思维导图"
  }],
  papers: [{ id: "paper-qvla", title: "QVLA" }],
  title: "QVLA 导出测试",
  type: "mindmap"
};

export default function ArtifactExportBrowserFixture() {
  const client = useMemo(() => createArtifactExportClient(), []);

  return (
    <main className="dock-artifact-surface" style={{ boxSizing: "border-box", height: "100vh" }}>
      <ArtifactTabs
        activeArtifactId={artifact.artifactId}
        analysisHint=""
        canStartAnalysis={false}
        onExportArtifact={(tab, format) => (
          client.export(createArtifactExportPayload(tab, format))
        )}
        onStartAnalysis={() => undefined}
        selectedCount={0}
        selectionLocked={false}
        tabs={[artifact]}
        tasks={[]}
      />
    </main>
  );
}
