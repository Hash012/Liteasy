import orientationImage from "../../../../../../../development/test-data/document-export/orientation.jpg?inline";
import mixedResearch from "../../../../../../../development/test-data/document-export/mixed-research.md?raw";
import { useMemo } from "react";
import { ArtifactTabs } from "../../app/features/artifacts/ArtifactTabs";
import { createArtifactExportClient } from "../../app/features/artifacts/artifactExportClient";
import { useArtifactExportController } from "../../app/controllers/useArtifactExportController";
import { DocumentExportContext } from "../../app/features/document-export/documentExportPort";
import type { ArtifactTab } from "../../app/features/artifacts/artifact.types";

const artifact: ArtifactTab = {
  answer: "QVLA 使用动作空间敏感度来识别对视觉控制最关键的区域。\n\n" + mixedResearch.replace("../probe/input.png", orientationImage),
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

  const exports = useArtifactExportController({ client });
  return (
    <DocumentExportContext.Provider value={exports.actions}>
    <main className="dock-artifact-surface" style={{ boxSizing: "border-box", height: "100vh" }}>
      <ArtifactTabs
        activeArtifactId={artifact.artifactId}
        analysisHint=""
        canStartAnalysis={false}
        onExportArtifact={exports.actions.exportArtifact}
        onStartAnalysis={() => undefined}
        selectedCount={0}
        selectionLocked={false}
        tabs={[artifact]}
        tasks={[]}
      />
    </main>
    </DocumentExportContext.Provider>
  );
}
