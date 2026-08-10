import type { JSX } from "react";
import type { RasterIllustrationSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";

export type RasterIllustrationRenderResult = {
  selectableObjectIds: readonly string[];
  svg: string;
  summary: string;
  table: readonly { label: string; value: string }[];
};

export function renderRasterIllustration(spec: RasterIllustrationSpecV1): RasterIllustrationRenderResult {
  if (spec.evidenceClaimIds.length === 0 || spec.labels.some((label) => label.evidenceClaimIds.length === 0)) {
    throw new Error("raster_evidence_missing");
  }
  const width = Math.min(720, Math.max(240, spec.composition.width));
  const height = Math.min(480, Math.max(180, spec.composition.height));
  const labels = spec.labels.map((label, index) => {
    const y = 72 + index * 36;
    return `<g id="object-${escapeText(label.id)}" tabindex="0"><text x="40" y="${y}" fill="#111827">${escapeText(label.text)}</text></g>`;
  });
  return {
    selectableObjectIds: spec.labels.map((label) => label.id),
    summary: spec.visualSchema,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(spec.visualSchema)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" stroke="#CBD5E1"/>`,
      `<text x="40" y="36" fill="#334155">Generated raster illustration</text>`,
      ...labels,
      `</svg>`
    ].join(""),
    table: spec.labels.map((label) => ({ label: label.id, value: label.text }))
  };
}

export function RasterIllustrationRenderer({ rendered }: { rendered: RasterIllustrationRenderResult }): JSX.Element {
  return (
    <section aria-label={rendered.summary} className="visualization-raster-illustration">
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      <table>
        <tbody>
          {rendered.table.map((row) => (
            <tr key={row.label}>
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

function escapeText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
