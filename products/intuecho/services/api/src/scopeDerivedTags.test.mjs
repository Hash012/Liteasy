import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

import { verifyScopeDerivedTags } from "../scripts/verify-scope-derived-tags.mjs";

test("real SQLite derived tags exclude private, organization and mutual samples from public output", async () => {
  const db = new Database(":memory:");
  try {
    await verifyScopeDerivedTags(new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationVisibility: async () => true }));
  } finally { db.close(); }
});
