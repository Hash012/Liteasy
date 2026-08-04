import { useState } from "react";
import { HtmlDemoPreview } from "./HtmlDemoPreview";
import { ObsidianLikeGraphCanvas } from "../layered-reading/ObsidianLikeGraphCanvas";
import { defaultGraphViewState } from "../layered-reading/layeredReading.types";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { ThinReadingGraphView } from "../thin-reading/ThinReadingGraphView";
import type { ThinReadingGraphMode } from "../thin-reading/ThinReadingGraphView";
import type { VisualizationTabData } from "./visualization.types";
import "./visualization.css";

export function VisualizationTab({ data }: { data: VisualizationTabData }) {
  const [graphView, setGraphView] = useState(defaultGraphViewState);
  const [activeThinNodeId, setActiveThinNodeId] = useState(
    data.kind === "thin_reading_graph" ? data.document.activeNodeId : ""
  );
  const [thinGraphMode, setThinGraphMode] = useState<ThinReadingGraphMode>(
    data.kind === "thin_reading_graph" ? data.viewMode ?? "network" : "network"
  );
  return (
    <main className="visualization-tab" aria-label={`放大查看：${data.title}`}>
      <header><span>VISUALIZATION</span><h1>{data.title}</h1><p>独立标签页支持缩放、拖动与完整查看。</p></header>
      {data.kind === "html_demo" ? (
        <HtmlDemoPreview
          description={data.description}
          html={data.html}
          title={data.title}
        />
      ) : null}
      {data.kind === "mermaid" ? <MermaidPreview code={data.code} title={data.title} /> : null}
      {data.kind === "intuition_graph" ? <ObsidianLikeGraphCanvas graph={data.graph} onViewChange={setGraphView} view={graphView} /> : null}
      {data.kind === "thin_reading_graph" ? (
        <ThinReadingGraphView
          activeNodeId={activeThinNodeId}
          document={data.document}
          onSelectNode={setActiveThinNodeId}
          onViewModeChange={setThinGraphMode}
          viewMode={thinGraphMode}
        />
      ) : null}
    </main>
  );
}
