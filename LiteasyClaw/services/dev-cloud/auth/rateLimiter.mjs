export function createRateLimiter({
  limit = 8,
  windowMs = 15 * 60 * 1000
} = {}) {
  const buckets = new Map();

  return {
    consume(key) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, {
          count: 1,
          resetAt: now + windowMs
        });
        return {
          allowed: true,
          retryAfterSeconds: 0
        };
      }

      bucket.count += 1;
      if (bucket.count <= limit) {
        return {
          allowed: true,
          retryAfterSeconds: 0
        };
      }

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    },

    reset(key) {
      buckets.delete(key);
    }
  };
}
