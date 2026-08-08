import type { IntuitionGraphDocument } from "../intuition-graph/intuitionGraph.types";
import type { ThinReadingDocument } from "../thin-reading/thinReading.types";

export type VisualizationTabData =
  | { code: string; id: string; kind: "mermaid"; title: string }
  | { description?: string; html: string; id: string; kind: "html_demo"; title: string }
  | {
      document: ThinReadingDocument;
      id: string;
      kind: "thin_reading_graph";
      title: string;
      viewMode?: "mindmap" | "network";
    }
  | { graph: IntuitionGraphDocument; id: string; kind: "intuition_graph"; title: string };
