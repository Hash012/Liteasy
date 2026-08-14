import { readFileSync } from "node:fs";

const artifactSchema = JSON.parse(readFileSync(new URL(
  "../../../packages/shared/visualizationArtifact.v1.schema.json",
  import.meta.url
), "utf8"));

function pass() {
  return { outcome: "pass" };
}

function fail(diagnosticCode) {
  return { diagnosticCode, outcome: "fail" };
}

function requireEvidence(ids, code) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(code);
}

function requireUnique(ids, code) {
  if (new Set(ids).size !== ids.length) throw new Error(code);
}

function proposalSchema(modality) {
  const spec = structuredClone(artifactSchema.properties.spec.oneOf.find(
    (candidate) => candidate.properties?.modality?.const === modality
  ));
  if (!spec) throw new Error("visualization_compiler_schema_missing");
  return {
    additionalProperties: false,
    properties: {
      accessibility: structuredClone(artifactSchema.properties.accessibility),
      evidenceBindings: structuredClone(artifactSchema.properties.evidenceBindings),
      interaction: structuredClone(artifactSchema.properties.interaction),
      semanticObjects: structuredClone(artifactSchema.properties.semanticObjects),
      spec
    },
    required: ["accessibility", "evidenceBindings", "interaction", "semanticObjects", "spec"],
    type: "object"
  };
}

const identifierPattern = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;
const expressionForbiddenPattern = /(?:globalThis|window|document|constructor|prototype|function|=>|import|new\s|[.[\]{};'"])/u;

function validateExpression(value, variables) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || expressionForbiddenPattern.test(value)) {
    throw new Error("function_plot_expression_forbidden");
  }
  const identifiers = value.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [];
  const functions = new Set(["sin", "cos", "tan", "exp", "log", "sqrt", "abs"]);
  const variableSet = new Set(variables);
  for (const id of identifiers) {
    if (!functions.has(id) && !variableSet.has(id)) throw new Error("function_plot_expression_forbidden");
  }
}

