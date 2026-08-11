import { Button, Slider, Tooltip } from "@fluentui/react-components";
import { NextRegular, PauseRegular, PlayRegular, PreviousRegular } from "@fluentui/react-icons";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ReactionProcessSpecV1, VisualizationArtifactV1 } from "../visualizationArtifact.types";
import type { ReactionProcessResultV1 } from "../kernels/reactionProcessKernel";
import { validateReactionProcess } from "../kernels/reactionProcessKernel";
import "./processRenderer.css";

export type ReactionSceneV1 = {
  focusObjectIds: readonly string[];
  id: string;
  label: string;
  phase: "mechanism" | "products" | "reactants" | "transition";
  stepId: string;
};

export type ReactionProcessRenderResult = ReactionProcessResultV1 & {
  scenes: readonly ReactionSceneV1[];
  selectableObjectIds: readonly string[];
  spec: ReactionProcessSpecV1;
  svg: string;
};

const width = 720;
const height = 280;

export function renderReactionProcess(spec: ReactionProcessSpecV1): ReactionProcessRenderResult {
  const result = validateReactionProcess(spec);
  const scenes = buildReactionScenes(spec);
  return projectReactionScene(spec, result, scenes, 0, null);
}

export function projectReactionScene(
  spec: ReactionProcessSpecV1,
  result: ReactionProcessResultV1,
  scenes: readonly ReactionSceneV1[],
  requestedSceneIndex: number,
  selectedObjectId: string | null
): ReactionProcessRenderResult {
  const sceneIndex = Math.max(0, Math.min(scenes.length - 1, Math.round(requestedSceneIndex)));
  const scene = scenes[sceneIndex];
  const step = spec.steps.find((item) => item.id === scene.stepId)!;
  const speciesById = new Map(spec.species.map((species) => [species.id, species]));
  const equation = result.equations.find((item) => item.id === step.id)?.text ?? "Reaction";
  const reactantObjects = renderSpeciesSide(
    step.reactants,
    speciesById,
    { height: 104, width: 290, x: 28, y: 116 },
    scene,
    selectedObjectId
  );
  const productObjects = renderSpeciesSide(
    step.products,
    speciesById,
    { height: 104, width: 290, x: 402, y: 116 },
    scene,
    selectedObjectId
  );
  const conditions = spec.conditions.map((condition) => `${condition.label}${condition.value ? `: ${condition.value}` : ""}`).join(" · ");
  const transitionVisible = scene.phase === "transition" || scene.phase === "mechanism";
  const mechanismLabel = scene.phase === "mechanism" ? scene.label : "";
  const stepSelected = selectedObjectId === step.id;

  return {
    ...result,
    scenes,
    selectableObjectIds: result.interaction.selectableObjectIds,
    spec,
    svg: [
      `<svg data-scene-index="${sceneIndex}" data-scene-phase="${scene.phase}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block" role="img" aria-label="${escapeText(`${equation}; ${scene.label}`)}" xmlns="http://www.w3.org/2000/svg">`,
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
      `<g id="object-${escapeText(step.id)}" tabindex="0">`,
      `<rect x="12" y="12" width="696" height="252" rx="6" fill="none" stroke="${stepSelected ? "#0F6CBD" : "#D8E1E8"}" stroke-width="${stepSelected ? 3 : 1}"/>`,
      `<text x="28" y="40" fill="#1D2B36" font-size="18" font-weight="600">${escapeText(scene.label)}</text>`,
      `<text x="28" y="68" fill="#475569" font-size="14"${equation.length > 78 ? ' textLength="664" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeText(equation)}</text>`,
      ...reactantObjects,
      ...productObjects,
      `<g opacity="${transitionVisible ? 1 : 0.22}"><line x1="328" y1="168" x2="390" y2="168" stroke="#0F6CBD" stroke-width="3"/><path d="M 390 168 L 378 161 L 378 175 Z" fill="#0F6CBD"/></g>`,
      conditions && transitionVisible ? `<text x="359" y="144" text-anchor="middle" fill="#713F12" font-size="11"${conditions.length > 20 ? ' textLength="100" lengthAdjust="spacingAndGlyphs"' : ""}>${escapeText(conditions)}</text>` : "",
      mechanismLabel ? `<rect x="220" y="228" width="280" height="24" rx="4" fill="#F0F6FA" stroke="#A9C7DF"/><text x="360" y="245" text-anchor="middle" fill="#0C3B5E" font-size="12">${escapeText(mechanismLabel)}</text>` : "",
      `</g>`,
      `<text x="692" y="252" text-anchor="end" fill="#64748B" font-size="11">${sceneIndex + 1} / ${scenes.length}</text>`,
      `</svg>`
    ].join("")
  };
}

