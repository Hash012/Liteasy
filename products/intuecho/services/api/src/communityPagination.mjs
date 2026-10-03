import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";
export function communityPageOptions(input = {}) {
  const limit = Math.min(Number(input.limit) || 30, 100);
  if (!Number.isInteger(limit) || limit < 1) throw new AnnotationCommunityError("INVALID_PAGE_LIMIT");
  let after = null;
  if (input.cursor) {
    try {
      if (typeof input.cursor !== "string" || input.cursor.length > 1500) throw new Error();
      after = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      if (!Array.isArray(after) || after.length !== 2 || typeof after[0] !== "string" || !Number.isFinite(Date.parse(after[0])) || typeof after[1] !== "string" || !after[1] || after[1].length > 200) throw new Error();
    } catch { throw new AnnotationCommunityError("INVALID_PAGE_CURSOR"); }
  }
  return { limit, after };
}
export function communityPageCursor(row) {
  const createdAt = row.cursor_created_at ?? row.created_at;
  return Buffer.from(JSON.stringify([createdAt instanceof Date ? createdAt.toISOString() : createdAt, row.id])).toString("base64url");
}
