import assert from "node:assert/strict";
import { test } from "node:test";
import { requireCiSuccess } from "./require-ci-success.mjs";

const passed = { policy: { result: "success" }, frontend: { result: "success" }, windows: { result: "success" } };
test("accepts only completed successful validation layers", () => {
  assert.doesNotThrow(() => requireCiSuccess(passed));
});
test("accepts cancelled windows layer when installer build is not requested", () => {
  assert.doesNotThrow(() => requireCiSuccess({ ...passed, windows: { result: "cancelled" } }));
});
test("rejects cancelled windows layer when installer build is requested", () => {
  assert.throws(() => requireCiSuccess({ ...passed, windows: { result: "cancelled" } }, { buildInstaller: true }));
});
for (const job of ["policy", "frontend", "windows"]) {
  const rejected = job === "windows" ? ["failure", "skipped", "timed_out", ""] : ["failure", "cancelled", "skipped", "timed_out", ""];
  for (const result of rejected) {
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
