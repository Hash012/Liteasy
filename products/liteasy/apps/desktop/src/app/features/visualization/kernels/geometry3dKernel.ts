import type {
  AccessibilityProjectionV1,
  Geometry3DSpecV1,
  InteractionContractV1,
  SemanticObjectV1
} from "../visualizationArtifact.types";

type Vec3 = readonly [number, number, number];

export type Geometry3DSectionV1 = {
  derived: true;
  id: string;
  vertices: Vec3[];
};

export type Geometry3DSolveResultV1 = {
  accessibility: AccessibilityProjectionV1;
  fallbackProjection: readonly { id: string; x: number; y: number }[];
  interaction: InteractionContractV1;
  sections: Geometry3DSectionV1[];
  semanticObjects: readonly SemanticObjectV1[];
};

const maxVertices = 50000;
const epsilon = 1e-7;

export function validateGeometry3D(spec: Geometry3DSpecV1): void {
  const objectIds = new Set<string>();
  for (const object of spec.objects) {
    if (object.evidenceClaimIds.length === 0) throw new Error("geometry_3d_evidence_missing");
    if (objectIds.has(object.id)) throw new Error("geometry_3d_id_duplicate");
    objectIds.add(object.id);
    if (object.vertices.length === 0 || object.vertices.length > maxVertices) throw new Error("geometry_3d_bounds_invalid");
    for (const vertex of object.vertices) {
      if (vertex.length !== 3 || vertex.some((value) => !Number.isFinite(value))) throw new Error("geometry_3d_coordinate_invalid");
    }
    for (const face of object.faces ?? []) validateFace(face, object.vertices);
  }
  for (const constraint of spec.constraints) {
    if (constraint.evidenceClaimIds.length === 0) throw new Error("geometry_3d_evidence_missing");
    if (constraint.objectIds.some((id) => !objectIds.has(id))) throw new Error("geometry_3d_reference_invalid");
  }
  for (const section of spec.sections) {
    if (section.evidenceClaimIds.length === 0) throw new Error("geometry_3d_evidence_missing");
    if (!objectIds.has(section.objectId)) throw new Error("geometry_3d_reference_invalid");
    if (section.plane.length !== 4 || section.plane.some((value) => !Number.isFinite(value))) throw new Error("geometry_3d_plane_invalid");
    if (Math.hypot(section.plane[0], section.plane[1], section.plane[2]) <= epsilon) throw new Error("geometry_3d_plane_invalid");
  }
  for (const point of [spec.camera.position, spec.camera.target]) {
    if (point.some((value) => !Number.isFinite(value))) throw new Error("geometry_3d_camera_invalid");
  }
  if (!Number.isFinite(spec.camera.minDistance) || !Number.isFinite(spec.camera.maxDistance) || spec.camera.minDistance <= 0 || spec.camera.minDistance > spec.camera.maxDistance) {
    throw new Error("geometry_3d_camera_invalid");
  }
}

export function solveGeometry3D(spec: Geometry3DSpecV1): Geometry3DSolveResultV1 {
  validateGeometry3D(spec);
  const objectsById = new Map(spec.objects.map((object) => [object.id, object]));
  const sections = spec.sections.map((section) => {
    const object = objectsById.get(section.objectId)!;
    return {
      derived: true,
      id: section.id,
      vertices: orderSectionVertices(sectionPlaneIntersection(object.vertices, object.faces ?? [], section.plane), section.plane)
    } satisfies Geometry3DSectionV1;
  });
  const selectableObjectIds = [...spec.objects.map((object) => object.id), ...sections.map((section) => section.id)];
  return {
    accessibility: {
      dataTable: [
        ...spec.objects.map((object) => ({ label: object.id, value: `${object.vertices.length} vertices` })),
        ...sections.map((section) => ({ label: section.id, value: `${section.vertices.length} section vertices` }))
      ],
      objectReadingOrder: selectableObjectIds,
      summary: `3D geometry with ${spec.objects.length} object${spec.objects.length === 1 ? "" : "s"} and ${sections.length} section${sections.length === 1 ? "" : "s"}`
    },
    fallbackProjection: spec.objects.flatMap((object) => object.vertices.map((vertex, index) => ({ id: `${object.id}-${index}`, x: vertex[0] - vertex[1] * 0.35, y: vertex[2] + vertex[1] * 0.35 }))),
    interaction: {
      pan: true,
      zoom: true,
      rotate: true,
      playback: "none",
      parameterIds: spec.sections.map((section) => section.id),
      selectableObjectIds
    },
    sections,
    semanticObjects: selectableObjectIds.map((id) => {
      const object = objectsById.get(id);
      const section = spec.sections.find((item) => item.id === id);
      return {
        evidenceClaimIds: object?.evidenceClaimIds ?? section?.evidenceClaimIds ?? [],
        kind: object?.kind ?? "section",
        label: id,
        objectId: id,
        objectPath: [id],
        selectable: true
      } satisfies SemanticObjectV1;
    })
  };
}

function validateFace(face: readonly number[], vertices: readonly Vec3[]): void {
  if (face.length < 3 || new Set(face).size < 3) throw new Error("geometry_3d_face_degenerate");
  if (face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) throw new Error("geometry_3d_reference_invalid");
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  if (norm(cross(subtract(b, a), subtract(c, a))) <= epsilon) throw new Error("geometry_3d_face_degenerate");
}

function sectionPlaneIntersection(vertices: readonly Vec3[], faces: readonly number[][], plane: readonly [number, number, number, number]): Vec3[] {
  const intersections: Vec3[] = [];
  for (const [aIndex, bIndex] of meshEdges(faces)) {
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const da = signedDistance(a, plane);
    const db = signedDistance(b, plane);
    if (Math.abs(da) <= epsilon) intersections.push(a);
    if (da * db < -epsilon) {
      const t = da / (da - db);
      intersections.push([
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t)
      ]);
    }
  }
  return uniqueVertices(intersections);
}

function meshEdges(faces: readonly number[][]): Array<[number, number]> {
  const edges = new Set<string>();
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.add(key);
    }
  }
  return [...edges].map((key) => key.split(":").map(Number) as [number, number]);
}

function orderSectionVertices(vertices: Vec3[], plane: readonly [number, number, number, number]): Vec3[] {
  if (vertices.length < 3) return vertices;
  const center = vertices.reduce((acc, vertex) => [acc[0] + vertex[0], acc[1] + vertex[1], acc[2] + vertex[2]] as Vec3, [0, 0, 0]).map((value) => value / vertices.length) as unknown as Vec3;
  const normal = normalize([plane[0], plane[1], plane[2]]);
  const basisA = normalize(Math.abs(normal[0]) < 0.9 ? cross(normal, [1, 0, 0]) : cross(normal, [0, 1, 0]));
  const basisB = cross(normal, basisA);
  return [...vertices].sort((left, right) => angle(left, center, basisA, basisB) - angle(right, center, basisA, basisB));
}

function uniqueVertices(vertices: readonly Vec3[]): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const vertex of vertices) seen.set(vertex.map((value) => round(value)).join(","), [round(vertex[0]), round(vertex[1]), round(vertex[2])]);
  return [...seen.values()];
}

function signedDistance(vertex: Vec3, plane: readonly [number, number, number, number]): number {
  return plane[0] * vertex[0] + plane[1] * vertex[1] + plane[2] * vertex[2] + plane[3];
}

function angle(vertex: Vec3, center: Vec3, basisA: Vec3, basisB: Vec3): number {
  const relative = subtract(vertex, center);
  return Math.atan2(dot(relative, basisB), dot(relative, basisA));
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function norm(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const length = norm(vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
