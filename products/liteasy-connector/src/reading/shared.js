/* Shared pure functions. No page/network/storage access. */
((root) => {
  "use strict";
  const PREFIX = "cgr3:";
  const LEGACY = "chatgptReadingProgressV1";
  const KEY_RE = /^cgr3:m:[csd]-[0-9a-f]{16}:[0-9a-f]{16}$/;
  const SECTION_RE = /^[0-9a-f]{16}$/;
  const normalize = (s) => String(s || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();

  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  // Two independent 32-bit accumulators. This is an identity fingerprint, not a
  // security primitive; no response body or raw conversation URL is persisted.
  function hash(s) {
    s = String(s);
    let h = 0x9e3779b9;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b);
      h ^= h >>> 13;
    }
    return fnv(s).toString(16).padStart(8, "0") + (h >>> 0).toString(16).padStart(8, "0");
  }
  function scope(path, draftId) {
    const match = String(path).match(/\/(c|share)\/([^/?#]+)/);
    return match ? `${match[1] === "c" ? "c" : "s"}-${hash(match[2])}` : `d-${hash(draftId)}`;
  }
  function key(scopeId, messageId) { return `${PREFIX}m:${scopeId}:${hash(messageId)}`; }
  function emptyRecord() { return {v: 3, updatedAt: 0, sections: Object.create(null)}; }
  function validEntry(e) {
    return !!e && typeof e.checked === "boolean" && Number.isSafeInteger(e.t) && e.t >= 0 &&
      typeof e.op === "string" && e.op.length > 0 && e.op.length <= 120;
  }
  function compare(a, b) {
    if (!a) return b ? -1 : 0;
    if (!b) return 1;
    return a.t !== b.t ? a.t - b.t : a.op < b.op ? -1 : a.op > b.op ? 1 : 0;
  }
  function sanitizeRecord(raw) {
    const out = emptyRecord();
    if (!raw || raw.v !== 3 || !raw.sections || typeof raw.sections !== "object") return out;
    for (const [id, e] of Object.entries(raw.sections)) {
      if (SECTION_RE.test(id) && validEntry(e)) {
        out.sections[id] = {checked: e.checked, t: e.t, op: e.op};
        out.updatedAt = Math.max(out.updatedAt, e.t);
      }
    }
    return out;
  }
  function merge(raw, patches) {
    const out = sanitizeRecord(raw);
    for (const [id, e] of Object.entries(patches || {})) {
      if (SECTION_RE.test(id) && validEntry(e) && compare(e, out.sections[id]) > 0) {
        out.sections[id] = {checked: e.checked, t: e.t, op: e.op};
        out.updatedAt = Math.max(out.updatedAt, e.t);
      }
    }
    return out;
  }
  const api = {PREFIX, LEGACY, KEY_RE, SECTION_RE, normalize, fnv, hash, scope, key, emptyRecord, validEntry, compare, sanitizeRecord, merge};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CGRCore = Object.freeze(api);
})(globalThis);
