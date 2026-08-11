import type {
  AccessibilityProjectionV1,
  Geometry2DSpecV1,
  InteractionContractV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";

export type Geometry2DDerivedPointV1 = {
  derived: true;
  id: string;
  x: number;
  y: number;
};

export type Geometry2DSolveResultV1 = {
  accessibility: AccessibilityProjectionV1;
  derivedPoints: readonly Geometry2DDerivedPointV1[];
  interaction: InteractionContractV1;
  semanticObjects: readonly SemanticObjectV1[];
};

type GeometryObject = Geometry2DSpecV1["objects"][number];

const epsilon = 1e-6;

export function validateGeometry2D(spec: Geometry2DSpecV1): void {
  if (!Number.isFinite(spec.viewport.xMin) || !Number.isFinite(spec.viewport.xMax) || spec.viewport.xMin >= spec.viewport.xMax) {
    throw new Error("geometry_viewport_invalid");
  }
  if (!Number.isFinite(spec.viewport.yMin) || !Number.isFinite(spec.viewport.yMax) || spec.viewport.yMin >= spec.viewport.yMax) {
    throw new Error("geometry_viewport_invalid");
  }
  const objectIds = new Set<string>();
  for (const object of spec.objects) {
    if (object.evidenceClaimIds.length === 0) throw new Error("geometry_evidence_missing");
    if (objectIds.has(object.id)) throw new Error("geometry_id_duplicate");
    objectIds.add(object.id);
    validateObject(object);
  }
  for (const constraint of spec.constraints) {
    if (constraint.evidenceClaimIds.length === 0) throw new Error("geometry_evidence_missing");
    if (constraint.objectIds.some((id) => !objectIds.has(id))) throw new Error("geometry_reference_invalid");
  }
}

export function solveGeometry2D(spec: Geometry2DSpecV1): Geometry2DSolveResultV1 {
  validateGeometry2D(spec);
  const objectsById = new Map(spec.objects.map((object) => [object.id, object]));
  const derivedEntries = spec.constraints.flatMap((constraint) => {
    if (constraint.kind !== "tangent" || constraint.objectIds.length !== 2) return [];
    const first = objectsById.get(constraint.objectIds[0])!;
    const second = objectsById.get(constraint.objectIds[1])!;
    const circle = first.kind === "circle" ? first : second.kind === "circle" ? second : null;
    const line = first.kind === "line" ? first : second.kind === "line" ? second : null;
    if (!circle || !line) return [];
    return [{ evidenceClaimIds: constraint.evidenceClaimIds, point: deriveCircleLineTangentPoint(circle, line) }];
  });
  const derivedPoints = derivedEntries.map((entry) => entry.point);
  const derivedEvidenceById = new Map(derivedEntries.map((entry) => [entry.point.id, entry.evidenceClaimIds]));
  const selectableObjectIds = [...spec.objects.map((object) => object.id), ...derivedPoints.map((point) => point.id)];
  return {
    accessibility: {
      dataTable: [
        ...spec.objects.map((object) => ({ label: object.id, value: object.kind })),
        ...derivedPoints.map((point) => ({ label: point.id, value: `(${point.x}, ${point.y})` }))
      ],
      objectReadingOrder: selectableObjectIds,
      summary: `2D geometry with ${spec.objects.length} object${spec.objects.length === 1 ? "" : "s"}`
    },
    derivedPoints,
    interaction: {
      pan: true,
      zoom: true,
      rotate: false,
      playback: "none",
      parameterIds: [],
      selectableObjectIds
    },
    semanticObjects: selectableObjectIds.map((id) => {
      const object = objectsById.get(id);
      return {
        evidenceClaimIds: object?.evidenceClaimIds ?? derivedEvidenceById.get(id) ?? [],
        kind: object?.kind ?? "derived_point",
        label: id,
        objectId: id,
        objectPath: [id],
        selectable: true
      } satisfies SemanticObjectV1;
    })
  };
}

function validateObject(object: GeometryObject): void {
  for (const value of Object.values(object.data)) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("geometry_coordinate_invalid");
    if (Array.isArray(value) && value.some((item) => !Number.isFinite(item))) throw new Error("geometry_coordinate_invalid");
  }
  if (object.kind === "circle") {
    if (numberData(object, "radius") <= 0) throw new Error("geometry_radius_invalid");
    numberData(object, "cx");
    numberData(object, "cy");
  }
  if (object.kind === "line" || object.kind === "segment") {
    const x1 = numberData(object, "x1");
    const y1 = numberData(object, "y1");
    const x2 = numberData(object, "x2");
    const y2 = numberData(object, "y2");
    if (Math.hypot(x2 - x1, y2 - y1) <= epsilon) throw new Error("geometry_line_degenerate");
  }
  if (object.kind === "point") {
    numberData(object, "x");
    numberData(object, "y");
  }
  if (object.kind === "arc") {
    numberData(object, "cx");
    numberData(object, "cy");
    if (numberData(object, "radius") <= 0) throw new Error("geometry_radius_invalid");
    const sweep = Math.abs(numberData(object, "endAngle") - numberData(object, "startAngle"));
    if (sweep <= epsilon || sweep > 360 + epsilon) throw new Error("geometry_arc_invalid");
  }
  if (object.kind === "polygon") {
    const points = pointData(object);
    if (points.length < 3 || Math.abs(polygonArea(points)) <= epsilon) throw new Error("geometry_polygon_invalid");
  }
  if (object.kind === "curve") {
    const points = pointData(object);
    if (points.length < 2 || pathLength(points) <= epsilon) throw new Error("geometry_curve_invalid");
  }
}

function deriveCircleLineTangentPoint(circle: GeometryObject, line: GeometryObject): Geometry2DDerivedPointV1 {
  const cx = numberData(circle, "cx");
  const cy = numberData(circle, "cy");
  const radius = numberData(circle, "radius");
  const x1 = numberData(line, "x1");
  const y1 = numberData(line, "y1");
  const x2 = numberData(line, "x2");
  const y2 = numberData(line, "y2");
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = ((cx - x1) * dx + (cy - y1) * dy) / lengthSquared;
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  if (Math.abs(Math.hypot(px - cx, py - cy) - radius) > 1e-5) throw new Error("geometry_tangent_invalid");
  return { derived: true, id: "tangent-point", x: round(px), y: round(py) };
}

function numberData(object: GeometryObject, key: string): number {
  const value = object.data[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("geometry_coordinate_invalid");
  return value;
}

function pointData(object: GeometryObject): Array<{ x: number; y: number }> {
  const value = object.data.points;
  if (!Array.isArray(value) || value.length % 2 !== 0) throw new Error(`geometry_${object.kind}_invalid`);
  return Array.from({ length: value.length / 2 }, (_, index) => ({
    x: value[index * 2],
    y: value[index * 2 + 1]
  }));
}

function polygonArea(points: readonly { x: number; y: number }[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function pathLength(points: readonly { x: number; y: number }[]): number {
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index];
    return length + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
