import { expect, test } from "vitest";
import { calculateSynchronizedScrollTop } from "../app/features/import/PaperResourceTab";

const sourceAnchors = [{ id: "one", top: 0 }, { id: "two", top: 1_000 }];
const targetAnchors = [{ id: "one", top: 0 }, { id: "two", top: 400 }];

test("maps progress within a long translation anchor instead of freezing at its top", () => {
  expect(calculateSynchronizedScrollTop({
    sourceAnchors,
    sourceClientHeight: 200,
    sourceScrollHeight: 2_000,
    sourceScrollTop: 500,
    targetAnchors,
    targetClientHeight: 200,
    targetScrollHeight: 800
  })).toBe(200);
});

test("clamps document ends and falls back to the whole-document ratio when an anchor is missing", () => {
  expect(calculateSynchronizedScrollTop({
    sourceAnchors,
    sourceClientHeight: 200,
    sourceScrollHeight: 2_000,
    sourceScrollTop: 1_800,
    targetAnchors,
    targetClientHeight: 200,
    targetScrollHeight: 800
  })).toBe(600);
  expect(calculateSynchronizedScrollTop({
    sourceAnchors,
    sourceClientHeight: 200,
    sourceScrollHeight: 2_000,
    sourceScrollTop: 900,
    targetAnchors: [{ id: "missing", top: 0 }],
    targetClientHeight: 200,
    targetScrollHeight: 800
  })).toBe(300);
});
