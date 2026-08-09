import type { ThinReadingVisualizationStatus } from "../artifacts/artifact.types";
import type { VisualizationArtifactV1 } from "../visualization/visualizationArtifact.types";
import type { DeepDiveTargetV1 } from "../visualization/visualizationArtifact.types";
import { VisualizationArtifactHost } from "../visualization/VisualizationArtifactHost";

type ThinReadingVisualizationRegionProps = {
  artifacts: readonly VisualizationArtifactV1[];
  onDeepDiveTarget?: (target: DeepDiveTargetV1) => void;
  status?: ThinReadingVisualizationStatus;
};

function statusCopy(status: ThinReadingVisualizationStatus | undefined) {
  if (!status || status.status === "idle") return artifactsEmptyCopy;
  if (status.status === "generating") return "生成中";
  if (status.status === "omitted") return "已简化";
  return artifactsEmptyCopy;
}

const artifactsEmptyCopy = "未生成";

export function ThinReadingVisualizationRegion({ artifacts, onDeepDiveTarget, status }: ThinReadingVisualizationRegionProps) {
  const copy = statusCopy(status);
  return (
    <section aria-label="生成可视化" className="thin-reading__visualizations" data-testid="thin-reading-visuals">
      {artifacts.length > 0 ? artifacts.map((artifact) => (
        <VisualizationArtifactHost artifact={artifact} key={artifact.artifactId} onDeepDiveTarget={onDeepDiveTarget} />
      )) : (
        <div className="thin-reading__visualizations-empty">{copy}</div>
      )}
    </section>
  );
}
