export function createLiteratureRateLimiter({
  clock = () => Date.now(),
  limit = 30,
  windowMs = 60_000
} = {}) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError("windowMs must be positive");

  const buckets = new Map();

  return Object.freeze({
    tryConsume(operation, userId) {
      const now = clock();
      const key = `${operation}:${userId}`;
      const active = (buckets.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
      if (active.length >= limit) {
        buckets.set(key, active);
        return false;
      }
      active.push(now);
      buckets.set(key, active);
      return true;
    }
  });
}
