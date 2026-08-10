import type {
  AccessibilityProjectionV1,
  InteractionContractV1,
  PhysicsProcessSpecV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";
import { evaluateBoundedExpression } from "../math/boundedEvaluator";
import { parseBoundedExpression } from "../math/expressionParser";

export type PhysicsProcessFrameV1 = {
  index: number;
  state: Record<string, number>;
  time: number;
};

export type PhysicsProcessResultV1 = {
  accessibility: AccessibilityProjectionV1;
  frames: readonly PhysicsProcessFrameV1[];
  interaction: InteractionContractV1;
  replay: {
    algorithmId: "physics-process-euler/v1";
    errorTolerance: number;
    precision: "double";
    seed: string;
  };
  semanticObjects: readonly SemanticObjectV1[];
};

const maxFrames = 120;
const idPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function validatePhysicsProcess(spec: PhysicsProcessSpecV1): void {
  if (!Number.isFinite(spec.duration) || spec.duration <= 0 || !Number.isFinite(spec.frameRate) || spec.frameRate <= 0) {
    throw new Error("physics_process_time_invalid");
  }
  if (Math.ceil(spec.duration * spec.frameRate) > maxFrames) throw new Error("physics_process_frame_limit");
  if (!Number.isFinite(spec.errorTolerance) || spec.errorTolerance < 0) throw new Error("physics_error_tolerance_invalid");
  if (spec.evidenceBindings.length === 0) throw new Error("physics_process_evidence_missing");

  const stateIds = Object.keys(spec.initialState);
  if (stateIds.length === 0 || stateIds.some((id) => !idPattern.test(id) || !Number.isFinite(spec.initialState[id]))) {
    throw new Error("physics_process_state_invalid");
  }
  const parameterIds = new Set<string>();
  for (const parameter of spec.parameters) {
    if (!idPattern.test(parameter.id) || parameterIds.has(parameter.id)) throw new Error("physics_process_parameter_invalid");
    parameterIds.add(parameter.id);
    if (!Number.isFinite(parameter.value) || !Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) ||
      parameter.min > parameter.max || parameter.value < parameter.min || parameter.value > parameter.max) {
      throw new Error("physics_process_parameter_invalid");
    }
    if (parameter.evidenceClaimIds.length === 0) throw new Error("physics_process_evidence_missing");
  }
  const variables = [...stateIds, ...parameterIds, "dt", "time"];
  for (const equation of spec.equations) {
    if (!stateIds.includes(equation.id)) throw new Error("physics_process_equation_invalid");
    if (equation.evidenceClaimIds.length === 0) throw new Error("physics_process_evidence_missing");
    parseProcessExpression(equation.expression, variables);
  }
  for (const invariant of spec.invariants) {
    if (invariant.evidenceClaimIds.length === 0) throw new Error("physics_process_evidence_missing");
    parseProcessExpression(invariant.expression, variables);
  }
  for (const event of spec.events) {
    if (!Number.isFinite(event.time) || event.time < 0 || event.time > spec.duration) throw new Error("physics_process_event_invalid");
    if (event.evidenceClaimIds.length === 0) throw new Error("physics_process_evidence_missing");
  }
}

export function simulatePhysicsProcess(spec: PhysicsProcessSpecV1, seed = spec.seed ?? "physics-process"): PhysicsProcessResultV1 {
  validatePhysicsProcess(spec);
  if (spec.errorTolerance <= 0) throw new Error("physics_error_tolerance_exceeded");
  const dt = 1 / spec.frameRate;
  const frameCount = Math.ceil(spec.duration * spec.frameRate);
  const parameterValues = Object.fromEntries(spec.parameters.map((parameter) => [parameter.id, parameter.value]));
  const equationAsts = spec.equations.map((equation) => ({
    ast: parseProcessExpression(equation.expression, [...Object.keys(spec.initialState), ...Object.keys(parameterValues), "dt", "time"]),
    id: equation.id
  }));
  const invariantAsts = spec.invariants.map((invariant) => ({
    ast: parseProcessExpression(invariant.expression, [...Object.keys(spec.initialState), ...Object.keys(parameterValues), "dt", "time"]),
    id: invariant.id
  }));
  const frames: PhysicsProcessFrameV1[] = [];
  let state = { ...spec.initialState };
  for (let index = 0; index <= frameCount; index += 1) {
    const time = Number((index * dt).toFixed(6));
    const scope = { ...parameterValues, ...state, dt, time };
    for (const invariant of invariantAsts) {
      const result = evaluateBoundedExpression(invariant.ast, scope);
      if (result.status !== "ok" || result.value < 1) throw new Error("physics_invariant_failed");
    }
    frames.push({ index, state: roundState(state), time });
    const next = { ...state };
    for (const equation of equationAsts) {
      const result = evaluateBoundedExpression(equation.ast, scope);
      if (result.status !== "ok") throw new Error("physics_non_finite_state");
      next[equation.id] = result.value;
    }
    state = next;
  }
  const selectableObjectIds = ["trajectory", ...spec.events.map((event) => event.id)];
  return {
    accessibility: {
      dataTable: [
        { label: "duration", value: `${spec.duration}s` },
        { label: "frames", value: String(frames.length) },
        ...spec.parameters.map((parameter) => ({ label: parameter.id, value: `${parameter.value} ${parameter.unit}` }))
      ],
      objectReadingOrder: selectableObjectIds,
      summary: `Physics process over ${spec.duration} seconds`
    },
    frames,
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: "timeline",
      parameterIds: spec.parameters.map((parameter) => parameter.id),
      selectableObjectIds
    },
    replay: {
      algorithmId: "physics-process-euler/v1",
      errorTolerance: spec.errorTolerance,
      precision: "double",
      seed
    },
    semanticObjects: selectableObjectIds.map((id) => ({
      evidenceClaimIds: spec.evidenceBindings,
      kind: id === "trajectory" ? "trajectory" : "event",
      label: id,
      objectId: id,
      objectPath: [id],
      selectable: true
    }))
  };
}

function parseProcessExpression(expression: string, variables: readonly string[]) {
  try {
    return parseBoundedExpression(expression, { variables });
  } catch {
    throw new Error("physics_process_expression_invalid");
  }
}

function roundState(state: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, Number(value.toFixed(6))]));
}
