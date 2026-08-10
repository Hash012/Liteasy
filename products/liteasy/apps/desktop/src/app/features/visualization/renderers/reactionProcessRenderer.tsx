import type { JSX } from "react";
import { useState } from "react";
import type { ReactionProcessSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { ReactionProcessResultV1 } from "../kernels/reactionProcessKernel";
import { validateReactionProcess } from "../kernels/reactionProcessKernel";

export type ReactionProcessRenderResult = ReactionProcessResultV1 & {
  selectableObjectIds: readonly string[];
  svg: string;
};

const width = 720;
const height = 180;

export function renderReactionProcess(spec: ReactionProcessSpecV1): ReactionProcessRenderResult {
  const result = validateReactionProcess(spec);
  const equation = result.equations[0]?.text ?? "Reaction";
  return {
    ...result,
    selectableObjectIds: result.interaction.selectableObjectIds,
    svg: [
      `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(equation)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<g id="object-${escapeText(result.equations[0]?.id ?? "reaction")}" tabindex="0">`,
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#111827" font-size="24">${escapeText(equation)}</text>`,
      `</g>`,
      `</svg>`
    ].join("")
  };
}

export function ReactionProcessRenderer({ rendered }: { rendered: ReactionProcessRenderResult }): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const lastStep = Math.max(0, rendered.equations.length);
  return (
    <section aria-label={rendered.accessibility.summary} className="visualization-reaction-process">
      <div dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      <div aria-label="反应过程控制">
        <button onClick={() => setStepIndex(Math.max(0, stepIndex - 1))} type="button">上一步</button>
        <output data-testid="reaction-process-step">{stepIndex} / {lastStep}</output>
        <button onClick={() => setStepIndex(Math.min(lastStep, stepIndex + 1))} type="button">下一步</button>
      </div>
      <div aria-label="反应对象">
        {rendered.selectableObjectIds.map((id) => (
          <button
            aria-pressed={selectedObjectId === id}
            data-object-id={id}
            key={id}
            onClick={() => setSelectedObjectId(id)}
            type="button"
          >
            {id}
          </button>
        ))}
      </div>
      <table>
        <tbody>
          {rendered.accessibility.dataTable?.map((row) => (
            <tr key={`${row.label}:${row.value}`}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export const reactionProcessVisualizationRenderer = {
  id: "reaction-process-svg",
  modality: "reaction_process",
  render(artifact: VisualizationArtifactV1) {
    if (artifact.spec.modality !== "reaction_process") throw new Error("reaction_process_artifact_invalid");
    return <ReactionProcessRenderer rendered={renderReactionProcess(artifact.spec.payload)} />;
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
