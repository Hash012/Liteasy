import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import type { JSX, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { RasterIllustrationSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import { loadConfiguredRasterAsset, type RasterAssetLoader } from "../rasterAssetClient";
import { validateRasterImage } from "../validators/rasterValidators";
import "./rasterIllustrationRenderer.css";

export type RasterIllustrationRenderResult = {
  selectableObjectIds: readonly string[];
  spec: RasterIllustrationSpecV1;
  summary: string;
  table: readonly { label: string; value: string }[];
};

type RasterViewport = { scale: number; x: number; y: number };

export function renderRasterIllustration(spec: RasterIllustrationSpecV1): RasterIllustrationRenderResult {
  if (spec.evidenceClaimIds.length === 0 || spec.labels.length === 0 || spec.labels.some((label) => label.evidenceClaimIds.length === 0)) {
    throw new Error("raster_evidence_missing");
  }
  const asset = spec.asset;
  if (!asset || asset.assetRef !== `raster:${asset.sha256}` || asset.width !== spec.composition.width ||
    asset.height !== spec.composition.height || asset.mimeType !== "image/png" || asset.byteLength <= 0 ||
    asset.labelVerification.verifiedLabelIds.length !== spec.labels.length ||
    spec.labels.some((label) => !asset.labelVerification.verifiedLabelIds.includes(label.id))) {
    throw new Error("raster_asset_metadata_invalid");
  }
  return {
    selectableObjectIds: spec.labels.map((label) => label.id),
    spec,
    summary: spec.visualSchema,
    table: spec.labels.map((label) => ({ label: label.id, value: label.text }))
  };
}

export function RasterIllustrationRenderer({
  loadAsset = loadConfiguredRasterAsset,
  rendered
}: {
  loadAsset?: RasterAssetLoader;
  rendered: RasterIllustrationRenderResult;
}): JSX.Element {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<"error" | "loading" | "ready">("loading");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<RasterViewport>({ scale: 1, x: 0, y: 0 });
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const asset = rendered.spec.asset!;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setRuntime("loading");
    setAssetUrl(null);
    void loadAsset(asset.assetRef, controller.signal)
      .then(async (loaded) => {
        await validateRasterImage({
          bytes: loaded.bytes,
          declaredSha256: asset.sha256,
          mimeType: loaded.mimeType,
          spec: rendered.spec
        });
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([loaded.bytes as BlobPart], { type: loaded.mimeType }));
        setAssetUrl(objectUrl);
        setRuntime("ready");
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setRuntime("error");
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.assetRef, asset.sha256, loadAsset, rendered.spec]);

  const zoom = (factor: number) => setViewport((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  const reset = () => setViewport({ scale: 1, x: 0, y: 0 });
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setViewport((value) => ({ ...value, x: value.x + dx, y: value.y + dy }));
  };
  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === event.pointerId) pointer.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  return (
    <section
      aria-label={rendered.summary}
      className="visualization-raster-illustration"
      data-runtime={runtime}
      data-testid="raster-illustration-runtime"
    >
      <div aria-label="插图视图控制" className="visualization-raster-illustration__toolbar">
        <Tooltip content="放大" relationship="label">
          <Button aria-label="放大生成插图" icon={<ZoomInRegular />} onClick={() => zoom(1.2)} size="small" />
        </Tooltip>
        <Tooltip content="缩小" relationship="label">
          <Button aria-label="缩小生成插图" icon={<ZoomOutRegular />} onClick={() => zoom(1 / 1.2)} size="small" />
        </Tooltip>
        <Tooltip content="重置视图" relationship="label">
          <Button aria-label="重置生成插图视图" icon={<ArrowResetRegular />} onClick={reset} size="small" />
        </Tooltip>
        <span className="visualization-raster-illustration__provenance">生成插图</span>
      </div>
      <div
        aria-label="生成插图画布"
        className="visualization-raster-illustration__stage"
        data-viewport={`${viewport.scale.toFixed(3)}:${viewport.x.toFixed(1)}:${viewport.y.toFixed(1)}`}
        onPointerCancel={releasePointer}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onWheel={onWheel}
        style={{ aspectRatio: `${rendered.spec.composition.width} / ${rendered.spec.composition.height}` }}
        tabIndex={0}
      >
        {assetUrl ? (
          <img
            alt={rendered.summary}
            draggable={false}
            height={rendered.spec.composition.height}
            src={assetUrl}
            style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
            width={rendered.spec.composition.width}
          />
        ) : (
          <div className="visualization-raster-illustration__status" role={runtime === "error" ? "alert" : "status"}>
            {runtime === "error" ? "插图不可用" : "正在载入插图"}
          </div>
        )}
        {selectedObjectId ? (
          <output className="visualization-raster-illustration__selection">
            {rendered.table.find((row) => row.label === selectedObjectId)?.value}
          </output>
        ) : null}
      </div>
      <div aria-label="插图标签" className="visualization-raster-illustration__objects">
        {rendered.selectableObjectIds.map((id) => (
          <Button
            appearance={selectedObjectId === id ? "primary" : "subtle"}
            aria-pressed={selectedObjectId === id}
            data-object-id={id}
            key={id}
            onClick={() => setSelectedObjectId((current) => current === id ? null : id)}
            size="small"
          >
            {id}
          </Button>
        ))}
      </div>
      <table className="visualization-raster-illustration__table">
        <tbody>
          {rendered.table.map((row) => (
            <tr className={selectedObjectId === row.label ? "is-selected" : undefined} key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export const rasterIllustrationVisualizationRenderer = {
  id: "raster-illustration-svg",
  modality: "raster_illustration",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "raster_illustration") throw new Error("raster_illustration_artifact_invalid");
    return <RasterIllustrationRenderer rendered={renderRasterIllustration(artifact.spec.payload)} />;
  },
  version: "1.0.0"
} as const;

function clampScale(value: number): number {
  return Math.max(0.5, Math.min(4, value));
}
