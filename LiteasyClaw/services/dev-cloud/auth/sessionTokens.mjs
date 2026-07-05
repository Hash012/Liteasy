import { createHash, randomBytes } from "node:crypto";

export function createSessionToken() {
  return `ltsy_${randomBytes(32).toString("base64url")}`;
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isSecureSessionToken(value) {
  return typeof value === "string" && /^ltsy_[A-Za-z0-9_-]{43}$/.test(value);
}
