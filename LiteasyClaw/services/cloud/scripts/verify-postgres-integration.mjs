import assert from "node:assert/strict";
import pg from "pg";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { PostgresAgentArtifactRepository } from "../src/agentArtifactRepository.mjs";
import { PostgresExternalKnowledgeRepository } from "../src/externalKnowledgeService.mjs";
import { authorizeLibraryScope } from "../src/libraryAuthorization.mjs";
import { migratePostgres } from "../src/migrations.mjs";
import { PostgresLibraryRepository } from "../src/libraryRepository.mjs";
import { PostgresOrganizationGovernanceRepository } from "../src/organizationGovernanceRepository.mjs";
import { PostgresOrganizationPolicyRepository } from "../src/organizationPolicyRepository.mjs";
import { PostgresPersonalizationRepository } from "../src/personalizationRepository.mjs";
import { PostgresPlatformAdminRepository } from "../src/platformAdminRepository.mjs";
import { PostgresRecommendationRepository } from "../src/recommendationRepository.mjs";
import { PostgresTeamAnnotationRepository } from "../src/teamAnnotationRepository.mjs";

const connectionString = process.env.LITEASY_TEST_DATABASE_URL;
if (!connectionString) throw new Error("LITEASY_TEST_DATABASE_URL is required");
const migrationConnectionString = process.env.LITEASY_TEST_MIGRATION_DATABASE_URL || connectionString;
const parsed = new URL(connectionString);
const migrationParsed = new URL(migrationConnectionString);
if (
  !new Set(["127.0.0.1", "::1", "localhost"]).has(parsed.hostname) ||
  !new Set(["127.0.0.1", "::1", "localhost"]).has(migrationParsed.hostname) ||
  !parsed.pathname.endsWith("_test") ||
  migrationParsed.pathname !== parsed.pathname
) {
  throw new Error("integration_database_forbidden: use a loopback database whose name ends in _test");
}

const { Pool } = pg;
const pool = new Pool({ connectionString, max: 4, ssl: false });
const migrationPool = migrationConnectionString === connectionString
  ? pool
  : new Pool({ connectionString: migrationConnectionString, max: 1, ssl: false });
