import { expect, test } from "vitest";

import { createAssociationInkPaths } from "../app/features/associations/associationHandDrawnPath";

function curveInput(edgeId: string) {
  return {
    edgeId,
    exactPath: "M 18 24 Q 86 72 154 116"
  };
}

function pathEndpoints(path: string) {
  const numbers = path.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? [];
  return [numbers.slice(0, 2), numbers.slice(-2)];
}

test("keeps endpoints exact while producing stable hand-drawn variants", () => {
  const first = createAssociationInkPaths(curveInput("edge-1"));
  const second = createAssociationInkPaths(curveInput("edge-1"));

  expect(first).toEqual(second);
  expect(pathEndpoints(first.inkPath)).toEqual(pathEndpoints(first.hitPath));
  expect(pathEndpoints(first.echoPath)).toEqual(pathEndpoints(first.hitPath));
  expect(pathEndpoints(first.washPath)).toEqual(pathEndpoints(first.hitPath));
  expect(first.hitPath).toBe(curveInput("edge-1").exactPath);
  expect(first.echoPath).not.toBe(first.inkPath);
});

test("uses the edge identity only for bounded interior variation", () => {
  const first = createAssociationInkPaths(curveInput("edge-1"));
  const other = createAssociationInkPaths(curveInput("edge-2"));
  const exactControl = [86, 72];
  const control = (path: string) => (path.match(/-?\d+(?:\.\d+)?/gu)?.map(Number) ?? []).slice(2, 4);

  expect(first.inkPath).not.toBe(other.inkPath);
  expect(pathEndpoints(first.inkPath)).toEqual(pathEndpoints(other.inkPath));
  for (const path of [first.inkPath, first.echoPath, first.washPath]) {
    expect(Math.abs(control(path)[0]! - exactControl[0])).toBeLessThanOrEqual(6);
    expect(Math.abs(control(path)[1]! - exactControl[1])).toBeLessThanOrEqual(6);
  }
});
