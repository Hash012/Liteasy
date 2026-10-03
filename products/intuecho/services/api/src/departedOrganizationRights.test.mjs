import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { departedOrganizationFixture, verifyDepartedOrganizationRights } from "../scripts/verify-departed-organization-rights.mjs";

test("SQLite preserves the exact departed author exceptions for parent, reply, projection and history", async () => {
  const db = new Database(":memory:"); let active = true;
  const members = new Set(Object.values(departedOrganizationFixture).filter((value) => value?.id && value.id !== departedOrganizationFixture.outsider.id).map((value) => value.id));
  const access = ({ organizationId, userId }) => organizationId === departedOrganizationFixture.organizationId && active && members.has(userId);
  const repository = new SqliteAnnotationCommunityRepository(db, {
    authorizeOrganizationVisibility: async (input) => access(input),
    authorizeOrganizationAccess: async (input) => ({ allowed: access(input), role: input.userId === departedOrganizationFixture.admin.id ? "admin" : "member" })
  });
  try { await verifyDepartedOrganizationRights(repository, () => { active = false; }); } finally { db.close(); }
});