try {
  const migrated = await migratePostgres(migrationPool, {
    ...(migrationConnectionString === connectionString ? {} : { applicationRole: parsed.username })
  });
  assert.deepEqual(migrated.applied, [
    "001_filesystem_storage.sql",
    "002_filesystem_invariants.sql",
    "003_organization_and_node_names.sql",
    "004_library_provenance.sql",
    "005_storage_publish_workflows.sql",
    "006_library_trash_transactions.sql",
    "007_storage_gc_invariants.sql",
    "008_publish_workflow_retention.sql",
    "009_governance_and_personalization.sql",
    "010_team_annotations.sql",
    "011_organization_membership_governance.sql",
    "012_recommendation_business_api.sql",
    "013_platform_administration.sql",
    "014_account_lifecycle.sql",
    "015_admin_storage_quotas.sql",
    "016_admin_control_plane.sql",
    "017_external_retrieval_connectors.sql",
    "018_pdf_security_scan_proofs.sql",
    "019_agent_artifacts.sql"
  ]);
  if (migrationPool !== pool) {
    await assert.rejects(
      () => pool.query("CREATE TABLE app_role_must_not_create(id text)"),
      /permission denied/
    );
  }

  await pool.query(`
    INSERT INTO storage_quotas(scope_type, scope_id, limit_bytes, updated_by)
    VALUES ('user', 'user_1', 1048576, 'seed'),
           ('organization', 'org_1', 1048576, 'seed')
  `);
  await pool.query(`
    INSERT INTO organizations(organization_id, owner_subject, name)
    VALUES ('org_1', 'owner_1', 'Research group'),
           ('org_2', 'owner_2', 'Other group')
  `);
  await pool.query(`
    INSERT INTO organization_members(organization_id, member_subject, role)
    VALUES ('org_1', 'user_1', 'member'),
           ('org_1', 'user_2', 'member'),
           ('org_1', 'admin_1', 'admin')
  `);
  await pool.query(`
    INSERT INTO organization_storage_policies(
      organization_id, upload_policy, export_policy, updated_by
    ) VALUES ('org_1', 'all_members', 'disabled', 'owner_1')
  `);

  const identity = { audience: "liteasy-desktop", subject: "user_1" };
  const personalScope = await authorizeLibraryScope(pool, identity, { scopeId: "user_1", scopeType: "user" }, "upload");
  const organizationScope = await authorizeLibraryScope(pool, identity, { scopeId: "org_1", scopeType: "organization" }, "upload");
  assert.equal(personalScope.role, "owner");
  assert.equal(organizationScope.role, "member");
  await assert.rejects(
    () => authorizeLibraryScope(pool, identity, { scopeId: "org_1", scopeType: "organization" }, "export"),
    /organization_export_forbidden/
  );

  const policyRepository = new PostgresOrganizationPolicyRepository(pool);
  const ownerScope = await authorizeLibraryScope(pool, {
    audience: "liteasy-desktop", subject: "owner_1"
  }, { scopeId: "org_1", scopeType: "organization" }, "manage");
  const policyInput = {
    actorId: "owner_1",
    expectedRevision: 0,
    exportPolicy: "admins_only",
    idempotencyKey: "organization-policy-0001",
    traceId: "trace_policy_1",
    uploadPolicy: "all_members"
  };
  const updatedPolicy = await policyRepository.update(ownerScope, policyInput);
  assert.equal(updatedPolicy.revision, 1);
  assert.equal(updatedPolicy.role, "owner");
  assert.deepEqual(await policyRepository.update(ownerScope, { ...policyInput, traceId: "trace_policy_retry" }), updatedPolicy);
  await assert.rejects(
    () => policyRepository.update(organizationScope, { ...policyInput, idempotencyKey: "organization-policy-member" }),
    /organization_policy_owner_required/
  );

  const governance = new PostgresOrganizationGovernanceRepository(pool);
  const governanceOwner = { audience: "liteasy-desktop", subject: "governance_owner" };
  const governanceMember = { audience: "liteasy-desktop", subject: "governance_member" };
  const governanceAdmin = { audience: "liteasy-desktop", subject: "governance_admin" };
  const governanceMemberTwo = { audience: "liteasy-desktop", subject: "governance_member_2" };
  const createdOrganizationInput = {
    idempotencyKey: "organization-create-governance",
    name: "Governance research group",
    traceId: "trace_governance_create"
  };
  const createdOrganization = await governance.create(governanceOwner, createdOrganizationInput);
  assert.equal(createdOrganization.organization.myRole, "owner");
  assert.equal(createdOrganization.organization.revision, 0);
  assert.deepEqual(await governance.create(governanceOwner, {
    ...createdOrganizationInput,
    traceId: "trace_governance_create_retry"
  }), createdOrganization);
  const governanceOrganizationId = createdOrganization.organization.organizationId;
  assert.equal((await governance.list(governanceOwner)).organizations[0].organizationId, governanceOrganizationId);

  const memberInvitation = await governance.invite(governanceOwner, {
    expectedRevision: 0,
    idempotencyKey: "organization-invite-governance-member",
    organizationId: governanceOrganizationId,
    role: "member",
    targetSubject: governanceMember.subject,
    traceId: "trace_governance_invite_member"
  });
  assert.equal(memberInvitation.organizationRevision, 1);
  assert.match(memberInvitation.invitation.invitationToken, /^orginv_[A-Za-z0-9_-]{43}$/);
  const storedInvitation = await pool.query(`
    SELECT token_hash FROM organization_invitations WHERE invitation_id = $1
  `, [memberInvitation.invitation.invitationId]);
  assert.match(storedInvitation.rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedInvitation.rows[0].token_hash, memberInvitation.invitation.invitationToken);
  await assert.rejects(() => governance.acceptInvitation({
    audience: "liteasy-desktop", subject: "invitation_thief"
  }, {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-stolen-invite",
    invitationToken: memberInvitation.invitation.invitationToken,
    traceId: "trace_governance_stolen"
  }), /organization_invitation_required/);
  const acceptedMember = await governance.acceptInvitation(governanceMember, {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-governance-member",
    invitationToken: memberInvitation.invitation.invitationToken,
    traceId: "trace_governance_accept_member"
  });
  assert.equal(acceptedMember.organizationRevision, 2);
  assert.equal(acceptedMember.membership.subject, governanceMember.subject);

  const adminInvitation = await governance.invite(governanceOwner, {
    expectedRevision: 2,
    idempotencyKey: "organization-invite-governance-admin",
    organizationId: governanceOrganizationId,
    role: "admin",
    targetSubject: governanceAdmin.subject,
    traceId: "trace_governance_invite_admin"
  });
  const acceptedAdmin = await governance.acceptInvitation(governanceAdmin, {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-governance-admin",
    invitationToken: adminInvitation.invitation.invitationToken,
    traceId: "trace_governance_accept_admin"
  });
  assert.equal(acceptedAdmin.organizationRevision, 4);
  await assert.rejects(() => governance.invite(governanceAdmin, {
    expectedRevision: 4,
    idempotencyKey: "organization-admin-cannot-grant-admin",
    organizationId: governanceOrganizationId,
    role: "admin",
    targetSubject: "forbidden_admin_target",
    traceId: "trace_governance_admin_denied"
  }), /organization_owner_required/);

  const secondMemberInvitation = await governance.invite(governanceAdmin, {
    expectedRevision: 4,
    idempotencyKey: "organization-admin-invite-member",
    organizationId: governanceOrganizationId,
    role: "member",
    targetSubject: governanceMemberTwo.subject,
    traceId: "trace_governance_admin_invite_member"
  });
  const acceptedMemberTwo = await governance.acceptInvitation(governanceMemberTwo, {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-governance-member-two",
    invitationToken: secondMemberInvitation.invitation.invitationToken,
    traceId: "trace_governance_accept_member_two"
  });
  assert.equal(acceptedMemberTwo.organizationRevision, 6);

  const suspended = await governance.setMemberStatus(governanceOwner, {
    expectedMemberRevision: 0,
    expectedRevision: 6,
    idempotencyKey: "organization-suspend-governance-member",
    organizationId: governanceOrganizationId,
    status: "suspended",
    targetSubject: governanceMember.subject,
    traceId: "trace_governance_suspend_member"
  });
  assert.equal(suspended.organizationRevision, 7);
  await assert.rejects(
    () => authorizeLibraryScope(pool, governanceMember, {
      scopeId: governanceOrganizationId,
      scopeType: "organization"
    }, "read"),
    /organization_membership_required/
  );
  const promoted = await governance.changeMemberRole(governanceOwner, {
    expectedMemberRevision: 0,
    expectedRevision: 7,
    idempotencyKey: "organization-promote-governance-member-two",
    organizationId: governanceOrganizationId,
    role: "admin",
    targetSubject: governanceMemberTwo.subject,
    traceId: "trace_governance_promote_member"
  });
  assert.equal(promoted.organizationRevision, 8);
  assert.equal(promoted.member.role, "admin");
  const transferred = await governance.transferOwnership(governanceOwner, {
    expectedMemberRevision: 1,
    expectedRevision: 8,
    idempotencyKey: "organization-transfer-governance-owner",
    organizationId: governanceOrganizationId,
    targetSubject: governanceMemberTwo.subject,
    traceId: "trace_governance_transfer_owner"
  });
  assert.equal(transferred.newOwnerSubject, governanceMemberTwo.subject);
  assert.equal(transferred.organizationRevision, 9);
  assert.equal(transferred.previousOwnerMembership.role, "admin");

  const resumed = await governance.setMemberStatus(governanceMemberTwo, {
    expectedMemberRevision: 1,
    expectedRevision: 9,
    idempotencyKey: "organization-resume-governance-member",
    organizationId: governanceOrganizationId,
    status: "active",
    targetSubject: governanceMember.subject,
    traceId: "trace_governance_resume_member"
  });
  assert.equal(resumed.organizationRevision, 10);
  const left = await governance.leave(governanceMember, {
    expectedMemberRevision: 2,
    expectedRevision: 10,
    idempotencyKey: "organization-leave-governance-member",
    organizationId: governanceOrganizationId,
    traceId: "trace_governance_leave_member"
  });
  assert.equal(left.organizationRevision, 11);
  await assert.rejects(() => governance.leave(governanceMemberTwo, {
    expectedMemberRevision: 0,
    expectedRevision: 11,
    idempotencyKey: "organization-owner-cannot-leave",
    organizationId: governanceOrganizationId,
    traceId: "trace_governance_owner_leave"
  }), /organization_owner_leave_blocked/);
  const governanceSummary = await governance.summary(governanceMemberTwo, {
    organizationId: governanceOrganizationId
  });
  assert.equal(governanceSummary.summary.myRole, "owner");
  assert.equal(governanceSummary.summary.revision, 11);
  assert.equal(governanceSummary.summary.memberCount, 3);
  await assert.rejects(() => pool.query(`
    INSERT INTO organization_members(organization_id, member_subject, role)
    VALUES ($1, $2, 'member')
  `, [governanceOrganizationId, governanceMemberTwo.subject]), /organization_owner_member_duplicate/);

  const repository = new PostgresLibraryRepository(pool);
  const empty = await repository.getTree(personalScope);
  assert.equal(empty.tree.revision, 0);
  assert.deepEqual(empty.tree.entries, []);

  const folderInput = {
    actorId: "user_1",
    expectedRevision: 0,
    idempotencyKey: "folder-create-0001",
    name: "Research",
    traceId: "trace_integration_1"
  };
  const folder = await repository.createFolder(personalScope, folderInput);
  assert.equal(folder.revision, 1);
  const retry = await repository.createFolder(personalScope, { ...folderInput, traceId: "trace_retry" });
  assert.equal(retry.folder.folderId, folder.folder.folderId);
  assert.equal(retry.revision, 1);

  const metadata = await repository.createMetadataEntry(personalScope, {
    actorId: "user_1",
    doi: "10.1000/integration",
    expectedRevision: 1,
    folderId: folder.folder.folderId,
    idempotencyKey: "metadata-create-0001",
    title: "Verified paper",
    traceId: "trace_integration_2"
  });
  assert.equal(metadata.entry.entryKind, "metadata_only");
  assert.equal(metadata.revision, 2);

  await assert.rejects(
    () => repository.createFolder(personalScope, {
      actorId: "user_1",
      expectedRevision: 1,
      idempotencyKey: "folder-stale-0001",
      name: "Stale"
    }),
    /library_revision_conflict/
  );
  await assert.rejects(
    () => repository.createMetadataEntry(personalScope, {
      actorId: "user_1",
      expectedRevision: 2,
      idempotencyKey: "metadata-collision-0001",
      title: "Research"
    }),
    /library_name_exists/
  );

  const upload = await repository.preparePdfUpload(personalScope, {
    actorId: "user_1",
    expectedRevision: 2,
    fileName: "uploaded.pdf",
    finalKey: `documents/objects/bb/${"b".repeat(64)}`,
    folderId: folder.folder.folderId,
    idempotencyKey: "upload-pdf-0001",
    traceId: "trace_integration_3"
  }, {
    byteLength: 12,
    contentHash: "b".repeat(64),
    securityScan: {
      contentHash: "b".repeat(64),
      scannedAt: "2026-08-07T00:00:00.000Z",
      scanner: "integration-scanner",
      version: "1.0.0"
    },
    storageKey: "documents/.staging/upload-pdf-0001"
  });
  assert.equal(upload.kind, "workflow");
  assert.equal(upload.workflow.security_scan_hash, "b".repeat(64));
  assert.equal((await repository.getTree(personalScope)).tree.entries.length, 1);
  await assert.rejects(
    () => repository.completePdfUpload(upload.workflow, "trace_integration_complete_too_early"),
    /storage_object_not_published/
  );
  await repository.markPdfObjectPublished(upload.workflow.workflow_id);
  await repository.completePdfUpload(upload.workflow, "trace_integration_3_complete");
  const scannedObject = await pool.query(`
    SELECT security_scan_hash, security_scanner, security_scanner_version
      FROM storage_objects WHERE content_hash = $1
  `, ["b".repeat(64)]);
  assert.deepEqual(scannedObject.rows[0], {
    security_scan_hash: "b".repeat(64),
    security_scanner: "integration-scanner",
    security_scanner_version: "1.0.0"
  });
  await assert.rejects(
    () => pool.query(`
      UPDATE storage_objects SET security_scan_hash = $2 WHERE content_hash = $1
    `, ["b".repeat(64), "c".repeat(64)]),
    /storage_objects_security_scan_proof_valid/
  );

  const tree = await repository.getTree(personalScope);
  assert.equal(tree.tree.folders.length, 1);
  assert.equal(tree.tree.entries.length, 2);
  assert.equal(tree.tree.revision, 3);
  assert.equal(tree.quota.limitBytes, 1048576);

  const nested = await repository.createFolder(personalScope, {
    actorId: "user_1",
    expectedRevision: 3,
    idempotencyKey: "folder-create-nested-0001",
    name: "Drafts",
    parentFolderId: folder.folder.folderId,
    traceId: "trace_integration_4"
  });
  assert.equal(nested.revision, 4);
  await assert.rejects(
    () => repository.updateFolder(personalScope, {
      actorId: "user_1",
      expectedRevision: 4,
      folderId: folder.folder.folderId,
      idempotencyKey: "folder-cycle-0001",
      parentFolderId: nested.folder.folderId,
      traceId: "trace_integration_cycle"
    }),
    /library_folder_cycle/
  );
  const moved = await repository.updateEntry(personalScope, {
    actorId: "user_1",
    documentId: metadata.entry.documentId,
    expectedRevision: 4,
    folderId: nested.folder.folderId,
    idempotencyKey: "entry-move-0001",
    title: "Verified paper revised",
    traceId: "trace_integration_5"
  });
  assert.equal(moved.document.folderId, nested.folder.folderId);
  assert.equal(moved.revision, 5);

  const trashedFolder = await repository.trashFolder(personalScope, {
    actorId: "user_1",
    expectedRevision: 5,
    folderId: folder.folder.folderId,
    idempotencyKey: "folder-trash-0001",
    traceId: "trace_integration_6"
  });
  assert.equal(trashedFolder.folder.status, "trashed");
  assert.equal(trashedFolder.revision, 6);
  assert.equal((await repository.getTree(personalScope)).tree.entries.length, 0);
  assert.equal((await repository.getTree(personalScope, "trashed")).tree.entries.length, 2);

  const replacement = await repository.createFolder(personalScope, {
    actorId: "user_1",
    expectedRevision: 6,
    idempotencyKey: "folder-create-replacement-0001",
    name: "Research",
    traceId: "trace_integration_7"
  });
  assert.equal(replacement.revision, 7);
  const restoredFolder = await repository.restoreFolder(personalScope, {
    actorId: "user_1",
    expectedRevision: 7,
    folderId: folder.folder.folderId,
    idempotencyKey: "folder-restore-0001",
    traceId: "trace_integration_8"
  });
  assert.equal(restoredFolder.folder.name, "Research (2)");
  assert.equal(restoredFolder.revision, 8);
  assert.equal((await repository.getTree(personalScope)).tree.entries.length, 2);

  const trashedEntry = await repository.trashEntry(personalScope, {
    actorId: "user_1",
    documentId: metadata.entry.documentId,
    expectedRevision: 8,
    idempotencyKey: "entry-trash-0001",
    traceId: "trace_integration_9"
  });
  assert.equal(trashedEntry.document.status, "trashed");
  const purgedEntry = await repository.purgeEntry(personalScope, {
    actorId: "user_1",
    documentId: metadata.entry.documentId,
    expectedRevision: 9,
    idempotencyKey: "entry-purge-0001",
    traceId: "trace_integration_10"
  });
  assert.equal(purgedEntry.result.purged, true);
  assert.equal(purgedEntry.revision, 10);
  assert.equal((await repository.getTree(personalScope)).tree.entries.length, 1);

  const sourcePdf = (await repository.getTree(personalScope)).tree.entries[0];
  const copied = await repository.copyEntry(personalScope, organizationScope, {
    actorId: "user_1",
    documentId: sourcePdf.documentId,
    expectedRevision: 0,
    idempotencyKey: "entry-copy-organization-0001",
    traceId: "trace_integration_11"
  });
  assert.equal(copied.entry.contentHash, sourcePdf.contentHash);
  assert.notEqual(copied.entry.documentId, sourcePdf.documentId);
  assert.equal(copied.revision, 1);
  const organizationMetadata = await repository.createMetadataEntry(organizationScope, {
    actorId: "user_1",
    expectedRevision: 1,
    idempotencyKey: "metadata-create-organization-0001",
    title: "Metadata awaiting PDF",
    traceId: "trace_integration_11_metadata"
  });
  const attached = await repository.prepareMetadataPdfAttachment(organizationScope, {
    actorId: "user_1",
    documentId: organizationMetadata.entry.documentId,
    expectedRevision: 2,
    fileName: "attached.pdf",
    finalKey: `documents/objects/bb/${"b".repeat(64)}`,
    idempotencyKey: "metadata-attach-pdf-0001",
    traceId: "trace_integration_11_attach"
  }, {
    byteLength: 12,
    contentHash: "b".repeat(64),
    securityScan: {
      contentHash: "b".repeat(64),
      scannedAt: "2026-08-07T00:01:00.000Z",
      scanner: "integration-scanner",
      version: "1.0.0"
    },
    storageKey: "documents/.staging/redundant-attach"
  });
  assert.equal(attached.kind, "complete");
  assert.equal(attached.response.entry.entryKind, "pdf");
  assert.equal(attached.response.revision, 3);

  await assert.rejects(() => pool.query(`
    INSERT INTO team_annotations(annotation_id, organization_id, document_id, uploaded_by, body)
    VALUES ('annotation_cross_scope', 'org_2', $1, 'owner_2', '{}')
  `, [copied.entry.documentId]), /annotation_document_scope_mismatch/);
  const annotations = new PostgresTeamAnnotationRepository(pool);
  const annotationInput = {
    actorId: "user_1",
    body: {
      clientAnnotationId: "local_annotation_1",
      excerpt: "Evidence",
      kind: "note",
      page: 2,
      rects: [],
      text: "Shared note",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    documentId: copied.entry.documentId,
    idempotencyKey: "annotation-create-0001",
    traceId: "trace_annotation_1"
  };
  const annotation = await annotations.create(organizationScope, annotationInput);
  assert.equal(annotation.uploadedBy, "user_1");
  assert.deepEqual(await annotations.create(organizationScope, {
    ...annotationInput, traceId: "trace_annotation_retry"
  }), annotation);
  assert.equal((await annotations.list(organizationScope, {
    documentId: copied.entry.documentId
  })).annotations.length, 1);
  const userTwoScope = await authorizeLibraryScope(pool, {
    audience: "liteasy-desktop", subject: "user_2"
  }, { scopeId: "org_1", scopeType: "organization" }, "read");
  await assert.rejects(() => annotations.update(userTwoScope, {
    actorId: "user_2",
    annotationId: annotation.annotationId,
    body: { ...annotationInput.body, text: "Unauthorized replacement" },
    expectedRevision: 1,
    idempotencyKey: "annotation-update-other",
    traceId: "trace_annotation_denied"
  }), /annotation_author_required/);
  const updatedAnnotation = await annotations.update(organizationScope, {
    actorId: "user_1",
    annotationId: annotation.annotationId,
    body: { ...annotationInput.body, text: "Revised shared note" },
    expectedRevision: 1,
    idempotencyKey: "annotation-update-0001",
    traceId: "trace_annotation_2"
  });
  assert.equal(updatedAnnotation.revision, 2);
  const adminScope = await authorizeLibraryScope(pool, {
    audience: "liteasy-desktop", subject: "admin_1"
  }, { scopeId: "org_1", scopeType: "organization" }, "read");
  const deletedAnnotation = await annotations.remove(adminScope, {
    actorId: "admin_1",
    annotationId: annotation.annotationId,
    expectedRevision: 2,
    idempotencyKey: "annotation-delete-0001",
    traceId: "trace_annotation_3"
  });
  assert.equal(deletedAnnotation.deleted, true);
  assert.equal((await annotations.list(organizationScope, {
    documentId: copied.entry.documentId
  })).annotations.length, 0);

  const agentArtifacts = new PostgresAgentArtifactRepository(pool);
  const artifactDocument = {
    agent: { runId: "run-agent-artifact-1", status: "completed" },
    answer: "Account-scoped analysis",
    artifactId: "shared-client-id",
    artifactType: "tree",
    citations: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    papers: [],
    title: "User one tree",
    version: "liteasy.agent-artifact/v1"
  };
  assert.equal((await agentArtifacts.save("user_1", artifactDocument, "trace_artifact_1")).revision, 1);
  assert.equal((await agentArtifacts.save("user_2", {
    ...artifactDocument,
    title: "User two tree"
  }, "trace_artifact_2")).revision, 1);
  assert.equal((await agentArtifacts.list("user_1")).artifacts[0].title, "User one tree");
  assert.equal((await agentArtifacts.list("user_2")).artifacts[0].title, "User two tree");
  assert.equal((await agentArtifacts.rename(
    "user_1", "shared-client-id", "Renamed user one tree", "trace_artifact_3"
  )).revision, 2);
  assert.equal((await agentArtifacts.remove(
    "user_2", "shared-client-id", "trace_artifact_4"
  )).deleted, true);
  assert.equal((await agentArtifacts.list("user_2")).artifacts.length, 0);

  const personalization = new PostgresPersonalizationRepository(pool);
  assert.equal((await personalization.get("user_1")).personalizationVersion, 0);
  const disabled = await personalization.setEnabled("user_1", {
    actorId: "user_1",
    enabled: false,
    expectedVersion: 0,
    idempotencyKey: "personalization-disable-0001",
    traceId: "trace_personalization_1"
  });
  assert.equal(disabled.enabled, false);
  await assert.rejects(() => personalization.syncLocalManifest("user_1", {
    actorId: "user_1",
    documents: [],
    idempotencyKey: "manifest-disabled-0001",
    traceId: "trace_personalization_disabled"
  }), /personalization_disabled/);
  const enabled = await personalization.setEnabled("user_1", {
    actorId: "user_1",
    enabled: true,
    expectedVersion: 1,
    idempotencyKey: "personalization-enable-0001",
    traceId: "trace_personalization_2"
  });
  assert.equal(enabled.personalizationVersion, 2);
  const profile = await personalization.saveProfile("user_1", {
    actorId: "user_1",
    expectedVersion: 2,
    idempotencyKey: "profile-save-0001",
    profile: {
      disciplines: [{
        categoryCode: "CS",
        categoryName: "Computer Science",
        code: "CS.AI",
        description: "Machine learning",
        name: "Artificial Intelligence"
      }],
      stage: "博士研究生"
    },
    traceId: "trace_personalization_3"
  });
  assert.equal(profile.profile.profileVersion, 1);
  const signalled = await personalization.recordSignal("user_1", {
    actorId: "user_1",
    idempotencyKey: "personalization-signal-0001",
    signal: { kind: "paper_opened", title: "Graph neural networks 图神经网络" },
    traceId: "trace_personalization_4"
  });
  assert.equal(signalled.personalizationVersion, 4);
  assert.ok(signalled.tags.length > 0);
  const manifestInput = {
    actorId: "user_1",
    documents: [{
      authors: ["Researcher One"],
      contentHash: "c".repeat(64),
      doi: "10.1000/private-safe",
      publicationYear: 2025,
      syncDocumentId: "account_scoped_sync_1",
      title: "Account scoped metadata"
    }],
    idempotencyKey: "manifest-sync-0001",
    traceId: "trace_personalization_5"
  };
  const manifest = await personalization.syncLocalManifest("user_1", manifestInput);
  assert.equal(manifest.acceptedCount, 1);
  assert.equal(manifest.personalizationVersion, 5);
  assert.deepEqual(await personalization.syncLocalManifest("user_1", {
    ...manifestInput, traceId: "trace_personalization_5_retry"
  }), manifest);
  const recommendationRepository = new PostgresRecommendationRepository(pool);
  assert.equal((await recommendationRepository.context("user_1")).version, 5);
  const recommendationCandidate = {
    canonicalId: "doi:10.1000/recommendation",
    discoveredAt: "2026-08-06T00:00:00.000Z",
    id: "reading-candidate:doi:10.1000/recommendation",
    reason: "Retrieved from a real provider.",
    relatedDocumentTitle: "Graph neural networks",
    relevanceBand: "high",
    relevanceScore: 0.9,
    source: "Crossref",
    sourceKind: "live",
    sourceUrl: "https://doi.org/10.1000/recommendation",
    title: "Recommendation candidate"
  };
  await recommendationRepository.saveCandidates("user_1", [recommendationCandidate], "trace_recommendation_user_1");
  await recommendationRepository.saveCandidates("user_2", [recommendationCandidate], "trace_recommendation_user_2");
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count FROM recommendation_candidates
     WHERE candidate_id = 'reading-candidate:doi:10.1000/recommendation'
  `)).rows[0].count, 2);
  const cacheScope = {
    personalizationVersion: 5,
    selectionKey: "selection:12345678",
    sortMode: "relevance",
    workspaceKey: "workspace:12345678"
  };
  const cachePut = await recommendationRepository.putCache("user_1", {
    ...cacheScope,
    recommendations: [recommendationCandidate]
  });
  assert.equal(cachePut.ok, true);
  assert.equal((await recommendationRepository.getCache("user_1", cacheScope)).cacheHit, true);
  assert.equal((await recommendationRepository.getCache("user_1", {
    ...cacheScope, personalizationVersion: 4
  })).cacheHit, false);
  const feedbackInput = {
    action: "dismissed",
    candidate: {
      canonicalId: recommendationCandidate.canonicalId,
      id: recommendationCandidate.id,
      source: recommendationCandidate.source,
      title: recommendationCandidate.title
    },
    idempotencyKey: "recommendation-feedback-integration",
    traceId: "trace_recommendation_feedback"
  };
  const feedback = await recommendationRepository.recordFeedback("user_1", feedbackInput);
  assert.equal(feedback.feedback.action, "dismissed");
  assert.equal(feedback.invalidatedCacheEntries, 1);
  assert.deepEqual(await recommendationRepository.recordFeedback("user_1", {
    ...feedbackInput, traceId: "trace_recommendation_feedback_retry"
  }), feedback);
  assert.equal((await recommendationRepository.getCache("user_1", cacheScope)).cacheHit, false);
  await pool.query(`
    INSERT INTO recommendation_feedback(feedback_id, subject_id, recommendation_id)
    VALUES ('feedback_1', 'user_1', 'recommendation_1');
    INSERT INTO recommendation_candidates(candidate_id, subject_id, body, expires_at)
    VALUES ('candidate_1', 'user_1', '{}', now() + interval '1 hour'),
           ('candidate_expired', 'user_2', '{}', now() - interval '1 second');
    INSERT INTO recommendation_cache_entries(
      subject_id, cache_key, personalization_version, body, expires_at
    ) VALUES ('user_1', 'cache_1', 5, '{}', now() + interval '1 hour'),
             ('user_2', 'cache_expired', 0, '{}', now() - interval '1 second');
    INSERT INTO idempotency_records(
      actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at
    ) VALUES ('maintenance_test', 'expired_operation', 'expired-key-0001', '${"d".repeat(64)}',
      200, '{}', now() - interval '1 second');
  `);
  assert.deepEqual(await personalization.purgeExpiredCaches(100), {
    idempotencyRecords: 1,
    recommendationCacheEntries: 1,
    recommendationCandidates: 1
  });
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count FROM recommendation_cache_entries WHERE subject_id = 'user_1'
  `)).rows[0].count, 1);
  const libraryCountBeforeClear = (await pool.query("SELECT count(*)::int AS count FROM library_entries")).rows[0].count;
  const clearInput = {
    actorId: "user_1",
    expectedVersion: 5,
    idempotencyKey: "personalization-clear-0001",
    traceId: "trace_personalization_6"
  };
  const cleared = await personalization.clear("user_1", clearInput);
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.enabled, false);
  assert.equal(cleared.personalizationVersion, 6);
  assert.deepEqual(await personalization.clear("user_1", { ...clearInput, traceId: "trace_clear_retry" }), cleared);
  for (const table of [
    "academic_profiles", "personalization_terms", "personalization_signals",
    "recommendation_feedback", "recommendation_suppressions", "recommendation_candidates",
    "recommendation_cache_entries", "local_library_manifest_entries"
  ]) {
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE subject_id = 'user_1'`)).rows[0].count, 0);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM library_entries")).rows[0].count, libraryCountBeforeClear);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM storage_objects")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM storage_object_references")).rows[0].count, 3);
  await assert.rejects(
    () => pool.query("UPDATE storage_objects SET status = 'deleting'"),
    /storage_object_reference_status_invalid/
  );

  const platformAdminRepository = new PostgresPlatformAdminRepository(pool, {
    environment: "production"
  });
  const bootstrapped = await platformAdminRepository.bootstrap("platform_admin_1", {
    reason: "Initial production platform administrator",
    traceId: "trace_admin_bootstrap"
  });
  assert.equal(bootstrapped.grant.state, "pending_activation");
  const adminIdentity = { audience: "liteasy-admin", subject: "platform_admin_1" };
  await assert.rejects(
    () => platformAdminRepository.principal(adminIdentity),
    /platform_role_required/
  );
  const adminPrincipal = await platformAdminRepository.principal(adminIdentity, {
    activatePending: true,
    traceId: "trace_admin_activate"
  });
  assert.deepEqual(adminPrincipal.roles, ["platform_admin"]);
  const quotaInput = {
    expectedRevision: 0,
    idempotencyKey: "set-user-quota-0001",
    limitBytes: 2097152,
    reason: "Approved integration storage increase",
    scopeId: "user_1",
    scopeType: "user",
    traceId: "trace_admin_quota"
  };
  const updatedQuota = await platformAdminRepository.setQuota(adminPrincipal, quotaInput);
  assert.equal(updatedQuota.quota.limitBytes, 2097152);
  assert.equal(updatedQuota.quota.revision, 1);
  assert.deepEqual(await platformAdminRepository.setQuota(adminPrincipal, {
    ...quotaInput,
    traceId: "trace_admin_quota_replay"
  }), updatedQuota);
  assert.deepEqual(await platformAdminRepository.getQuota(adminPrincipal, {
    scopeId: "user_1",
    scopeType: "user"
  }), updatedQuota);
  await assert.rejects(() => platformAdminRepository.setQuota(adminPrincipal, {
    ...quotaInput,
    idempotencyKey: "set-user-quota-stale",
    limitBytes: 3145728,
    traceId: "trace_admin_quota_stale"
  }), /quota_revision_conflict/);
  await assert.rejects(() => platformAdminRepository.getQuota(adminPrincipal, {
    scopeId: "org_missing",
    scopeType: "organization"
  }), /quota_scope_not_found/);
  const organizationQuota = await platformAdminRepository.setQuota(adminPrincipal, {
    expectedRevision: 0,
    idempotencyKey: "set-organization-quota-0001",
    limitBytes: 4194304,
    reason: "Approved organization storage allocation",
    scopeId: "org_2",
    scopeType: "organization",
    traceId: "trace_admin_organization_quota"
  });
  assert.equal(organizationQuota.quota.configured, true);
  assert.equal(organizationQuota.quota.limitBytes, 4194304);
  assert.equal(organizationQuota.quota.revision, 1);
  const initialGovernance = await platformAdminRepository.listGovernance(adminPrincipal);
  assert.deepEqual(
    initialGovernance.organizations.map((item) => item.organizationId).sort(),
    ["org_1", "org_2", governanceOrganizationId].sort()
  );
  assert.equal(initialGovernance.organizations.find(
    (item) => item.organizationId === "org_1"
  ).memberCount, 3);
  assert.equal(initialGovernance.organizations.find(
    (item) => item.organizationId === "org_2"
  ).ownerSubject, "owner_2");
  assert.equal(initialGovernance.roleGrants.length, 1);
  const suspendOrganizationInput = {
    expectedRevision: 0,
    idempotencyKey: "suspend-organization-0001",
    organizationId: "org_2",
    reason: "Approved integration organization suspension",
    status: "suspended",
    traceId: "trace_admin_organization_suspend"
  };
  const suspendedOrganization = await platformAdminRepository.setOrganizationStatus(
    adminPrincipal,
    suspendOrganizationInput
  );
  assert.equal(suspendedOrganization.organization.status, "suspended");
  assert.equal(suspendedOrganization.organization.revision, 1);
  assert.equal(suspendedOrganization.organization.limitBytes, 4194304);
  assert.equal(suspendedOrganization.organization.memberCount, 0);
  assert.equal(suspendedOrganization.organization.usedBytes, 0);
  assert.deepEqual(await platformAdminRepository.setOrganizationStatus(adminPrincipal, {
    ...suspendOrganizationInput,
    traceId: "trace_admin_organization_suspend_replay"
  }), suspendedOrganization);
  await assert.rejects(() => platformAdminRepository.setOrganizationStatus(adminPrincipal, {
    ...suspendOrganizationInput,
    idempotencyKey: "suspend-organization-stale",
    traceId: "trace_admin_organization_stale"
  }), /organization_revision_conflict/);
  const restoredOrganization = await platformAdminRepository.setOrganizationStatus(adminPrincipal, {
    expectedRevision: 1,
    idempotencyKey: "restore-organization-0001",
    organizationId: "org_2",
    reason: "Approved integration organization restoration",
    status: "active",
    traceId: "trace_admin_organization_restore"
  });
  assert.equal(restoredOrganization.organization.status, "active");
  assert.equal(restoredOrganization.organization.revision, 2);
  assert.equal(restoredOrganization.organization.limitBytes, 4194304);
  assert.equal(restoredOrganization.organization.memberCount, 0);
  assert.equal(restoredOrganization.organization.usedBytes, 0);
  const modelPolicyInput = {
    cloudProxyEndpoint: "https://models.example.com/liteasy",
    defaultProvider: "openai",
    expectedRevision: 0,
    idempotencyKey: "set-model-policy-0001",
    reason: "Approved production model proxy",
    traceId: "trace_admin_model_policy"
  };
  const modelPolicy = await platformAdminRepository.setModelPolicy(
    adminPrincipal,
    modelPolicyInput
  );
  assert.equal(modelPolicy.policy.policyVersion, "policy-1");
  assert.deepEqual(await platformAdminRepository.setModelPolicy(adminPrincipal, {
    ...modelPolicyInput,
    traceId: "trace_admin_model_policy_replay"
  }), modelPolicy);
  assert.deepEqual(await platformAdminRepository.loadModelPolicy(), modelPolicy.policy);
  await assert.rejects(() => platformAdminRepository.setModelPolicy(adminPrincipal, {
    ...modelPolicyInput,
    apiKey: "must-not-be-stored",
    idempotencyKey: "set-model-secret-0001",
    traceId: "trace_admin_model_secret"
  }), /admin_secret_material_forbidden/);
  await assert.rejects(() => platformAdminRepository.setModelPolicy(adminPrincipal, {
    ...modelPolicyInput,
    cloudProxyEndpoint: "https://api.openai.com/v1",
    idempotencyKey: "set-model-direct-0001",
    traceId: "trace_admin_model_direct"
  }), /model_proxy_endpoint_invalid/);
  const retrievalSourceInput = {
    baseUrl: "https://api.openalex.org/works",
    connectorType: "openalex",
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "save-retrieval-source-0001",
    name: "OpenAlex",
    reason: "Approved scholarly retrieval source",
    sourceKind: "database",
    traceId: "trace_admin_source_create"
  };
  const retrievalSource = await platformAdminRepository.saveRetrievalSource(
    adminPrincipal,
    retrievalSourceInput
  );
  assert.match(retrievalSource.source.sourceId, /^source_/);
  assert.equal(retrievalSource.source.revision, 1);
  assert.deepEqual(await platformAdminRepository.saveRetrievalSource(adminPrincipal, {
    ...retrievalSourceInput,
    traceId: "trace_admin_source_replay"
  }), retrievalSource);
  const updatedSource = await platformAdminRepository.saveRetrievalSource(adminPrincipal, {
    ...retrievalSourceInput,
    expectedRevision: 1,
    idempotencyKey: "save-retrieval-source-0002",
    name: "OpenAlex Scholarly Works",
    sourceId: retrievalSource.source.sourceId,
    traceId: "trace_admin_source_update"
  });
  assert.equal(updatedSource.source.revision, 2);
  assert.equal((await platformAdminRepository.listRetrievalSources(adminPrincipal)).sources.length, 1);
  const externalKnowledgeRepository = new PostgresExternalKnowledgeRepository(pool);
  assert.deepEqual(await externalKnowledgeRepository.listEnabledSources(), [{
    baseUrl: "https://api.openalex.org/works",
    connectorType: "openalex",
    revision: 2,
    sourceId: retrievalSource.source.sourceId
  }]);
  const pdfGrants = await externalKnowledgeRepository.issuePdfGrants("user_1", [{
    connectorSourceId: retrievalSource.source.sourceId,
    source: {
      fullTextUrl: "https://repository.example.test/paper.pdf",
      id: "openalex:W123456789",
      provider: "openalex",
      sourceId: "W123456789"
    }
  }]);
  const pdfGrantId = pdfGrants.get("openalex:W123456789");
  assert.match(pdfGrantId, /^pdfgrant_/);
  assert.deepEqual(await externalKnowledgeRepository.loadPdfGrant("user_1", {
    grantId: pdfGrantId,
    sourceId: "openalex:W123456789"
  }), {
    sourceId: "openalex:W123456789",
    url: "https://repository.example.test/paper.pdf"
  });
  await assert.rejects(() => externalKnowledgeRepository.loadPdfGrant("user_2", {
    grantId: pdfGrantId,
    sourceId: "openalex:W123456789"
  }), /external_pdf_grant_not_found/);
  await pool.query(
    "UPDATE external_retrieval_pdf_grants SET expires_at = now() - interval '1 minute' WHERE grant_id = $1",
    [pdfGrantId]
  );
  const retrievalCacheKey = "a".repeat(64);
  await externalKnowledgeRepository.saveRetrievalCache("user_1", retrievalCacheKey, []);
  assert.deepEqual(await externalKnowledgeRepository.loadRetrievalCache("user_1", retrievalCacheKey), { items: [] });
  assert.equal(await externalKnowledgeRepository.loadRetrievalCache("user_2", retrievalCacheKey), null);
  await pool.query(`
    INSERT INTO external_retrieval_cache(
      subject_id, cache_key, payload, expires_at, created_at, last_accessed_at
    )
    SELECT 'cache_capacity_user', lpad(to_hex(sequence), 64, '0'), '{"items":[]}'::jsonb,
           now() + interval '1 hour', now() - (sequence * interval '1 minute'),
           now() - (sequence * interval '1 minute')
      FROM generate_series(1, 101) AS sequence
  `);
  await pool.query(`
    INSERT INTO external_retrieval_cache(subject_id, cache_key, payload, expires_at)
    VALUES ('cache_other_user', $1, '{"items":[]}'::jsonb, now() + interval '1 hour')
  `, ["e".repeat(64)]);
  const newestCapacityKey = "f".repeat(64);
  await externalKnowledgeRepository.saveRetrievalCache("cache_capacity_user", newestCapacityKey, []);
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count
      FROM external_retrieval_cache
     WHERE subject_id = 'cache_capacity_user'
  `)).rows[0].count, 100);
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count
      FROM external_retrieval_cache
     WHERE subject_id = 'cache_capacity_user' AND cache_key = $1
  `, [newestCapacityKey])).rows[0].count, 1);
  assert.equal((await pool.query(`
    SELECT count(*)::int AS count
      FROM external_retrieval_cache
     WHERE subject_id = 'cache_other_user'
  `)).rows[0].count, 1);
  await pool.query(
    "UPDATE external_retrieval_cache SET expires_at = now() - interval '1 minute' WHERE cache_key = $1",
    [retrievalCacheKey]
  );
  assert.deepEqual(await externalKnowledgeRepository.purgeExpiredRetrievalData(10), {
    pdfGrants: 1,
    retrievalCacheEntries: 1
  });
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM external_retrieval_pdf_grants WHERE grant_id = $1",
    [pdfGrantId]
  )).rows[0].count, 0);
  await assert.rejects(() => platformAdminRepository.saveRetrievalSource(adminPrincipal, {
    ...retrievalSourceInput,
    idempotencyKey: "save-retrieval-source-duplicate",
    sourceId: "source_duplicate",
    traceId: "trace_admin_source_duplicate"
  }), /retrieval_source_connector_exists/);
  const removeSourceInput = {
    expectedRevision: 2,
    idempotencyKey: "remove-retrieval-source-0001",
    reason: "Approved retrieval source removal",
    sourceId: retrievalSource.source.sourceId,
    traceId: "trace_admin_source_remove"
  };
  const removedSource = await platformAdminRepository.removeRetrievalSource(
    adminPrincipal,
    removeSourceInput
  );
  assert.deepEqual(await platformAdminRepository.removeRetrievalSource(adminPrincipal, {
    ...removeSourceInput,
    traceId: "trace_admin_source_remove_replay"
  }), removedSource);
  assert.deepEqual(await platformAdminRepository.listRetrievalSources(adminPrincipal), {
    sources: []
  });
  const sensitiveColumns = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('platform_model_policies', 'platform_retrieval_sources')
       AND column_name ~* '(api.?key|credential|password|secret|token)'
  `);
  assert.deepEqual(sensitiveColumns.rows, []);
  const secondAdmin = await platformAdminRepository.grantRole(adminPrincipal, {
    idempotencyKey: "grant-platform-admin-0001",
    reason: "Add the security operations administrator",
    role: "platform_admin",
    subjectId: "platform_admin_2",
    traceId: "trace_admin_grant"
  });
  const support = await platformAdminRepository.grantSupportAccess(adminPrincipal, {
    documentId: sourcePdf.documentId,
    durationMinutes: 15,
    granteeSubject: adminPrincipal.subjectId,
    idempotencyKey: "grant-support-access-0001",
    reason: "Investigate reported PDF corruption",
    scopeId: "user_1",
    scopeType: "user",
    traceId: "trace_support_grant"
  });
  const supportScope = await platformAdminRepository.resolveSupportScope(adminPrincipal, {
    documentId: sourcePdf.documentId,
    grantId: support.grant.grantId
  });
  assert.deepEqual({ scopeId: supportScope.scopeId, scopeType: supportScope.scopeType }, {
    scopeId: "user_1", scopeType: "user"
  });
  await assert.rejects(() => platformAdminRepository.resolveSupportScope(adminPrincipal, {
    documentId: copied.entry.documentId,
    grantId: support.grant.grantId
  }), /support_access_required/);
  await platformAdminRepository.revokeSupportAccess(adminPrincipal, {
    grantId: support.grant.grantId,
    idempotencyKey: "revoke-support-access-0001",
    reason: "Support investigation is complete",
    traceId: "trace_support_revoke"
  });
  await assert.rejects(
    () => platformAdminRepository.resolveSupportScope(adminPrincipal, {
      documentId: sourcePdf.documentId,
      grantId: support.grant.grantId
    }),
    /support_access_required/
  );
  await platformAdminRepository.revokeRole(adminPrincipal, {
    grantId: secondAdmin.grant.grantId,
    idempotencyKey: "revoke-platform-admin-0001",
    reason: "Remove the completed temporary assignment",
    traceId: "trace_admin_revoke"
  });
  await assert.rejects(() => platformAdminRepository.revokeRole(adminPrincipal, {
    grantId: bootstrapped.grant.grantId,
    idempotencyKey: "revoke-last-platform-admin",
    reason: "This operation must retain one administrator",
    traceId: "trace_admin_last_revoke"
  }), /last_platform_admin_required/);

  await repository.trashEntry(personalScope, {
    actorId: "user_1",
    documentId: sourcePdf.documentId,
    expectedRevision: 10,
    idempotencyKey: "entry-trash-source-pdf-0001",
    traceId: "trace_integration_12"
  });
  await repository.trashEntry(organizationScope, {
    actorId: "user_1",
    documentId: copied.entry.documentId,
    expectedRevision: 3,
    idempotencyKey: "entry-trash-copied-pdf-0001",
    traceId: "trace_integration_13"
  });
  await repository.trashEntry(organizationScope, {
    actorId: "user_1",
    documentId: organizationMetadata.entry.documentId,
    expectedRevision: 4,
    idempotencyKey: "entry-trash-attached-pdf-0001",
    traceId: "trace_integration_14"
  });
  await pool.query("UPDATE library_entries SET purge_after = now() - interval '1 second' WHERE status = 'trashed'");
  assert.deepEqual(await repository.purgeExpiredTrash(), { purgedCount: 3, scopes: 2 });
  const garbage = await repository.claimUnreferencedObjects();
  assert.equal(garbage.length, 1);
  assert.equal(garbage[0].content_hash, sourcePdf.contentHash);
  await repository.completeObjectGarbageCollection(sourcePdf.contentHash);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM storage_objects")).rows[0].count, 0);

  const audit = await pool.query("SELECT audit_id, action, trace_id FROM audit_events ORDER BY occurred_at, audit_id");
  const platformAuditActions = new Set([
    "platform_admin_activated",
    "platform_admin_bootstrapped",
    "platform_role_granted",
    "platform_role_revoked",
    "model_policy_updated",
    "retrieval_source_removed",
    "retrieval_source_saved",
    "storage_quota_updated",
    "support_access_granted",
    "support_access_revoked"
  ]);
  assert.deepEqual(audit.rows.filter((row) => !platformAuditActions.has(row.action)).map((row) => row.action), [
    "update_organization_storage_policy",
    "create_organization",
    "create_organization_invitation",
    "accept_organization_invitation",
    "create_organization_invitation",
    "accept_organization_invitation",
    "create_organization_invitation",
    "accept_organization_invitation",
    "change_organization_member_status",
    "change_organization_member_role",
    "transfer_organization_ownership",
    "change_organization_member_status",
    "leave_organization",
    "create_library_folder",
    "create_metadata_entry",
    "upload_pdf",
    "create_library_folder",
    "update_library_entry",
    "trash_library_folder",
    "create_library_folder",
    "restore_library_folder",
    "trash_library_entry",
    "purge_library_entry",
    "copy_library_entry",
    "create_metadata_entry",
    "attach_metadata_pdf",
    "create_team_annotation",
    "update_team_annotation",
    "delete_team_annotation",
    "save_agent_artifact",
    "save_agent_artifact",
    "rename_agent_artifact",
    "delete_agent_artifact",
    "update_personalization_setting",
    "update_personalization_setting",
    "save_academic_profile",
    "record_personalization_signal",
    "sync_local_library_manifest",
    "generate_recommendations",
    "generate_recommendations",
    "record_recommendation_feedback",
    "clear_personalization_data",
    "organization_status_updated",
    "organization_status_updated",
    "trash_library_entry",
    "trash_library_entry",
    "trash_library_entry",
    "purge_expired_library_trash",
    "purge_expired_library_trash"
  ]);

  await assert.rejects(
    () => pool.query("UPDATE audit_events SET action = 'tampered' WHERE audit_id = $1", [audit.rows[0].audit_id]),
    /audit_events_are_append_only/
  );
  const finalAudit = await pool.query("SELECT action FROM audit_events ORDER BY occurred_at, audit_id");
  assert.deepEqual(finalAudit.rows.filter((row) => platformAuditActions.has(row.action)).map((row) => row.action), [
    "platform_admin_bootstrapped",
    "platform_admin_activated",
    "storage_quota_updated",
    "storage_quota_updated",
    "model_policy_updated",
    "retrieval_source_saved",
    "retrieval_source_saved",
    "retrieval_source_removed",
    "platform_role_granted",
    "support_access_granted",
    "support_access_revoked",
    "platform_role_revoked"
  ]);

  const deletionSubject = "account_delete_user";
  const survivorSubject = "account_delete_survivor";
  const sharedHash = "f".repeat(64);
  await pool.query(`
    INSERT INTO library_scope_revisions(scope_type, scope_id, revision)
    VALUES ('user', $1, 0), ('user', $2, 0)
  `, [deletionSubject, survivorSubject]);
  await pool.query(`
    INSERT INTO storage_quotas(scope_type, scope_id, limit_bytes, updated_by)
    VALUES ('user', $1, 1048576, 'seed'), ('user', $2, 1048576, 'seed')
  `, [deletionSubject, survivorSubject]);
  await pool.query(`
    INSERT INTO library_folders(
      folder_id, scope_type, scope_id, name, normalized_name, created_by
    ) VALUES ('account-delete-folder', 'user', $1, 'Private papers', 'private papers', $1)
  `, [deletionSubject]);
  await pool.query(`
    INSERT INTO storage_objects(
      content_hash, byte_length, storage_key, media_type, checksum_verified_at, status
    ) VALUES ($1, 16, 'objects/account-delete-shared.pdf', 'application/pdf', now(), 'available')
  `, [sharedHash]);
  await pool.query(`
    WITH inserted_entries AS (
      INSERT INTO library_entries(
      document_id, scope_type, scope_id, folder_id, entry_kind, file_name,
      normalized_name, title, metadata, logical_bytes, availability, created_by
      ) VALUES
      ('account-delete-document', 'user', $1, 'account-delete-folder', 'pdf',
       'private.pdf', 'private.pdf', 'Private account paper', '{}', 16, 'available', $1),
      ('account-survivor-document', 'user', $2, NULL, 'pdf',
       'survivor.pdf', 'survivor.pdf', 'Surviving shared paper', '{}', 16, 'available', $2),
      ('account-organization-document', 'organization', 'org_2', NULL, 'metadata_only',
       'organization-record.pdf', 'organization-record.pdf', 'Organization record', '{}', 0, 'available', 'owner_2')
      RETURNING document_id, entry_kind
    )
    INSERT INTO storage_object_references(document_id, content_hash)
    SELECT document_id, $3 FROM inserted_entries WHERE entry_kind = 'pdf'
  `, [deletionSubject, survivorSubject, sharedHash]);
  await pool.query(`
    INSERT INTO organization_members(organization_id, member_subject, role)
    VALUES ('org_1', $1, 'member')
  `, [deletionSubject]);
  await pool.query(`
    INSERT INTO organization_invitations(
      invitation_id, organization_id, invited_subject, intended_role, token_hash,
      created_by, expires_at
    ) VALUES ('account-delete-invitation', 'org_2', $1, 'member', $2, $1, now() + interval '1 day')
  `, [deletionSubject, "e".repeat(64)]);
  await pool.query(`
    INSERT INTO team_annotations(
      annotation_id, organization_id, document_id, uploaded_by, body
    ) VALUES
      ('account-delete-annotation', 'org_2', 'account-organization-document', $1,
       '{"clientAnnotationId":"delete-note","excerpt":"Delete me","kind":"note","page":1,"rects":[],"text":"Note","updatedAt":"2026-08-07T00:00:00.000Z"}'),
      ('account-survivor-annotation', 'org_2', 'account-organization-document', $2,
       '{"clientAnnotationId":"keep-note","excerpt":"Keep me","kind":"note","page":1,"rects":[],"text":"Note","updatedAt":"2026-08-07T00:00:00.000Z"}')
  `, [deletionSubject, survivorSubject]);
  await pool.query(`
    INSERT INTO platform_role_grants(
      grant_id, subject_id, role, state, granted_by, reason, activated_at
    ) VALUES ('account-delete-role', $1, 'developer_diagnostics', 'active',
              'admin_1', 'Account deletion integration role', now())
  `, [deletionSubject]);
  await pool.query(`
    INSERT INTO platform_support_access_grants(
      grant_id, grantee_subject, scope_type, scope_id, document_id, reason,
      granted_by, expires_at
    ) VALUES ('account-delete-support', $1, 'user', $1, 'account-delete-document',
              'Account deletion integration support grant', 'admin_1', now() + interval '1 hour')
  `, [deletionSubject]);
  await Promise.all([
    pool.query(
      "INSERT INTO personalization_states(subject_id, enabled) VALUES ($1, true)",
      [deletionSubject]
    ),
    pool.query(
      "INSERT INTO academic_profiles(subject_id, stage, disciplines) VALUES ($1, 'researcher', '[\"systems\"]')",
      [deletionSubject]
    ),
    pool.query(
      "INSERT INTO personalization_terms(subject_id, term) VALUES ($1, 'transactions')",
      [deletionSubject]
    ),
    pool.query(`
      INSERT INTO personalization_signals(signal_id, subject_id, kind, payload)
      VALUES ('account-delete-signal', $1, 'paper_opened', '{}')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO recommendation_feedback(feedback_id, subject_id, recommendation_id)
      VALUES ('account-delete-feedback', $1, 'recommendation-delete')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO recommendation_suppressions(subject_id, recommendation_id)
      VALUES ($1, 'recommendation-suppressed')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO recommendation_candidates(candidate_id, subject_id, body, expires_at)
      VALUES ('account-delete-candidate', $1, '{}', now() + interval '1 day')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO recommendation_cache_entries(
        subject_id, cache_key, personalization_version, body, expires_at
      ) VALUES ($1, 'account-delete-cache', 0, '{}', now() + interval '1 day')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO local_library_manifest_entries(subject_id, sync_document_id, title)
      VALUES ($1, 'account-delete-local-document', 'Local private metadata')
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO agent_artifacts(
        subject_id, artifact_id, artifact_type, title, body, created_at
      ) VALUES (
        $1, 'account-delete-artifact', 'tree', 'Delete artifact',
        '{"agent":{"runId":"delete-run","status":"completed"},"answer":"delete","artifactId":"account-delete-artifact","artifactType":"tree","citations":[],"createdAt":"2026-08-07T00:00:00.000Z","papers":[],"title":"Delete artifact","version":"liteasy.agent-artifact/v1"}',
        '2026-08-07T00:00:00.000Z'
      )
    `, [deletionSubject]),
    pool.query(`
      INSERT INTO idempotency_records(
        actor_id, operation, idempotency_key, request_hash, response_status, response_body, expires_at
      ) VALUES ($1, 'account-delete-fixture', 'account-delete-fixture-key', $2, 200, '{}', now() + interval '1 day')
    `, [deletionSubject, "d".repeat(64)])
  ]);

  const accountLifecycle = new PostgresAccountLifecycleRepository(pool);
  const deletionOperation = {
    actorId: "admin_1",
    idempotencyKey: "account-delete-operation-0001",
    reason: "Approved integration account deletion",
    status: "deleted",
    subjectId: deletionSubject,
    traceId: "trace_account_delete_1"
  };
  await assert.rejects(
    () => accountLifecycle.beginDeletion({ ...deletionOperation, subjectId: "owner_2" }),
    /account_owns_organization/
  );
  assert.deepEqual(await accountLifecycle.beginOperation(deletionOperation), { replayed: false });
  await assert.rejects(
    () => accountLifecycle.beginOperation(deletionOperation),
    /account_lifecycle_in_progress/
  );
  await assert.rejects(
    () => accountLifecycle.beginOperation({ ...deletionOperation, subjectId: survivorSubject }),
    /idempotency_key_reused/
  );
  await accountLifecycle.failOperation(deletionOperation, "integration_retry");
  assert.deepEqual(await accountLifecycle.beginOperation(deletionOperation), { replayed: false });
  const deletionJob = await accountLifecycle.beginDeletion(deletionOperation);
  assert.equal(deletionJob.state, "requested");
  await accountLifecycle.projectStatus({
    ...deletionOperation,
    allSessionsRevoked: true,
    identityUpdatedAt: "2026-08-07T00:00:00.000Z",
    revokedAudiences: ["liteasy-desktop", "intuecho-web", "liteasy-admin"],
    status: "disabled"
  });
  await accountLifecycle.markDeletionStage({
    result: { identityDisabledAt: "2026-08-07T00:00:00.000Z" },
    stage: "identity_disabled",
    subjectId: deletionSubject
  });
  const purge = await accountLifecycle.purgeLiteasyData(deletionOperation);
  assert.deepEqual(purge.result, {
    deletedAcademicProfiles: 1,
    deletedAgentArtifacts: 1,
    deletedEntries: 1,
    deletedFolders: 1,
    deletedIdempotencyRecords: 1,
    deletedInvitations: 1,
    deletedLocalLibraryManifestEntries: 1,
    deletedMemberships: 1,
    deletedPersonalizationSignals: 1,
    deletedPersonalizationStates: 1,
    deletedPersonalizationTerms: 1,
    deletedRecommendationCacheEntries: 1,
    deletedRecommendationCandidates: 1,
    deletedRecommendationFeedback: 1,
    deletedRecommendationSuppressions: 1,
    deletedScopeRevisions: 1,
    deletedStorageQuotas: 1,
    deletedTeamAnnotations: 1,
    revokedPlatformRoles: 1,
    revokedSupportGrants: 1
  });
  const accountCleared = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM library_entries WHERE scope_type = 'user' AND scope_id = $1) AS entries,
      (SELECT count(*)::int FROM library_folders WHERE scope_type = 'user' AND scope_id = $1) AS folders,
      (SELECT count(*)::int FROM organization_members WHERE member_subject = $1) AS memberships,
      (SELECT count(*)::int FROM organization_invitations
        WHERE invited_subject = $1 OR accepted_by = $1 OR revoked_by = $1 OR created_by = $1) AS invitations,
      (SELECT count(*)::int FROM team_annotations WHERE uploaded_by = $1) AS annotations,
      (SELECT count(*)::int FROM agent_artifacts WHERE subject_id = $1) AS agent_artifacts,
      (SELECT count(*)::int FROM academic_profiles WHERE subject_id = $1) AS profiles,
      (SELECT count(*)::int FROM personalization_terms WHERE subject_id = $1) AS terms,
      (SELECT count(*)::int FROM personalization_signals WHERE subject_id = $1) AS signals,
      (SELECT count(*)::int FROM recommendation_feedback WHERE subject_id = $1) AS feedback,
      (SELECT count(*)::int FROM recommendation_suppressions WHERE subject_id = $1) AS suppressions,
      (SELECT count(*)::int FROM recommendation_candidates WHERE subject_id = $1) AS candidates,
      (SELECT count(*)::int FROM recommendation_cache_entries WHERE subject_id = $1) AS cache,
      (SELECT count(*)::int FROM local_library_manifest_entries WHERE subject_id = $1) AS manifest
  `, [deletionSubject]);
  assert.deepEqual(accountCleared.rows[0], {
    agent_artifacts: 0,
    annotations: 0,
    cache: 0,
    candidates: 0,
    entries: 0,
    feedback: 0,
    folders: 0,
    invitations: 0,
    manifest: 0,
    memberships: 0,
    profiles: 0,
    signals: 0,
    suppressions: 0,
    terms: 0
  });
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM library_entries WHERE document_id = 'account-organization-document'"
  )).rows[0].count, 1);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM team_annotations WHERE annotation_id = 'account-survivor-annotation'"
  )).rows[0].count, 1);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM storage_objects WHERE content_hash = $1",
    [sharedHash]
  )).rows[0].count, 1);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM storage_object_references WHERE content_hash = $1",
    [sharedHash]
  )).rows[0].count, 1);
  assert.equal((await pool.query(
    "SELECT state FROM platform_role_grants WHERE grant_id = 'account-delete-role'"
  )).rows[0].state, "revoked");
  assert.notEqual((await pool.query(
    "SELECT revoked_at FROM platform_support_access_grants WHERE grant_id = 'account-delete-support'"
  )).rows[0].revoked_at, null);

  await accountLifecycle.markDeletionStage({
    result: { intuecho: { deletedDrafts: 3 } },
    stage: "intuecho_cleaned",
    subjectId: deletionSubject
  });
  await assert.rejects(
    () => accountLifecycle.markDeletionStage({
      result: {},
      stage: "liteasy_cleaned",
      subjectId: deletionSubject
    }),
    /account_deletion_stage_regression/
  );
  await accountLifecycle.markDeletionStage({
    result: {},
    stage: "identity_delete_requested",
    subjectId: deletionSubject
  });
  await accountLifecycle.failDeletion(deletionSubject, "identity_management_unavailable");
  const resumedDeletion = await accountLifecycle.beginDeletion(deletionOperation);
  assert.equal(resumedDeletion.attempts, 2);
  assert.equal(resumedDeletion.lastCompletedStage, "identity_delete_requested");
  assert.deepEqual(resumedDeletion.result.intuecho, { deletedDrafts: 3 });
  await accountLifecycle.markDeletionStage({
    result: { identityDeletedAt: "2026-08-07T00:05:00.000Z" },
    stage: "identity_deleted",
    subjectId: deletionSubject
  });
  await accountLifecycle.projectStatus({
    ...deletionOperation,
    allSessionsRevoked: true,
    identityUpdatedAt: "2026-08-07T00:05:00.000Z",
    revokedAudiences: ["liteasy-desktop", "intuecho-web", "liteasy-admin"],
    status: "deleted"
  });
  const completedDeletion = await accountLifecycle.markDeletionStage({
    result: {},
    stage: "completed",
    subjectId: deletionSubject
  });
  assert.equal(completedDeletion.state, "completed");
  const lifecycleResponse = {
    account: { status: "deleted", subjectId: deletionSubject },
    deletion: completedDeletion
  };
  await accountLifecycle.completeOperation(deletionOperation, lifecycleResponse);
  assert.deepEqual(await accountLifecycle.beginOperation(deletionOperation), {
    replayed: true,
    response: lifecycleResponse
  });
  assert.equal((await pool.query(
    "SELECT status FROM account_status_projections WHERE subject_id = $1",
    [deletionSubject]
  )).rows[0].status, "deleted");
  const lifecycleAudit = await pool.query(
    "SELECT audit_id, action FROM audit_events WHERE resource_id = $1 ORDER BY occurred_at, audit_id",
    [deletionSubject]
  );
  assert.deepEqual(lifecycleAudit.rows.map((row) => row.action), [
    "account_status_updated",
    "account_liteasy_data_deleted",
    "account_status_updated"
  ]);
  await assert.rejects(
    () => migrationPool.query(
      "UPDATE audit_events SET action = 'tampered' WHERE audit_id = $1",
      [lifecycleAudit.rows[0].audit_id]
    ),
    /audit_events_are_append_only/
  );
  const verifiedAudit = await pool.query("SELECT count(*)::int AS count FROM audit_events");
  process.stdout.write(`${JSON.stringify({
    auditEvents: verifiedAudit.rows[0].count,
    accountDeletion: true,
    migrations: migrated.applied.length,
    revision: 12,
    verified: true
  })}\n`);
} finally {
  await pool.end();
  if (migrationPool !== pool) await migrationPool.end();
}