function validateFunctionPlot({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!identifierPattern.test(payload.variable)) throw new Error("function_plot_variable_invalid");
    if (!Number.isFinite(payload.domain?.min) || !Number.isFinite(payload.domain?.max) || payload.domain.min >= payload.domain.max) {
      throw new Error("function_plot_domain_invalid");
    }
    const parameterIds = new Set();
    for (const parameter of payload.parameters ?? []) {
      if (!identifierPattern.test(parameter.id) || parameter.id === payload.variable || parameterIds.has(parameter.id)) throw new Error("function_plot_parameter_invalid");
      parameterIds.add(parameter.id);
      if (!Number.isFinite(parameter.value) || !Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) ||
        parameter.min > parameter.max || parameter.value < parameter.min || parameter.value > parameter.max) {
        throw new Error("function_plot_parameter_invalid");
      }
      requireEvidence(parameter.evidenceClaimIds, "function_plot_evidence_missing");
    }
    const variables = [payload.variable, ...parameterIds];
    validateExpression(payload.expression, variables);
    for (const point of payload.keyPoints ?? []) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < payload.domain.min || point.x > payload.domain.max) {
        throw new Error("function_plot_key_point_invalid");
      }
      requireEvidence(point.evidenceClaimIds, "function_plot_evidence_missing");
    }
    for (const curve of payload.auxiliaryCurves ?? []) {
      requireEvidence(curve.evidenceClaimIds, "function_plot_evidence_missing");
      validateExpression(curve.expression, variables);
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateGeometry2D({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    if (!Number.isFinite(payload.viewport?.xMin) || !Number.isFinite(payload.viewport?.xMax) || payload.viewport.xMin >= payload.viewport.xMax ||
      !Number.isFinite(payload.viewport?.yMin) || !Number.isFinite(payload.viewport?.yMax) || payload.viewport.yMin >= payload.viewport.yMax) {
      throw new Error("geometry_viewport_invalid");
    }
    requireUnique(payload.objects.map((object) => object.id), "geometry_id_duplicate");
    const objectIds = new Set(payload.objects.map((object) => object.id));
    for (const object of payload.objects) {
      requireEvidence(object.evidenceClaimIds, "geometry_evidence_missing");
      for (const value of Object.values(object.data ?? {})) {
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error("geometry_coordinate_invalid");
        if (Array.isArray(value) && value.some((item) => !Number.isFinite(item))) throw new Error("geometry_coordinate_invalid");
      }
      if (object.kind === "circle" && (!(object.data.radius > 0) || !Number.isFinite(object.data.cx) || !Number.isFinite(object.data.cy))) {
        throw new Error("geometry_radius_invalid");
      }
      if ((object.kind === "line" || object.kind === "segment") && Math.hypot(object.data.x2 - object.data.x1, object.data.y2 - object.data.y1) <= 1e-6) {
        throw new Error("geometry_line_degenerate");
      }
    }
    for (const constraint of payload.constraints ?? []) {
      requireEvidence(constraint.evidenceClaimIds, "geometry_evidence_missing");
      if (constraint.objectIds.some((id) => !objectIds.has(id))) throw new Error("geometry_reference_invalid");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateGeometry3D({ artifact }) {
  try {
    const payload = artifact.spec.payload;
    requireUnique(payload.objects.map((object) => object.id), "geometry_3d_id_duplicate");
    const objectIds = new Set(payload.objects.map((object) => object.id));
    for (const object of payload.objects) {
      requireEvidence(object.evidenceClaimIds, "geometry_3d_evidence_missing");
      if (!Array.isArray(object.vertices) || object.vertices.length === 0 || object.vertices.length > 50000) throw new Error("geometry_3d_bounds_invalid");
      for (const vertex of object.vertices) {
        if (!Array.isArray(vertex) || vertex.length !== 3 || vertex.some((value) => !Number.isFinite(value))) throw new Error("geometry_3d_coordinate_invalid");
      }
      for (const face of object.faces ?? []) validateFace(face, object.vertices);
    }
    for (const constraint of payload.constraints ?? []) {
      requireEvidence(constraint.evidenceClaimIds, "geometry_3d_evidence_missing");
      if (constraint.objectIds.some((id) => !objectIds.has(id))) throw new Error("geometry_3d_reference_invalid");
    }
    for (const section of payload.sections ?? []) {
      requireEvidence(section.evidenceClaimIds, "geometry_3d_evidence_missing");
      if (!objectIds.has(section.objectId)) throw new Error("geometry_3d_reference_invalid");
      if (!Array.isArray(section.plane) || section.plane.length !== 4 || section.plane.some((value) => !Number.isFinite(value)) ||
        Math.hypot(section.plane[0], section.plane[1], section.plane[2]) <= 1e-7) {
        throw new Error("geometry_3d_plane_invalid");
      }
    }
    if (payload.camera.position.some((value) => !Number.isFinite(value)) || payload.camera.target.some((value) => !Number.isFinite(value)) ||
      !(payload.camera.minDistance > 0) || payload.camera.minDistance > payload.camera.maxDistance) {
      throw new Error("geometry_3d_camera_invalid");
    }
    return pass();
  } catch (error) {
    return fail(error.message);
  }
}

function validateFace(face, vertices) {
  if (!Array.isArray(face) || face.length < 3 || new Set(face).size < 3) throw new Error("geometry_3d_face_degenerate");
  if (face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) throw new Error("geometry_3d_reference_invalid");
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  if (Math.hypot(...cross) <= 1e-7) throw new Error("geometry_3d_face_degenerate");
}

function descriptor({
  kernelId,
  modality,
  rendererId,
  skillId,
  validator
}) {
  return {
    hardValidators: [{ id: `${modality.replaceAll("_", "-")}-hard`, validate: validator, version: "1.0.0" }],
    implementation: {
      kernelId,
      kernelVersion: "1.0.0",
      rendererId,
      rendererVersion: "1.0.0",
      skillId,
      skillVersion: "1.0.0"
    },
    modality,
    proposalSchema: proposalSchema(modality)
  };
}

export const productionInteractiveMathVisualizationCompilers = Object.freeze({
  function_plot: descriptor({
    kernelId: "function-plot-v1",
    modality: "function_plot",
    rendererId: "function-plot-svg",
    skillId: "function-plot",
    validator: validateFunctionPlot
  }),
  geometry_2d: descriptor({
    kernelId: "geometry-2d-v1",
    modality: "geometry_2d",
    rendererId: "geometry-2d-svg",
    skillId: "geometry-2d",
    validator: validateGeometry2D
  }),
  geometry_3d: descriptor({
    kernelId: "geometry-3d-v1",
    modality: "geometry_3d",
    rendererId: "geometry-3d-svg",
    skillId: "geometry-3d",
    validator: validateGeometry3D
  })
});
