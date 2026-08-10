import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createLibraryStorageRepository } from "./libraryStorageRepository.mjs";
import {
  createOrganizationRepository,
  OrganizationRepositoryError
} from "./organizationRepository.mjs";

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-organization-test-"));
  const database = createDatabase({ databasePath: path.join(root, "test.sqlite") });
  return {
    close() {
      database.close();
      fs.rmSync(root, { force: true, recursive: true });
    },
    database,
    library: createLibraryStorageRepository(database, {
      objectDirectory: path.join(root, "objects")
    }),
    organizations: createOrganizationRepository(database)
  };
}

test("organization library audits are transactional and idempotent", () => {
  const harness = createHarness();
  try {
    const actorKey = "user:owner";
    const organizationId = harness.organizations.create(
      "Research Lab",
      actorKey,
      "Owner"
    ).organization.organizationId;
    harness.library.setQuota("organization", organizationId, 1024 * 1024);

    const execute = () => harness.library.runIdempotent(
      actorKey,
      "upload-request-1",
      "upload_library_document",
      () => {
        const value = harness.library.uploadDocument({
          bytes: Buffer.from("%PDF-1.7\nOrganization paper\n%%EOF"),
          expectedRevision: 0,
          fileName: "Paper.pdf",
          scopeId: organizationId,
          scopeType: "organization",
          uploadedBy: actorKey
        });
        harness.organizations.recordLibraryAudit(
          organizationId,
          actorKey,
          "upload_library_document",
          { resourceId: value.document.documentId }
        );
        return value;
      },
      { expectedRevision: 0, fileName: "Paper.pdf", organizationId }
    );

    assert.equal(execute().replayed, false);
    assert.equal(execute().replayed, true);
    const events = harness.database.prepare(`
      SELECT action, metadata_json FROM organization_audit_events
      WHERE organization_id = ? ORDER BY created_at, action
    `).all(organizationId);
    assert.equal(events.filter((event) => event.action === "upload_library_document").length, 1);
    assert.ok(JSON.parse(events.find((event) => event.action === "upload_library_document").metadata_json).resourceId);
  } finally {
    harness.close();
  }
});

test("only organization members can record allowlisted library audit events", () => {
  const harness = createHarness();
  try {
    const organizationId = harness.organizations.create(
      "Research Lab",
      "user:owner",
      "Owner"
    ).organization.organizationId;
    assert.throws(
      () => harness.organizations.recordLibraryAudit(
        organizationId,
        "user:outsider",
        "purge_library_entry"
      ),
      (error) => error instanceof OrganizationRepositoryError &&
        error.code === "organization_membership_required"
    );
    assert.throws(
      () => harness.organizations.recordLibraryAudit(
        organizationId,
        "user:owner",
        "arbitrary_event"
      ),
      (error) => error instanceof OrganizationRepositoryError &&
        error.code === "invalid_organization_audit_event"
    );
  } finally {
    harness.close();
  }
});

test("organization storage policies cover every owner, admin, and member permission", () => {
  const harness = createHarness();
  try {
    const owner = "user:owner";
    const admin = "user:admin";
    const member = "user:member";
    const organizationId = harness.organizations.create(
      "Policy Lab",
      owner,
      "Owner"
    ).organization.organizationId;
    harness.organizations.invite(organizationId, owner, admin, "admin");
    harness.organizations.join(organizationId, admin, "Admin");
    harness.organizations.invite(organizationId, owner, member, "member");
    harness.organizations.join(organizationId, member, "Member");

    assert.equal(harness.organizations.canUpload(organizationId, owner), true);
    assert.equal(harness.organizations.canUpload(organizationId, admin), true);
    assert.equal(harness.organizations.canUpload(organizationId, member), false);
    assert.equal(harness.organizations.canExport(organizationId, owner), true);
    assert.equal(harness.organizations.canExport(organizationId, admin), false);
    assert.equal(harness.organizations.canExport(organizationId, member), false);

    harness.organizations.updatePolicy(organizationId, owner, {
      exportPolicy: "admins_only",
      uploadPolicy: "all_members"
    });
    assert.equal(harness.organizations.canUpload(organizationId, member), true);
    assert.equal(harness.organizations.canExport(organizationId, owner), true);
    assert.equal(harness.organizations.canExport(organizationId, admin), true);
    assert.equal(harness.organizations.canExport(organizationId, member), false);

    harness.organizations.updatePolicy(organizationId, owner, {
      exportPolicy: "all_members",
      uploadPolicy: "owner_admins"
    });
    assert.equal(harness.organizations.canUpload(organizationId, member), false);
    assert.equal(harness.organizations.canExport(organizationId, member), true);
    assert.deepEqual(harness.organizations.getPolicy(organizationId, member), {
      exportPolicy: "all_members",
      role: "member",
      updatedAt: harness.organizations.getPolicy(organizationId, member).updatedAt,
      updatedBy: owner,
      uploadPolicy: "owner_admins"
    });
  } finally {
    harness.close();
  }
});
