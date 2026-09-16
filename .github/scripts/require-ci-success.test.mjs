import assert from "node:assert/strict";
import { test } from "node:test";
import { requireCiSuccess } from "./require-ci-success.mjs";

const passed = { policy: { result: "success" }, frontend: { result: "success" }, windows: { result: "success" } };
test("accepts only completed successful validation layers", () => {
  assert.doesNotThrow(() => requireCiSuccess(passed));
});
for (const job of ["policy", "frontend", "windows"]) {
  for (const result of ["failure", "cancelled", "skipped", "timed_out", ""]) {
    test(`rejects ${job} with result ${result || "empty"}`, () => {
      assert.throws(() => requireCiSuccess({ ...passed, [job]: { result } }));
    });
  }
  test(`rejects a missing ${job} layer`, () => {
    const incomplete = { ...passed };
    delete incomplete[job];
    assert.throws(() => requireCiSuccess(incomplete));
  });
}
test("rejects absent results instead of reporting a false green check", () => {
  assert.throws(() => requireCiSuccess(undefined));
});
