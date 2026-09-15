import { expect, test } from "vitest";
import { connectionPath, connectionPoint } from "../app/features/boards/boardFileFormat";
import type { BoardSide } from "../app/features/objects/object.types";

type Point = { x: number; y: number };
function sample(path: string): Point[] {
  const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  const points = Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] }));
  if (path.includes("C")) return Array.from({ length: 401 }, (_, i) => {
    const t = i / 400, u = 1 - t;
    return { x: u ** 3 * points[0].x + 3 * u ** 2 * t * points[1].x + 3 * u * t ** 2 * points[2].x + t ** 3 * points[3].x,
      y: u ** 3 * points[0].y + 3 * u ** 2 * t * points[1].y + 3 * u * t ** 2 * points[2].y + t ** 3 * points[3].y };
  });
  return points.flatMap((point, index) => {
    const next = points[index + 1] ?? point;
    return Array.from({ length: 101 }, (_, i) => ({ x: point.x + (next.x - point.x) * i / 100, y: point.y + (next.y - point.y) * i / 100 }));
  });
}
for (const target of [{ x: 290, y: 0 }, { x: 0, y: 220 }, { x: 300, y: 160 }, { x: 350, y: 400 }]) {
  test(`all cardinal endpoint pairs remain outside card bodies at ${target.x},${target.y}`, () => {
    const boxes = [{ position: { x: 0, y: 0 }, size: { width: 270, height: 200 } },
      { position: target, size: { width: 270, height: 200 } }] as const;
    const sides: BoardSide[] = ["top", "right", "bottom", "left"];
    for (const fromSide of sides) for (const toSide of sides) {
      const start = connectionPoint(boxes[0], fromSide), end = connectionPoint(boxes[1], toSide);
      const path = connectionPath(start, fromSide, end, toSide, [...boxes]);
      const points = sample(path);
      expect(points[0]).toEqual(start);
      expect(points.at(-1)).toEqual(end);
      const blocked = points.some(point => boxes.some(box => point.x > box.position.x + 0.001 && point.x < box.position.x + box.size.width - 0.001 &&
        point.y > box.position.y + 0.001 && point.y < box.position.y + box.size.height - 0.001));
      expect(blocked, `${fromSide} → ${toSide}: ${path}`).toBe(false);
    }
  });
}
test("a backwards connection takes a visible outer lane while a facing connection retains its curve", () => {
  const left = { position: { x: 0, y: 0 }, size: { width: 270, height: 200 } };
  const right = { ...left, position: { x: 290, y: 0 } };
  const normal = connectionPath(connectionPoint(left, "right"), "right", connectionPoint(right, "left"), "left", [left, right]);
  expect(normal).toContain(" C ");
  const backward = connectionPath(connectionPoint(right, "right"), "right", connectionPoint(left, "left"), "left", [right, left]);
  expect(backward).toContain(" L ");
  expect(sample(backward).some(point => point.y > 200 || point.y < 0)).toBe(true);
});
