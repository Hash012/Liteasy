import { expect, test } from "vitest";

import {
  evaluateAssociationGeometry,
  evaluateSameSide,
  rectanglesOverlap,
  segmentsCross
} from "../app/features/associations/associationGraphGeometry";

test("detects proper crossings but ignores shared endpoints and collinear touches", () => {
  expect(segmentsCross(
    { start: { left: 0, top: 0 }, end: { left: 10, top: 10 } },
    { start: { left: 0, top: 10 }, end: { left: 10, top: 0 } }
  )).toBe(true);
  expect(segmentsCross(
    { start: { left: 0, top: 0 }, end: { left: 10, top: 10 } },
    { start: { left: 10, top: 10 }, end: { left: 20, top: 0 } }
  )).toBe(false);
  expect(segmentsCross(
    { start: { left: 0, top: 0 }, end: { left: 10, top: 0 } },
    { start: { left: 5, top: 0 }, end: { left: 15, top: 0 } }
  )).toBe(false);
});

test("handles zero-length and near-collinear segments without inventing crossings", () => {
  expect(segmentsCross(
    { start: { left: 5, top: 5 }, end: { left: 5, top: 5 } },
    { start: { left: 0, top: 5 }, end: { left: 10, top: 5 } }
  )).toBe(false);
  expect(segmentsCross(
    { start: { left: 0, top: 0 }, end: { left: 1_000_000, top: 1 } },
    { start: { left: 0, top: 2 }, end: { left: 1_000_000, top: 3.0000000001 } }
  )).toBe(false);
});

test("rejects papers placed on opposite sides of one anchor", () => {
  expect(evaluateSameSide(
    { left: 100, top: 100 },
    [{ left: 20, top: 100 }, { left: 180, top: 100 }]
  )).toEqual({ side: null, violations: 1 });

  expect(evaluateSameSide(
    { left: 100, top: 100 },
    [{ left: 160, top: 80 }, { left: 180, top: 120 }]
  )).toEqual({ side: "right", violations: 0 });
});

test("treats touching rectangles as clear but detects positive-area overlap", () => {
  expect(rectanglesOverlap(
    { bottom: 10, left: 0, right: 10, top: 0 },
    { bottom: 10, left: 10, right: 20, top: 0 }
  )).toBe(false);
  expect(rectanglesOverlap(
    { bottom: 10, left: 0, right: 10, top: 0 },
    { bottom: 15, left: 9.999, right: 20, top: 5 }
  )).toBe(true);
});

test("weights primary crossings above paper crossings and reports stress", () => {
  const quality = evaluateAssociationGeometry({
    anchors: [
      { anchorId: "a1", left: 0, obstacles: [], top: 10 },
      { anchorId: "a2", left: 0, obstacles: [], top: 20 }
    ],
    frameHeight: 30,
    frameWidth: 20,
    nodes: [
      { halfHeight: 0, halfWidth: 0, left: 10, paperKey: "p1", relevance: 1, top: 20 },
      { halfHeight: 0, halfWidth: 0, left: 10, paperKey: "p2", relevance: 1, top: 10 },
      { halfHeight: 0, halfWidth: 0, left: 5, paperKey: "p3", relevance: 1, top: 5 },
      { halfHeight: 0, halfWidth: 0, left: 5, paperKey: "p4", relevance: 1, top: 25 }
    ],
    paperEdges: [{ sourcePaperKey: "p3", strength: 1, targetPaperKey: "p4" }],
    primaryEdges: [
      { anchorId: "a1", paperKey: "p1" },
      { anchorId: "a2", paperKey: "p2" }
    ]
  });

  expect(quality.primaryEdgeCrossings).toBe(1);
  expect(quality.weightedCrossings).toBe(15);
  expect(quality.weightedStress).toBeGreaterThan(0);
});

test("counts overflow, node overlap, and anchor obstruction independently", () => {
  const quality = evaluateAssociationGeometry({
    anchors: [{
      anchorId: "a1",
      left: 5,
      obstacles: [{ bottom: 7, left: 3, right: 7, top: 3 }],
      top: 5
    }],
    frameHeight: 10,
    frameWidth: 10,
    nodes: [
      { halfHeight: 2, halfWidth: 2, left: 5, paperKey: "inside", relevance: 1, top: 5 },
      { halfHeight: 2, halfWidth: 2, left: 10, paperKey: "outside", relevance: 1, top: 5 },
      { halfHeight: 2, halfWidth: 2, left: 6, paperKey: "overlap", relevance: 1, top: 5 }
    ],
    paperEdges: [],
    primaryEdges: []
  });

  expect(quality.overflowCount).toBe(1);
  expect(quality.nodeOverlaps).toBe(1);
  expect(quality.anchorObstructions).toBe(2);
});
