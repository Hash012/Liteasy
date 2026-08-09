import { expect, test } from "vitest";

import { createAssociationExactPath } from "../app/features/associations/associationExactPath";

test("returns one collinear exact segment and its matching quadratic SVG path", () => {
  expect(createAssociationExactPath(
    { left: 10, top: 20 },
    { left: 110, top: 70 },
    0.52
  )).toEqual({
    d: "M 10 20 Q 62 46 110 70",
    segments: [{
      end: { left: 110, top: 70 },
      start: { left: 10, top: 20 }
    }]
  });
});
