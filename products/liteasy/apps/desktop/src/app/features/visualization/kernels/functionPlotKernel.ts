import type {
  AccessibilityProjectionV1,
  FunctionPlotSpecV1,
  InteractionContractV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";
import { evaluateBoundedExpression } from "../math/boundedEvaluator";
import type { ExpressionAstV1 } from "../math/expressionAst";
import { parseBoundedExpression } from "../math/expressionParser";

export type FunctionPlotPointV1 = {
  derived: true;
  id: string;
  x: number;
  y: number;
};

export type FunctionPlotSegmentV1 = {
  id: string;
  points: readonly FunctionPlotPointV1[];
};

export type FunctionPlotCurveV1 = {
  evidenceClaimIds: readonly string[];
  id: string;
  segments: readonly FunctionPlotSegmentV1[];
};

export type FunctionPlotSampleResultV1 = {
  accessibility: AccessibilityProjectionV1;
  auxiliaryCurves: readonly FunctionPlotCurveV1[];
  interaction: InteractionContractV1;
  points: readonly FunctionPlotPointV1[];
  semanticObjects: readonly SemanticObjectV1[];
  segments: readonly FunctionPlotSegmentV1[];
  warnings: readonly string[];
};

const maxSamples = 10000;
const defaultSamples = 201;
const variablePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function validateFunctionPlot(spec: FunctionPlotSpecV1): void {
  if (!variablePattern.test(spec.variable)) throw new Error("function_plot_variable_invalid");
  if (!Number.isFinite(spec.domain.min) || !Number.isFinite(spec.domain.max) || spec.domain.min >= spec.domain.max) {
    throw new Error("function_plot_domain_invalid");
  }
  if (spec.parameters.length > 128 || spec.keyPoints.length > 128 || spec.auxiliaryCurves.length > 128) {
    throw new Error("function_plot_bounds_invalid");
  }

  const parameterIds = new Set<string>();
  for (const parameter of spec.parameters) {
    if (!variablePattern.test(parameter.id) || parameter.id === spec.variable || parameterIds.has(parameter.id)) {
      throw new Error("function_plot_parameter_invalid");
    }
    parameterIds.add(parameter.id);
    if (!Number.isFinite(parameter.value) || !Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || parameter.min > parameter.max) {
      throw new Error("function_plot_parameter_invalid");
    }
    if (parameter.value < parameter.min || parameter.value > parameter.max) throw new Error("function_plot_parameter_invalid");
    if (parameter.evidenceClaimIds.length === 0) throw new Error("function_plot_evidence_missing");
  }

  const variables = [spec.variable, ...parameterIds];
  parseFunctionExpression(spec.expression, variables);
  for (const curve of spec.auxiliaryCurves) {
    if (curve.evidenceClaimIds.length === 0) throw new Error("function_plot_evidence_missing");
    parseFunctionExpression(curve.expression, variables);
  }

  const keyPointIds = new Set<string>();
  for (const point of spec.keyPoints) {
    if (keyPointIds.has(point.id)) throw new Error("function_plot_key_point_invalid");
    keyPointIds.add(point.id);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < spec.domain.min || point.x > spec.domain.max) {
      throw new Error("function_plot_key_point_invalid");
    }
    if (point.evidenceClaimIds.length === 0) throw new Error("function_plot_evidence_missing");
  }
}

function parseFunctionExpression(expression: string, variables: readonly string[]) {
  try {
    return parseBoundedExpression(expression, { variables });
  } catch {
    throw new Error("function_plot_expression_forbidden");
  }
}

