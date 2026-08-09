import assert from "node:assert/strict";
import test from "node:test";
import { createLiteratureRateLimiter } from "./literatureRateLimiter.mjs";

test("limits each literature operation independently per user and resets expired buckets", () => {
  let now = 1_000;
  const limiter = createLiteratureRateLimiter({
    clock: () => now,
    limit: 30,
    windowMs: 60_000
  });

  for (let call = 0; call < 30; call += 1) {
    assert.equal(limiter.tryConsume("resolve", "user-1"), true);
  }
  assert.equal(limiter.tryConsume("resolve", "user-1"), false);
  assert.equal(limiter.tryConsume("confirm", "user-1"), true);
  assert.equal(limiter.tryConsume("resolve", "user-2"), true);

  now += 60_000;
  assert.equal(limiter.tryConsume("resolve", "user-1"), true);
});
