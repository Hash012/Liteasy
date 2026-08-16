import type {
  ThinReadingVisualizationOmissionReason,
  ThinReadingVisualizationStatus
} from "../artifacts/artifact.types";
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
  if (status.status === "omitted") {
    const reasons: Record<ThinReadingVisualizationOmissionReason, string> = {
      capability_unavailable: "当前账号未开通可视化",
      explicit_request_unavailable: "当前账号不支持主动生成可视化",
      generation_failed: "可视化生成失败",
      intent_unavailable: "当前内容不需要可视化",
      modality_unavailable: "所需可视化类型暂不可用",
      preference_disabled: "多模态生成已关闭",
      quota_unavailable: "可视化额度暂不可用",
      result_invalid: "生成结果未通过校验",
      service_unavailable: "可视化服务暂不可用",
      stale_request: "内容已更新，请重新生成可视化"
    };
    return reasons[status.reasonCode];
  }
  return artifactsEmptyCopy;
}

const artifactsEmptyCopy = "未生成";

export function ThinReadingVisualizationRegion({ artifacts, onDeepDiveTarget, status }: ThinReadingVisualizationRegionProps) {
  if (artifacts.length === 0 && status?.status === "omitted" && status.reasonCode === "intent_unavailable") {
    return null;
  }

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