export function sampleFunctionPlot(
  spec: FunctionPlotSpecV1,
  sampleCount = defaultSamples,
  sampleDomain = spec.domain
): FunctionPlotSampleResultV1 {
  validateFunctionPlot(spec);
  if (!Number.isFinite(sampleDomain.min) || !Number.isFinite(sampleDomain.max) || sampleDomain.min >= sampleDomain.max) {
    throw new Error("function_plot_domain_invalid");
  }
  const boundedSampleCount = Math.min(Math.max(3, Math.floor(sampleCount)), maxSamples);
  const ast = parseBoundedExpression(spec.expression, { variables: [spec.variable, ...spec.parameters.map((parameter) => parameter.id)] });
  const parameterValues = Object.fromEntries(spec.parameters.map((parameter) => [parameter.id, parameter.value]));
  const primary = sampleAst(ast, spec.variable, parameterValues, sampleDomain, boundedSampleCount);
  const auxiliaryCurves = spec.auxiliaryCurves.map((curve) => ({
    evidenceClaimIds: curve.evidenceClaimIds,
    id: curve.id,
    segments: sampleAst(
      parseBoundedExpression(curve.expression, { variables: [spec.variable, ...spec.parameters.map((parameter) => parameter.id)] }),
      spec.variable,
      parameterValues,
      sampleDomain,
      boundedSampleCount
    ).segments
  }));

  const warnings = keyPointWarnings(spec, ast, parameterValues);
  const selectableObjectIds = [
    ...spec.keyPoints.map((point) => point.id),
    ...spec.auxiliaryCurves.map((curve) => curve.id)
  ];
  return {
    accessibility: {
      dataTable: [
        { label: spec.axes.xLabel, value: `${round(sampleDomain.min)} to ${round(sampleDomain.max)}` },
        { label: spec.axes.yLabel, value: `${primary.segments.length} curve segment${primary.segments.length === 1 ? "" : "s"}` },
        ...auxiliaryCurves.map((curve) => ({ label: curve.id, value: `${curve.segments.length} curve segment${curve.segments.length === 1 ? "" : "s"}` })),
        ...spec.keyPoints.map((point) => ({ label: point.label ?? point.id, value: `(${point.x}, ${point.y})` }))
      ],
      objectReadingOrder: selectableObjectIds,
      summary: `${spec.axes.yLabel} over ${spec.axes.xLabel} from ${round(sampleDomain.min)} to ${round(sampleDomain.max)}`
    },
    auxiliaryCurves,
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: "none",
      parameterIds: spec.parameters.map((parameter) => parameter.id),
      selectableObjectIds
    },
    points: primary.points,
    semanticObjects: [
      ...spec.keyPoints.map((point) => ({
        evidenceClaimIds: [...point.evidenceClaimIds],
        kind: "function_plot_key_point",
        label: point.label ?? point.id,
        objectId: point.id,
        objectPath: [point.id],
        selectable: true
      })),
      ...spec.auxiliaryCurves.map((curve) => ({
        evidenceClaimIds: [...curve.evidenceClaimIds],
        kind: "function_plot_auxiliary_curve",
        label: curve.id,
        objectId: curve.id,
        objectPath: [curve.id],
        selectable: true
      }))
    ],
    segments: primary.segments,
    warnings
  };
}

function sampleAst(
  ast: ExpressionAstV1,
  variable: string,
  parameterValues: Readonly<Record<string, number>>,
  domain: { min: number; max: number },
  sampleCount: number
): { points: FunctionPlotPointV1[]; segments: FunctionPlotSegmentV1[] } {
  const points: FunctionPlotPointV1[] = [];
  const segments: FunctionPlotSegmentV1[] = [];
  let current: FunctionPlotPointV1[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const x = domain.min + (domain.max - domain.min) * (index / (sampleCount - 1));
    const y = evaluateAt(ast, variable, x, parameterValues);
    if (y === null) {
      if (current.length > 0) {
        segments.push({ id: `segment-${segments.length}`, points: current });
        current = [];
      }
      continue;
    }
    const point = {
      derived: true,
      id: `sample-${index}`,
      x: round(x),
      y: round(y)
    } satisfies FunctionPlotPointV1;
    points.push(point);
    current.push(point);
  }
  if (current.length > 0) segments.push({ id: `segment-${segments.length}`, points: current });
  return { points, segments };
}

function evaluateAt(
  ast: ExpressionAstV1,
  variable: string,
  x: number,
  parameterValues: Readonly<Record<string, number>>
): number | null {
  const result = evaluateBoundedExpression(ast, { ...parameterValues, [variable]: x });
  if (result.status !== "ok" || !Number.isFinite(result.value)) return null;
  return result.value;
}

function keyPointWarnings(
  spec: FunctionPlotSpecV1,
  ast: ExpressionAstV1,
  parameterValues: Readonly<Record<string, number>>
): string[] {
  return spec.keyPoints.flatMap((point) => {
    const y = evaluateAt(ast, spec.variable, point.x, parameterValues);
    if (y === null || Math.abs(y - point.y) > 1e-6) return [`function_plot_key_point_unverified:${point.id}`];
    return [];
  });
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