export function ReactionProcessRenderer({ rendered }: { rendered: ReactionProcessRenderResult }): JSX.Element {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const lastScene = Math.max(0, rendered.scenes.length - 1);
  const activeRender = useMemo(
    () => projectReactionScene(rendered.spec, rendered, rendered.scenes, sceneIndex, selectedObjectId),
    [rendered, sceneIndex, selectedObjectId]
  );

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setSceneIndex((current) => {
        if (current >= lastScene) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [isPlaying, lastScene]);

  const moveToScene = (nextScene: number) => {
    setIsPlaying(false);
    setSceneIndex(Math.max(0, Math.min(lastScene, nextScene)));
  };

  return (
    <section aria-label={activeRender.accessibility.summary} className="visualization-reaction-process visualization-process">
      <div
        className="visualization-process__stage"
        data-scene-phase={activeRender.scenes[sceneIndex]?.phase}
        data-testid="reaction-process-stage"
        dangerouslySetInnerHTML={{ __html: activeRender.svg }}
      />
      <div aria-label="反应过程控制" className="visualization-process__toolbar">
        <Tooltip content="上一步" relationship="label">
          <Button aria-label="上一步" disabled={sceneIndex === 0} icon={<PreviousRegular />} onClick={() => moveToScene(sceneIndex - 1)} size="small" />
        </Tooltip>
        <Tooltip content={isPlaying ? "暂停" : "播放"} relationship="label">
          <Button
            aria-label={isPlaying ? "暂停" : "播放"}
            disabled={lastScene === 0}
            icon={isPlaying ? <PauseRegular /> : <PlayRegular />}
            onClick={() => {
              if (sceneIndex >= lastScene) setSceneIndex(0);
              setIsPlaying((current) => !current);
            }}
            size="small"
          />
        </Tooltip>
        <Tooltip content="下一步" relationship="label">
          <Button aria-label="下一步" disabled={sceneIndex === lastScene} icon={<NextRegular />} onClick={() => moveToScene(sceneIndex + 1)} size="small" />
        </Tooltip>
        <output data-testid="reaction-process-step">{sceneIndex} / {lastScene}</output>
      </div>
      <label className="visualization-process__timeline">
        <span>阶段</span>
        <Slider
          aria-label="反应步骤"
          max={lastScene}
          min={0}
          onChange={(_, data) => moveToScene(data.value)}
          step={1}
          value={sceneIndex}
        />
        <output>{activeRender.scenes[sceneIndex]?.label}</output>
      </label>
      {rendered.spec.conditions.length > 0 ? (
        <dl aria-label="反应条件" className="visualization-process__conditions">
          {rendered.spec.conditions.map((condition) => (
            <div key={condition.id}>
              <dt>{condition.label}</dt>
              <dd>{condition.value ?? "present"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div aria-label="反应对象" className="visualization-process__objects">
        {activeRender.selectableObjectIds.map((id) => (
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
      <table className="visualization-process__table">
        <tbody>
          {activeRender.accessibility.dataTable?.map((row) => (
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

function buildReactionScenes(spec: ReactionProcessSpecV1): ReactionSceneV1[] {
  return spec.steps.flatMap((step) => {
    const reactantIds = step.reactants.map((item) => item.speciesId);
    const productIds = step.products.map((item) => item.speciesId);
    return [
      {
        focusObjectIds: reactantIds,
        id: `${step.id}-reactants`,
        label: "反应物",
        phase: "reactants" as const,
        stepId: step.id
      },
      {
        focusObjectIds: [...reactantIds, ...productIds],
        id: `${step.id}-transition`,
        label: "反应转化",
        phase: "transition" as const,
        stepId: step.id
      },
      ...(step.mechanism ?? []).map((mechanism) => ({
        focusObjectIds: [...reactantIds, ...productIds],
        id: `${step.id}-mechanism-${mechanism.id}`,
        label: mechanism.label,
        phase: "mechanism" as const,
        stepId: step.id
      })),
      {
        focusObjectIds: productIds,
        id: `${step.id}-products`,
        label: "产物",
        phase: "products" as const,
        stepId: step.id
      }
    ];
  });
}

function renderSpeciesSide(
  items: readonly ReactionProcessSpecV1["steps"][number]["reactants"][number][],
  speciesById: ReadonlyMap<string, ReactionProcessSpecV1["species"][number]>,
  area: { height: number; width: number; x: number; y: number },
  scene: ReactionSceneV1,
  selectedObjectId: string | null
): string[] {
  const gap = 10;
  const itemWidth = Math.min(132, (area.width - gap * (items.length - 1)) / items.length);
  const totalWidth = itemWidth * items.length + gap * (items.length - 1);
  const startX = area.x + (area.width - totalWidth) / 2;
  return items.map((item, index) => {
    const species = speciesById.get(item.speciesId)!;
    const x = startX + index * (itemWidth + gap);
    const focused = scene.focusObjectIds.includes(item.speciesId);
    const selected = selectedObjectId === item.speciesId;
    const formula = stripStateSuffix(species.formula);
    return [
      `<g id="object-${escapeText(species.id)}" opacity="${focused ? 1 : 0.2}" tabindex="0">`,
      `<rect x="${num(x)}" y="${area.y}" width="${num(itemWidth)}" height="${area.height}" rx="6" fill="${selected ? "#E5F1FB" : "#F8FAFC"}" stroke="${selected ? "#0F6CBD" : "#AFC1CF"}" stroke-width="${selected ? 3 : 1}"/>`,
      `<text x="${num(x + itemWidth / 2)}" y="${area.y + 42}" text-anchor="middle" fill="#111827" font-size="18" font-weight="600"${formula.length > Math.max(4, itemWidth / 10) ? ` textLength="${num(Math.max(12, itemWidth - 14))}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeText(`${item.coefficient === 1 ? "" : item.coefficient}${formula}`)}</text>`,
      `<text x="${num(x + itemWidth / 2)}" y="${area.y + 68}" text-anchor="middle" fill="#475569" font-size="12">(${species.state})</text>`,
      `<text x="${num(x + itemWidth / 2)}" y="${area.y + 88}" text-anchor="middle" fill="#64748B" font-size="10">${escapeText(species.id)}</text>`,
      `</g>`
    ].join("");
  });
}

function stripStateSuffix(formula: string): string {
  return formula.replace(/\((?:aq|s|l|g)\)$/u, "");
}

function num(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function escapeText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
