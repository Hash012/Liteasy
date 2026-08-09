import { useEffect, useState } from "react";
import type { VisualizationArtifactV1 } from "./visualizationArtifact.types";
import { loadVisualizationRenderer, type VisualizationRenderer } from "./visualizationRendererRegistry";

export function VisualizationArtifactHost({ artifact }: { artifact: VisualizationArtifactV1 }) {
  const [renderer, setRenderer] = useState<VisualizationRenderer | null>(null);

  useEffect(() => {
    let active = true;
    setRenderer(null);
    void loadVisualizationRenderer(artifact.implementation.rendererId)
      .then((loaded) => {
        if (active) setRenderer(loaded);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artifact.artifactId, artifact.implementation.rendererId]);

  let rendered: unknown = null;
  if (renderer?.render) {
    try {
      rendered = renderer.render(artifact);
    } catch {
      rendered = null;
    }
  }

  return (
    <div
      aria-label={artifact.accessibility.summary}
      className="visualization-artifact-host"
      data-artifact-id={artifact.artifactId}
      data-testid="visualization-artifact-stage"
    >
      {rendered && typeof rendered !== "string" ? rendered as JSX.Element : null}
      {!rendered ? (
        <div className="visualization-artifact-host__fallback">
          <strong>{artifact.accessibility.summary}</strong>
          <span>{artifact.semanticObjects.length > 0 ? `${artifact.semanticObjects.length} 个可深入对象` : "已简化为可访问摘要"}</span>
        </div>
      ) : null}
    </div>
  );
}
