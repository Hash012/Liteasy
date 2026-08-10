import { createHash, randomUUID } from "node:crypto";
import {
  hasCrossVersionIdentifierConflict,
  LiteratureIdentityConflictError,
  normalizeLiteratureIdentifier,
  sameLiteratureBibliography,
  sameLiteratureVersionBibliography
} from "./literatureIdentity.mjs";

const aggregateLiteratureProviders = new Set(["openalex", "semantic_scholar"]);
const literatureResolverActor = "literature_resolver";

export class AnnotationCommunityError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function normalizeIdentity(kind, value) {
  return normalizeLiteratureIdentifier(kind, value);
}

function normalizeTag(value) {
  return String(value ?? "").trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 32);
}

function tagSlug(value) {
  return normalizeTag(value).toLocaleLowerCase("zh-CN").replace(/\s+/g, "-");
}

function uniqueTags(values) {
  return [...new Map(values.map(normalizeTag).filter(Boolean).map((name) => [tagSlug(name), name])).values()];
}

function textFeatures(value) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
  const features = new Map();
  for (const token of normalized.split(" ").filter(Boolean)) {
    features.set(token, (features.get(token) ?? 0) + 2);
    const characters = [...token];
    for (let index = 0; index < characters.length - 1; index += 1) {
      const gram = characters.slice(index, index + 2).join("");
      features.set(gram, (features.get(gram) ?? 0) + 1);
    }
  }
  return features;
}

export function localSemanticSimilarity(left, right) {
  const a = textFeatures(left);
  const b = textFeatures(right);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [feature, value] of a) dot += value * (b.get(feature) ?? 0);
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function initialsFor(name) {
  return [...String(name ?? "用户").trim()].slice(0, 2).join("") || "用户";
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const legacyPublicationDigest = "0".repeat(64);

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalJsonValue(value[key])]));
  }
  return value;
}

export function desktopAnnotationPublicationDigest(operation) {
  const normalized = {
    annotationId: operation.annotationId,
    operation: operation.operation,
    queueKey: operation.queueKey,
    revision: operation.revision,
    updatedAt: new Date(operation.updatedAt).toISOString(),
    ...(operation.operation === "upsert"
      ? {
          body: operation.body,
          literatureId: operation.literatureId,
          sourcePassage: {
            anchorHash: operation.sourcePassage.anchorHash,
            excerpt: operation.sourcePassage.excerpt,
            ...(operation.sourcePassage.page ? { page: operation.sourcePassage.page } : {}),
            rects: operation.sourcePassage.rects ?? []
          }
        }
      : { remoteAnnotationId: operation.remoteAnnotationId })
  };
  return createHash("sha256").update(JSON.stringify(canonicalJsonValue(normalized))).digest("hex");
}

export function initializeAnnotationCommunitySqlite(db) {
  db.exec("PRAGMA recursive_triggers = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS literature_records_v2 (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors_json TEXT NOT NULL, publication_year INTEGER, document_type TEXT, record_source TEXT NOT NULL DEFAULT 'legacy_metadata' CHECK(record_source IN ('legacy_metadata', 'public_registry', 'manual')), source_provider TEXT, confirmed_at TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), identity_status TEXT NOT NULL DEFAULT 'legacy_unverified' CHECK(identity_status IN ('confirmed', 'legacy_unverified')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desktop_annotation_handoffs_v2 (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT);
    CREATE TABLE IF NOT EXISTS literature_identities_v2 (literature_id TEXT NOT NULL, identity_kind TEXT NOT NULL CHECK(identity_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')), identity_value TEXT NOT NULL, identity_source TEXT NOT NULL CHECK(identity_source IN ('inferred', 'metadata', 'public_registry', 'manual')), created_at TEXT NOT NULL, PRIMARY KEY(literature_id, identity_kind, identity_value), UNIQUE(identity_kind, identity_value));
    CREATE TABLE IF NOT EXISTS literature_record_versions_v2 (id TEXT PRIMARY KEY, literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK(revision > 0), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'), changed_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(literature_id, revision));
    CREATE TABLE IF NOT EXISTS literature_identifiers_v2 (literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, identifier_kind TEXT NOT NULL CHECK(identifier_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')), normalized_value TEXT NOT NULL, is_legacy_alias INTEGER NOT NULL DEFAULT 0 CHECK(is_legacy_alias IN (0, 1)), created_at TEXT NOT NULL, PRIMARY KEY(literature_id, identifier_kind, normalized_value), UNIQUE(identifier_kind, normalized_value));
    CREATE TABLE IF NOT EXISTS literature_identity_claims_v2 (id TEXT PRIMARY KEY, literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, provider TEXT NOT NULL CHECK(provider IN ('crossref', 'arxiv', 'openalex', 'semantic_scholar')), provider_record_id TEXT NOT NULL, verification_status TEXT NOT NULL CHECK(verification_status = 'confirmed'), evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json) = 'object'), observed_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(provider, provider_record_id));
    CREATE INDEX IF NOT EXISTS literature_identity_claims_v2_literature_idx ON literature_identity_claims_v2(literature_id, observed_at DESC);
    CREATE TABLE IF NOT EXISTS literature_relations_v2 (id TEXT PRIMARY KEY, from_literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, to_literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, relation_type TEXT NOT NULL CHECK(relation_type IN ('is_preprint_of', 'version_of', 'translation_of')), provider TEXT NOT NULL CHECK(provider IN ('intuecho', 'crossref', 'arxiv', 'openalex', 'semantic_scholar')), verification_status TEXT NOT NULL CHECK(verification_status = 'confirmed'), evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json) AND json_type(evidence_json) = 'object'), created_at TEXT NOT NULL, CHECK(from_literature_id <> to_literature_id), UNIQUE(from_literature_id, to_literature_id, relation_type));
    CREATE INDEX IF NOT EXISTS literature_relations_v2_from_idx ON literature_relations_v2(from_literature_id, relation_type, to_literature_id);
    CREATE INDEX IF NOT EXISTS literature_relations_v2_to_idx ON literature_relations_v2(to_literature_id, relation_type, from_literature_id);
    CREATE TRIGGER IF NOT EXISTS literature_record_versions_append_only_update_v2
    BEFORE UPDATE ON literature_record_versions_v2
    BEGIN
      SELECT RAISE(ABORT, 'literature_record_version_is_append_only');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_record_versions_append_only_delete_v2
    BEFORE DELETE ON literature_record_versions_v2
    BEGIN
      SELECT RAISE(ABORT, 'literature_record_version_is_append_only');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_records_record_source_insert_guard_v2
    BEFORE INSERT ON literature_records_v2
    WHEN NEW.record_source NOT IN ('legacy_metadata', 'public_registry', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'literature_record_source_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_records_record_source_update_guard_v2
    BEFORE UPDATE OF record_source ON literature_records_v2
    WHEN NEW.record_source NOT IN ('legacy_metadata', 'public_registry', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'literature_record_source_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_kind_insert_guard_v2
    BEFORE INSERT ON literature_identities_v2
    WHEN NEW.identity_kind NOT IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_kind_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_kind_update_guard_v2
    BEFORE UPDATE OF identity_kind ON literature_identities_v2
    WHEN NEW.identity_kind NOT IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_kind_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_source_insert_guard_v2
    BEFORE INSERT ON literature_identities_v2
    WHEN NEW.identity_source NOT IN ('inferred', 'metadata', 'public_registry', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_source_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_source_update_guard_v2
    BEFORE UPDATE OF identity_source ON literature_identities_v2
    WHEN NEW.identity_source NOT IN ('inferred', 'metadata', 'public_registry', 'manual')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_source_invalid');
    END;
    CREATE TABLE IF NOT EXISTS community_user_profiles_v2 (user_id TEXT PRIMARY KEY, education_stage TEXT, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_profile_institutions_v2 (user_id TEXT NOT NULL, institution_name TEXT NOT NULL, institution_type TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, PRIMARY KEY(user_id, institution_name, institution_type));
    CREATE TABLE IF NOT EXISTS annotations_v2 (id TEXT PRIMARY KEY, parent_annotation_id TEXT, source_reply_id TEXT, body TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, author_profile_snapshot_json TEXT NOT NULL, visibility TEXT NOT NULL, organization_id TEXT, share_to_plaza INTEGER NOT NULL, helpful INTEGER NOT NULL DEFAULT 0, misleading INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, withdrawn_at TEXT);
    CREATE INDEX IF NOT EXISTS annotations_v2_plaza_idx ON annotations_v2(share_to_plaza, created_at DESC);
    CREATE INDEX IF NOT EXISTS annotations_v2_parent_idx ON annotations_v2(parent_annotation_id, created_at);
    CREATE TABLE IF NOT EXISTS annotation_targets_v2 (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, literature_id TEXT NOT NULL, target_kind TEXT NOT NULL, position INTEGER NOT NULL, target_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desktop_annotation_syncs_v2 (owner_id TEXT NOT NULL, queue_key TEXT NOT NULL, source_annotation_id TEXT NOT NULL, annotation_id TEXT NOT NULL UNIQUE, source_created_at TEXT NOT NULL, source_updated_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id, queue_key));
    CREATE TABLE IF NOT EXISTS desktop_annotation_publications_v2 (owner_id TEXT NOT NULL, queue_key TEXT NOT NULL, source_annotation_id TEXT NOT NULL, annotation_id TEXT NOT NULL UNIQUE, source_revision INTEGER NOT NULL CHECK(source_revision > 0), source_updated_at TEXT NOT NULL, operation_digest TEXT NOT NULL CHECK(length(operation_digest) = 64 AND operation_digest NOT GLOB '*[^0-9a-f]*'), state TEXT NOT NULL CHECK(state IN ('published', 'retracted')), remote_revision INTEGER NOT NULL CHECK(remote_revision > 0), synced_at TEXT NOT NULL, PRIMARY KEY(owner_id, queue_key));
    CREATE INDEX IF NOT EXISTS annotation_targets_v2_literature_idx ON annotation_targets_v2(literature_id, annotation_id);
    CREATE TABLE IF NOT EXISTS annotation_target_evidence_v2 (target_id TEXT NOT NULL, position INTEGER NOT NULL, literature_id TEXT NOT NULL, evidence_json TEXT NOT NULL, PRIMARY KEY(target_id, position));
    CREATE INDEX IF NOT EXISTS annotation_target_evidence_v2_literature_idx ON annotation_target_evidence_v2(literature_id, target_id);
    CREATE TABLE IF NOT EXISTS annotation_tags_v2 (annotation_id TEXT NOT NULL, tag_slug TEXT NOT NULL, tag_name TEXT NOT NULL, origin TEXT NOT NULL, state TEXT NOT NULL, confidence REAL, classifier_version TEXT, assigned_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(annotation_id, tag_slug, origin));
    CREATE TABLE IF NOT EXISTS annotation_tag_appeals_v2 (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, tag_slug TEXT NOT NULL, submitted_by TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_by TEXT, resolution_reason TEXT, resolved_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS annotation_tag_appeals_v2_one_pending_idx ON annotation_tag_appeals_v2(annotation_id, tag_slug) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS annotation_tag_appeal_audit_v2 (id TEXT PRIMARY KEY, appeal_id TEXT NOT NULL, annotation_id TEXT NOT NULL, tag_slug TEXT NOT NULL, decision TEXT NOT NULL, admin_user_id TEXT NOT NULL, reason TEXT NOT NULL, trace_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS annotation_signals_v2 (annotation_id TEXT NOT NULL, user_id TEXT NOT NULL, signal TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(annotation_id, user_id));
    CREATE TABLE IF NOT EXISTS annotation_ratings_v2 (annotation_id TEXT NOT NULL, user_id TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(annotation_id, user_id));
    CREATE TABLE IF NOT EXISTS annotation_replies_v2 (id TEXT PRIMARY KEY, parent_annotation_id TEXT NOT NULL, derived_annotation_id TEXT UNIQUE, body TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, author_initials TEXT NOT NULL, author_profile_snapshot_json TEXT NOT NULL, visibility TEXT NOT NULL, organization_id TEXT, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, parent_deleted_at TEXT, moderated_at TEXT, moderation_reason TEXT, moderated_by TEXT);
    CREATE INDEX IF NOT EXISTS annotation_replies_v2_parent_idx ON annotation_replies_v2(parent_annotation_id, created_at);
    CREATE TABLE IF NOT EXISTS annotation_versions_v2 (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(annotation_id, revision));
    CREATE TABLE IF NOT EXISTS annotation_reply_versions_v2 (id TEXT PRIMARY KEY, reply_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(reply_id, revision));
    CREATE TABLE IF NOT EXISTS annotation_saves_v2 (annotation_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(annotation_id, user_id));
    CREATE TABLE IF NOT EXISTS user_follows_v2 (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(follower_id, followed_id));
    CREATE TABLE IF NOT EXISTS direct_conversations_v2 (id TEXT PRIMARY KEY, first_user_id TEXT NOT NULL, second_user_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(first_user_id, second_user_id));
    CREATE TABLE IF NOT EXISTS direct_messages_v2 (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, message_kind TEXT NOT NULL, body TEXT NOT NULL, invitation_json TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS direct_messages_v2_conversation_idx ON direct_messages_v2(conversation_id, created_at, id);
    CREATE TABLE IF NOT EXISTS direct_conversation_reads_v2 (conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_message_id TEXT NOT NULL, last_read_at TEXT NOT NULL, PRIMARY KEY(conversation_id, user_id));
    CREATE TABLE IF NOT EXISTS annotation_moderation_audit_v2 (id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, linked_reply_id TEXT, action TEXT NOT NULL, reason TEXT NOT NULL, admin_user_id TEXT NOT NULL, trace_id TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const literatureColumns = new Set(db.prepare("PRAGMA table_info(literature_records_v2)").all().map((column) => column.name));
  if (!literatureColumns.has("record_source")) db.exec("ALTER TABLE literature_records_v2 ADD COLUMN record_source TEXT NOT NULL DEFAULT 'legacy_metadata'");
  if (!literatureColumns.has("source_provider")) db.exec("ALTER TABLE literature_records_v2 ADD COLUMN source_provider TEXT");
  if (!literatureColumns.has("confirmed_at")) db.exec("ALTER TABLE literature_records_v2 ADD COLUMN confirmed_at TEXT");
  if (!literatureColumns.has("revision")) db.exec("ALTER TABLE literature_records_v2 ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)");
  if (!literatureColumns.has("identity_status")) db.exec("ALTER TABLE literature_records_v2 ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'legacy_unverified'");
  db.exec("UPDATE literature_records_v2 SET identity_status = 'legacy_unverified'");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS literature_records_identity_status_insert_guard_v2
    BEFORE INSERT ON literature_records_v2
    WHEN NEW.identity_status NOT IN ('confirmed', 'legacy_unverified')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_status_invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_records_identity_status_update_guard_v2
    BEFORE UPDATE OF identity_status ON literature_records_v2
    WHEN NEW.identity_status NOT IN ('confirmed', 'legacy_unverified')
    BEGIN
      SELECT RAISE(ABORT, 'literature_identity_status_invalid');
    END;
  `);
  for (const identity of db.prepare("SELECT * FROM literature_identities_v2 ORDER BY literature_id, identity_kind, identity_value").all()) {
    const value = normalizeIdentity(identity.identity_kind, identity.identity_value);
    const prior = db.prepare("SELECT literature_id FROM literature_identifiers_v2 WHERE identifier_kind = ? AND normalized_value = ?").get(identity.identity_kind, value);
    if (prior && prior.literature_id !== identity.literature_id) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTIFIER_MIGRATION_CONFLICT");
    }
    db.prepare("INSERT OR IGNORE INTO literature_identifiers_v2(literature_id, identifier_kind, normalized_value, is_legacy_alias, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(identity.literature_id, identity.identity_kind, value, identity.identity_kind === "title_authors_year_hash" && !/^sha256:[a-f0-9]{64}$/.test(value) ? 1 : 0, identity.created_at);
  }
  db.exec(`
    UPDATE literature_records_v2
       SET identity_status = 'confirmed'
     WHERE record_source = 'public_registry'
       AND (
         (source_provider = 'crossref' AND EXISTS (
           SELECT 1 FROM literature_identifiers_v2 identifier
            WHERE identifier.literature_id = literature_records_v2.id AND identifier.identifier_kind = 'doi'
         ))
         OR (source_provider = 'arxiv' AND EXISTS (
           SELECT 1 FROM literature_identifiers_v2 identifier
            WHERE identifier.literature_id = literature_records_v2.id AND identifier.identifier_kind = 'arxiv_id'
         ))
         OR (source_provider IN ('openalex', 'semantic_scholar') AND (
           EXISTS (
             SELECT 1 FROM literature_identity_claims_v2 claim
              WHERE claim.literature_id = literature_records_v2.id
                AND claim.provider IN ('openalex', 'semantic_scholar')
                AND (
                  NULLIF(json_extract(claim.evidence_json, '$.candidateKey'), '') IS NOT NULL
                  OR json_extract(claim.evidence_json, '$.confirmationBasis') IN (
                    'user_selected_refetch',
                    'independent_aggregate_bibliography'
                  )
                )
           )
           OR 2 <= (
             SELECT count(DISTINCT claim.provider)
               FROM literature_identity_claims_v2 claim
              WHERE claim.literature_id = literature_records_v2.id
                AND claim.provider IN ('openalex', 'semantic_scholar')
           )
         ))
       )
  `);
  for (const row of db.prepare(`
    SELECT literature.*
      FROM literature_records_v2 literature
     WHERE literature.identity_status = 'confirmed'
       AND literature.source_provider IN ('crossref', 'arxiv', 'openalex', 'semantic_scholar')
  `).all()) {
    const observedAt = row.confirmed_at ?? row.updated_at;
    const preferredKind = {
      arxiv: "arxiv_id",
      crossref: "doi",
      openalex: "openalex_id",
      semantic_scholar: "semantic_scholar_id"
    }[row.source_provider];
    const identifier = db.prepare("SELECT normalized_value FROM literature_identifiers_v2 WHERE literature_id = ? AND identifier_kind = ? ORDER BY normalized_value LIMIT 1").get(row.id, preferredKind);
    if (!identifier) continue;
    db.prepare("INSERT OR IGNORE INTO literature_identity_claims_v2(id, literature_id, provider, provider_record_id, verification_status, evidence_json, observed_at, created_at) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)")
      .run(`literature_claim_${createHash("sha256").update(`${row.id}:${row.source_provider}:${identifier.normalized_value}`).digest("hex").slice(0, 32)}`, row.id, row.source_provider, identifier.normalized_value, JSON.stringify({ migration: "sqlite_source_confirmed_identity" }), observedAt, observedAt);
  }
  const targetColumns = new Set(db.prepare("PRAGMA table_info(annotation_targets_v2)").all().map((column) => column.name));
  if (!targetColumns.has("position")) {
    db.exec("ALTER TABLE annotation_targets_v2 ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      UPDATE annotation_targets_v2 AS target SET position = (
        SELECT count(*) - 1 FROM annotation_targets_v2 AS prior
         WHERE prior.annotation_id = target.annotation_id
           AND (prior.created_at < target.created_at OR (prior.created_at = target.created_at AND prior.id <= target.id))
      )
    `);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS annotation_targets_v2_position_idx ON annotation_targets_v2(annotation_id, position)");
  const appealColumns = new Set(db.prepare("PRAGMA table_info(annotation_tag_appeals_v2)").all().map((column) => column.name));
  if (!appealColumns.has("resolved_by")) db.exec("ALTER TABLE annotation_tag_appeals_v2 ADD COLUMN resolved_by TEXT");
  if (!appealColumns.has("resolution_reason")) db.exec("ALTER TABLE annotation_tag_appeals_v2 ADD COLUMN resolution_reason TEXT");
  const annotationColumns = new Set(db.prepare("PRAGMA table_info(annotations_v2)").all().map((column) => column.name));
  if (!annotationColumns.has("source_reply_id")) db.exec("ALTER TABLE annotations_v2 ADD COLUMN source_reply_id TEXT");
  const replyColumns = new Set(db.prepare("PRAGMA table_info(annotation_replies_v2)").all().map((column) => column.name));
  if (!replyColumns.has("moderated_at")) db.exec("ALTER TABLE annotation_replies_v2 ADD COLUMN moderated_at TEXT");
  if (!replyColumns.has("moderation_reason")) db.exec("ALTER TABLE annotation_replies_v2 ADD COLUMN moderation_reason TEXT");
  if (!replyColumns.has("moderated_by")) db.exec("ALTER TABLE annotation_replies_v2 ADD COLUMN moderated_by TEXT");
  const moderationAuditColumns = new Set(db.prepare("PRAGMA table_info(annotation_moderation_audit_v2)").all().map((column) => column.name));
  if (!moderationAuditColumns.has("linked_reply_id")) db.exec("ALTER TABLE annotation_moderation_audit_v2 ADD COLUMN linked_reply_id TEXT");
  const publicationColumns = new Set(db.prepare("PRAGMA table_info(desktop_annotation_publications_v2)").all().map((column) => column.name));
  if (!publicationColumns.has("operation_digest")) {
    db.exec(`ALTER TABLE desktop_annotation_publications_v2 ADD COLUMN operation_digest TEXT NOT NULL DEFAULT '${legacyPublicationDigest}' CHECK(length(operation_digest) = 64 AND operation_digest NOT GLOB '*[^0-9a-f]*')`);
  }
  for (const row of db.prepare("SELECT * FROM literature_records_v2").all()) {
    if (db.prepare("SELECT 1 FROM literature_record_versions_v2 WHERE literature_id = ? AND revision = ?").get(row.id, row.revision)) continue;
    const identifiers = row.identity_status === "confirmed"
      ? db.prepare("SELECT identifier_kind AS kind, 'public_registry' AS source, normalized_value AS value FROM literature_identifiers_v2 WHERE literature_id = ? ORDER BY identifier_kind, normalized_value").all(row.id)
      : db.prepare("SELECT identity_kind AS kind, identity_source AS source, identity_value AS value FROM literature_identities_v2 WHERE literature_id = ? ORDER BY identity_kind, identity_value").all(row.id);
    const snapshot = {
      authors: parseJson(row.authors_json, []),
      ...(row.document_type ? { documentType: row.document_type } : {}),
      identifiers,
      literatureId: row.id,
      ...(row.identity_status !== "confirmed"
        ? { recordSource: row.record_source, status: "legacy_unverified" }
        : { provenance: { confirmedAt: row.confirmed_at ?? row.updated_at, mode: "public_registry" }, revision: row.revision, status: "confirmed" }),
      title: row.title,
      ...(row.publication_year === null || row.publication_year === undefined ? {} : { year: row.publication_year })
    };
    db.prepare("INSERT INTO literature_record_versions_v2(id, literature_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(`literature_record_version_${row.id}`, row.id, row.revision, JSON.stringify(snapshot), "migration_011", row.updated_at);
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS literature_identities_read_only_insert_v2
    BEFORE INSERT ON literature_identities_v2 BEGIN
      SELECT RAISE(ABORT, 'legacy_literature_identity_is_read_only');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_read_only_update_v2
    BEFORE UPDATE ON literature_identities_v2 BEGIN
      SELECT RAISE(ABORT, 'legacy_literature_identity_is_read_only');
    END;
    CREATE TRIGGER IF NOT EXISTS literature_identities_read_only_delete_v2
    BEFORE DELETE ON literature_identities_v2 BEGIN
      SELECT RAISE(ABORT, 'legacy_literature_identity_is_read_only');
    END;
  `);
}

export class SqliteAnnotationCommunityRepository {
  constructor(db, { authorizeOrganizationAccess, authorizeOrganizationInvitation, authorizeOrganizationVisibility, listOrganizations } = {}) {
    this.db = db;
    this.authorizeOrganizationAccess = authorizeOrganizationAccess;
    this.authorizeOrganizationInvitation = authorizeOrganizationInvitation;
    this.authorizeOrganizationVisibility = authorizeOrganizationVisibility;
    this.listOrganizations = listOrganizations;
    initializeAnnotationCommunitySqlite(db);
  }

  profile(userId) {
    const row = this.db.prepare("SELECT * FROM community_user_profiles_v2 WHERE user_id = ?").get(userId);
    const institutions = this.db.prepare("SELECT institution_name AS name FROM community_profile_institutions_v2 WHERE user_id = ? ORDER BY position").all(userId);
    return {
      educationStage: row?.education_stage ?? null,
      institutions,
      revision: row?.revision ?? 0
    };
  }

  async findLiteratureByIdentifiers(identifiers) {
    const literatureIds = this.#matchingLiteratureIds(identifiers);
    if (literatureIds.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
    const id = [...literatureIds][0];
    return id ? this.#literatureRecord(id) : null;
  }

  async findLiteratureById(literatureId) {
    const id = String(literatureId ?? "").trim();
    return id ? this.#literatureRecord(id) : null;
  }

  async searchStoredLiterature(query, limit = 10) {
    const bounded = Math.max(1, Math.min(Number(limit) || 10, 10));
    const value = String(query ?? "").trim();
    if (!value) return [];
    const pattern = `%${value}%`;
    const rows = this.db.prepare(`
      SELECT DISTINCT literature.id
        FROM literature_records_v2 literature
        LEFT JOIN literature_identifiers_v2 identifier ON identifier.literature_id = literature.id
       WHERE literature.identity_status = 'confirmed'
         AND (literature.title LIKE ? OR literature.authors_json LIKE ? OR identifier.normalized_value LIKE ?)
       ORDER BY literature.id
       LIMIT ?
    `).all(pattern, pattern, pattern, bounded);
    return rows.map((row) => this.#literatureRecord(row.id)).filter(Boolean);
  }

  async confirmRefetchedLiterature(owner, verifiedCandidate) {
    const provider = verifiedCandidate?.provider;
    const record = verifiedCandidate?.record;
    if (!new Set(["crossref", "arxiv", "openalex", "semantic_scholar"]).has(provider) ||
      !verifiedCandidate?.candidateKey || !record || !Array.isArray(record.identifiers)) {
      throw new AnnotationCommunityError("LITERATURE_CANDIDATE_NOT_FOUND", 404);
    }
    const primary = record.identifiers[0];
    if (!primary || primary.source !== "public_registry") {
      throw new AnnotationCommunityError("LITERATURE_CANDIDATE_NOT_FOUND", 404);
    }
    const expectedKey = `${provider}:${primary.kind}:${normalizeIdentity(primary.kind, primary.value)}`;
    if (verifiedCandidate.candidateKey !== expectedKey) throw new AnnotationCommunityError("LITERATURE_CANDIDATE_NOT_FOUND", 404);
    return this.#confirmLiterature(owner, verifiedCandidate);
  }

  async #confirmLiterature(owner, verifiedCandidate) {
    const { provider, record } = verifiedCandidate;
    const ownerId = typeof owner === "string" ? owner : owner?.id;
    if (!ownerId) throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_OWNER_REQUIRED");
    if (!record || !Array.isArray(record.identifiers)) throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_INVALID");
    if (record.identifiers.some((identifier) => identifier.source !== "public_registry")) {
      throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_INVALID");
    }
    if (hasCrossVersionIdentifierConflict(record)) {
      throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
    }
    const input = {
      authors: [...(record.authors ?? [])],
      documentType: record.documentType,
      identifiers: record.identifiers.map((identifier) => ({ ...identifier })),
      title: record.title,
      year: record.year
    };
    if (input.identifiers.length === 0 || input.identifiers.every((identifier) => identifier.kind === "title_authors_year_hash")) {
      throw new AnnotationCommunityError("LITERATURE_IDENTITY_REQUIRED");
    }
    const normalized = [...new Map(input.identifiers.map((identifier) => {
      const value = normalizeIdentity(identifier.kind, identifier.value);
      return [`${identifier.kind}:${value}`, { ...identifier, value }];
    })).values()];
    return this.db.transaction(() => {
      const providerRecordId = normalizeIdentity(record.identifiers[0].kind, record.identifiers[0].value);
      const identityMatches = this.#matchingLiteratureIds(normalized);
      const existingClaim = this.db.prepare("SELECT literature_id FROM literature_identity_claims_v2 WHERE provider = ? AND provider_record_id = ?").get(provider, providerRecordId);
      const matched = new Set(identityMatches);
      if (existingClaim) matched.add(existingClaim.literature_id);
      const aggregateBibliographyMatches = this.#independentAggregateBibliographyMatches(input, provider);
      for (const literatureId of aggregateBibliographyMatches) {
        matched.add(literatureId);
      }
      if (matched.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      const now = new Date().toISOString();
      const literatureId = [...matched][0] ?? `literature_${randomUUID()}`;
      const existing = matched.size ? this.db.prepare("SELECT * FROM literature_records_v2 WHERE id = ?").get(literatureId) : null;
      if (existing && !sameLiteratureBibliography(input, {
        authors: parseJson(existing.authors_json, []),
        title: existing.title,
        year: existing.publication_year
      })) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      if (!existing) {
        this.db.prepare(`INSERT INTO literature_records_v2(id, title, authors_json, publication_year, document_type, record_source, source_provider, confirmed_at, revision, identity_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'public_registry', ?, ?, 1, 'confirmed', ?, ?)`)
          .run(literatureId, input.title, JSON.stringify(input.authors), input.year ?? null, input.documentType ?? null, provider, now, now, now);
      } else {
        const existingIdentifiers = this.db.prepare("SELECT identifier_kind, normalized_value FROM literature_identifiers_v2 WHERE literature_id = ?").all(literatureId);
        const existingKeys = new Set(existingIdentifiers.map((identifier) => `${identifier.identifier_kind}:${identifier.normalized_value}`));
        const newAlias = normalized.some((identifier) => !existingKeys.has(`${identifier.kind}:${identifier.value}`));
        const newClaim = !existingClaim;
        const changed = existing.title !== input.title || existing.authors_json !== JSON.stringify(input.authors) || existing.publication_year !== (input.year ?? null) || existing.document_type !== (input.documentType ?? null) || existing.identity_status !== "confirmed" || existing.source_provider !== provider || newAlias || newClaim;
        if (changed) {
          const current = this.#literatureSnapshot(literatureId);
          const revision = Number(existing.revision ?? 1);
          this.db.prepare("INSERT OR IGNORE INTO literature_record_versions_v2(id, literature_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(`literature_record_version_${randomUUID()}`, literatureId, revision, JSON.stringify(current), literatureResolverActor, now);
          this.db.prepare(`UPDATE literature_records_v2 SET title = ?, authors_json = ?, publication_year = ?, document_type = ?, record_source = 'public_registry', source_provider = ?, confirmed_at = ?, revision = ?, identity_status = 'confirmed', updated_at = ? WHERE id = ?`)
            .run(input.title, JSON.stringify(input.authors), input.year ?? null, input.documentType ?? null, provider, now, revision + 1, now, literatureId);
        }
      }
      for (const identifier of normalized) {
        this.db.prepare("INSERT OR IGNORE INTO literature_identifiers_v2(literature_id, identifier_kind, normalized_value, is_legacy_alias, created_at) VALUES (?, ?, ?, 0, ?)")
          .run(literatureId, identifier.kind, identifier.value, now);
      }
      this.db.prepare(`INSERT INTO literature_identity_claims_v2(id, literature_id, provider, provider_record_id, verification_status, evidence_json, observed_at, created_at)
        VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)
        ON CONFLICT(provider, provider_record_id) DO UPDATE SET
          verification_status = excluded.verification_status,
          evidence_json = excluded.evidence_json,
          observed_at = excluded.observed_at
        WHERE literature_identity_claims_v2.literature_id = excluded.literature_id`)
        .run(`literature_claim_${randomUUID()}`, literatureId, provider, providerRecordId, JSON.stringify({
          candidateKey: verifiedCandidate.candidateKey,
          confirmationBasis: aggregateBibliographyMatches.size > 0
            ? "independent_aggregate_bibliography"
            : aggregateLiteratureProviders.has(provider)
              ? "user_selected_refetch"
              : "primary_registry_refetch",
          ...(verifiedCandidate.recordUrl ? { recordUrl: verifiedCandidate.recordUrl } : {}),
          sourceTier: new Set(["crossref", "arxiv"]).has(provider) ? "primary" : "aggregate"
        }), now, now);
      if (!existing) {
        const snapshot = JSON.stringify(this.#literatureRecord(literatureId));
        this.db.prepare("INSERT INTO literature_record_versions_v2(id, literature_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, 1, ?, ?, ?)")
          .run(`literature_record_version_${randomUUID()}`, literatureId, snapshot, literatureResolverActor, now);
      }
      return this.#literatureRecord(literatureId);
    })();
  }

  async verifyLiteratureProjection(literatureId, revision) {
    const record = this.#literatureRecord(String(literatureId ?? "").trim());
    return record && record.revision === revision ? record : null;
  }

  async confirmLiteratureRelation(input) {
    const from = this.#literatureRecord(input?.fromLiteratureId);
    const to = this.#literatureRecord(input?.toLiteratureId);
    if (!from || !to || from.literatureId === to.literatureId) throw new AnnotationCommunityError("LITERATURE_RELATION_INVALID");
    if (!input?.evidence || typeof input.evidence !== "object" || Array.isArray(input.evidence) ||
      Object.keys(input.evidence).length === 0) {
      throw new AnnotationCommunityError("LITERATURE_RELATION_EVIDENCE_REQUIRED");
    }
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO literature_relations_v2(id, from_literature_id, to_literature_id, relation_type, provider, verification_status, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)")
      .run(`literature_relation_${randomUUID()}`, from.literatureId, to.literatureId, input.relationType, input.provider, JSON.stringify(input.evidence), now);
    return this.db.prepare("SELECT * FROM literature_relations_v2 WHERE from_literature_id = ? AND to_literature_id = ? AND relation_type = ?").get(from.literatureId, to.literatureId, input.relationType);
  }

  async findLiteratureRelations(literatureId) {
    return this.db.prepare("SELECT * FROM literature_relations_v2 WHERE from_literature_id = ? OR to_literature_id = ? ORDER BY created_at, id").all(literatureId, literatureId).map((row) => ({
      createdAt: row.created_at,
      evidence: parseJson(row.evidence_json, {}),
      fromLiteratureId: row.from_literature_id,
      provider: row.provider,
      relationType: row.relation_type,
      toLiteratureId: row.to_literature_id,
      verificationStatus: row.verification_status
    }));
  }

  updateProfile(userId, input) {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT revision FROM community_user_profiles_v2 WHERE user_id = ?").get(userId);
      this.db.prepare(`
        INSERT INTO community_user_profiles_v2(user_id, education_stage, revision, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET education_stage = excluded.education_stage, revision = community_user_profiles_v2.revision + 1, updated_at = excluded.updated_at
      `).run(userId, input.educationStage, now, now);
      this.db.prepare("DELETE FROM community_profile_institutions_v2 WHERE user_id = ?").run(userId);
      const insert = this.db.prepare("INSERT INTO community_profile_institutions_v2(user_id, institution_name, institution_type, position) VALUES (?, ?, '', ?)");
      input.institutions.forEach((institution, index) => insert.run(userId, institution.name, index));
      return { ...this.profile(userId), revision: (current?.revision ?? 0) + 1 };
    })();
  }

  createHandoff(ownerId, input) {
    const id = `handoff_${randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    this.db.prepare("INSERT INTO desktop_annotation_handoffs_v2(id, owner_id, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, ownerId, JSON.stringify(input), now.toISOString(), expiresAt.toISOString());
    return { expiresAt: expiresAt.toISOString(), handoffId: id };
  }

  consumeHandoff(id, ownerId) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM desktop_annotation_handoffs_v2 WHERE id = ?").get(id);
      if (!row) throw new AnnotationCommunityError("HANDOFF_NOT_FOUND", 404);
      if (row.owner_id !== ownerId) throw new AnnotationCommunityError("HANDOFF_FORBIDDEN", 403);
      if (Date.parse(row.expires_at) <= Date.now()) throw new AnnotationCommunityError("HANDOFF_EXPIRED", 410);
      const replayed = Boolean(row.consumed_at);
      if (!replayed) this.db.prepare("UPDATE desktop_annotation_handoffs_v2 SET consumed_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      return { draft: parseJson(row.payload_json, {}), replayed };
    })();
  }

  syncDesktopAnnotations(author, items) {
    const syncedAt = new Date().toISOString();
    return this.db.transaction(() => items.map((item) => {
      const prior = this.db.prepare("SELECT * FROM desktop_annotation_syncs_v2 WHERE owner_id = ? AND queue_key = ?").get(author.id, item.queueKey);
      const id = prior?.annotation_id ?? `annotation_${randomUUID()}`;
      if (!prior) {
        this.db.prepare(`INSERT INTO annotations_v2(id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, 1, 1, ?, ?)`)
          .run(id, item.body, author.id, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), item.createdAt, item.updatedAt);
        this.#replaceTargets(id, item.targets, syncedAt, author.id);
        this.#assignPlatformTags(id, item.body, [], syncedAt);
        this.db.prepare("INSERT INTO desktop_annotation_syncs_v2(owner_id, queue_key, source_annotation_id, annotation_id, source_created_at, source_updated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(author.id, item.queueKey, item.annotationId, id, item.createdAt, item.updatedAt, syncedAt);
      } else if (Date.parse(item.updatedAt) >= Date.parse(prior.source_updated_at)) {
        this.db.prepare("UPDATE annotations_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
          .run(item.body, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), item.updatedAt, id);
        this.#replaceTargets(id, item.targets, syncedAt, author.id);
        this.#assignPlatformTags(id, item.body, [], syncedAt);
        this.db.prepare("UPDATE desktop_annotation_syncs_v2 SET source_annotation_id = ?, source_updated_at = ?, updated_at = ? WHERE owner_id = ? AND queue_key = ?")
          .run(item.annotationId, item.updatedAt, syncedAt, author.id, item.queueKey);
      }
      return { annotationId: item.annotationId, intuechoAnnotationId: id, queueKey: item.queueKey, status: "synced", syncedAt };
    }))();
  }

  applyDesktopAnnotationPublications(author, operations) {
    return this.db.transaction(() => operations.map((operation) => {
      const operationDigest = desktopAnnotationPublicationDigest(operation);
      const prior = this.db.prepare("SELECT * FROM desktop_annotation_publications_v2 WHERE owner_id = ? AND queue_key = ?").get(author.id, operation.queueKey);
      if (prior?.source_annotation_id !== undefined && prior.source_annotation_id !== operation.annotationId) {
        return this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_QUEUE_CONFLICT");
      }
      if (prior && this.#publicationIsStale(prior, operation)) {
        return this.#publicationFailure(operation, "STALE_ANNOTATION_PUBLICATION");
      }
      if (prior && Number(prior.source_revision) === operation.revision && Date.parse(prior.source_updated_at) === Date.parse(operation.updatedAt)) {
        if (prior.operation_digest !== operationDigest) {
          return this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
        }
        return this.#publicationResult(operation, prior);
      }
      if (operation.operation === "retract") return this.#retractDesktopPublication(author, operation, operationDigest, prior);
      return this.#upsertDesktopPublication(author, operation, operationDigest, prior);
    }))();
  }

  #publicationFailure(operation, error) {
    return { annotationId: operation.annotationId, error, queueKey: operation.queueKey };
  }

  #publicationIsStale(prior, operation) {
    if (operation.revision < Number(prior.source_revision)) return true;
    if (operation.revision === Number(prior.source_revision)) return Date.parse(prior.source_updated_at) !== Date.parse(operation.updatedAt);
    return Date.parse(operation.updatedAt) < Date.parse(prior.source_updated_at);
  }

  #publicationResult(operation, row) {
    return {
      annotationId: operation.annotationId,
      queueKey: operation.queueKey,
      remoteAnnotationId: row.annotation_id,
      remoteRevision: Number(row.remote_revision),
      state: row.state,
      syncedAt: row.synced_at
    };
  }

  #publicationTarget(literatureId, sourcePassage) {
    return {
      anchorHash: sourcePassage.anchorHash,
      excerpt: sourcePassage.excerpt,
      kind: "source_passage",
      literature: { literatureId },
      ...(sourcePassage.page ? { page: sourcePassage.page } : {}),
      rects: sourcePassage.rects ?? []
    };
  }

  #upsertDesktopPublication(author, operation, operationDigest, prior) {
    const confirmed = this.#literatureRecord(operation.literatureId);
    if (!confirmed) return this.#publicationFailure(operation, "LITERATURE_NOT_FOUND");
    const now = new Date().toISOString();
    const id = prior?.annotation_id ?? `annotation_${randomUUID()}`;
    let remoteRevision = 1;
    if (!prior) {
      this.db.prepare(`INSERT INTO annotations_v2(id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'public', NULL, 1, 1, ?, ?)`)
        .run(id, operation.body, author.id, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), operation.updatedAt, operation.updatedAt);
    } else {
      const annotation = this.db.prepare("SELECT revision FROM annotations_v2 WHERE id = ? AND author_id = ?").get(id, author.id);
      if (!annotation) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_NOT_FOUND");
      remoteRevision = Number(annotation.revision) + 1;
      this.db.prepare("UPDATE annotations_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, visibility = 'public', organization_id = NULL, share_to_plaza = 1, revision = ?, updated_at = ? WHERE id = ?")
        .run(operation.body, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), remoteRevision, operation.updatedAt, id);
    }
    this.#replaceTargets(id, [this.#publicationTarget(confirmed.literatureId, operation.sourcePassage)], now, author.id);
    this.#assignPlatformTags(id, operation.body, [], now);
    if (!prior) {
      this.db.prepare("INSERT INTO desktop_annotation_publications_v2(owner_id, queue_key, source_annotation_id, annotation_id, source_revision, source_updated_at, operation_digest, state, remote_revision, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)")
        .run(author.id, operation.queueKey, operation.annotationId, id, operation.revision, operation.updatedAt, operationDigest, remoteRevision, now);
    } else {
      this.db.prepare("UPDATE desktop_annotation_publications_v2 SET source_revision = ?, source_updated_at = ?, operation_digest = ?, state = 'published', remote_revision = ?, synced_at = ? WHERE owner_id = ? AND queue_key = ?")
        .run(operation.revision, operation.updatedAt, operationDigest, remoteRevision, now, author.id, operation.queueKey);
    }
    return this.#publicationResult(operation, { annotation_id: id, remote_revision: remoteRevision, state: "published", synced_at: now });
  }

  #retractDesktopPublication(author, operation, operationDigest, prior) {
    if (!prior) return this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_NOT_FOUND");
    if (prior.annotation_id !== operation.remoteAnnotationId) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_MISMATCH");
    const annotation = this.db.prepare("SELECT revision FROM annotations_v2 WHERE id = ? AND author_id = ?").get(prior.annotation_id, author.id);
    if (!annotation) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_NOT_FOUND");
    const now = new Date().toISOString();
    const remoteRevision = Number(annotation.revision) + 1;
    this.db.prepare("UPDATE annotations_v2 SET visibility = 'private', organization_id = NULL, share_to_plaza = 0, revision = ?, updated_at = ? WHERE id = ?")
      .run(remoteRevision, operation.updatedAt, prior.annotation_id);
    this.db.prepare("UPDATE desktop_annotation_publications_v2 SET source_revision = ?, source_updated_at = ?, operation_digest = ?, state = 'retracted', remote_revision = ?, synced_at = ? WHERE owner_id = ? AND queue_key = ?")
      .run(operation.revision, operation.updatedAt, operationDigest, remoteRevision, now, author.id, operation.queueKey);
    return this.#publicationResult(operation, { annotation_id: prior.annotation_id, remote_revision: remoteRevision, state: "retracted", synced_at: now });
  }

  async communityRecommendations(scope, viewer = null) {
    const annotations = await this.plaza(viewer, {
      limit: 20,
      literatureId: scope.literatureId,
      sort: "recommended"
    });
    const viewerProfile = viewer?.id ? this.profile(viewer.id) : null;
    return annotations.map((annotation) => ({ annotation, compatibility: this.#recommendationCompatibility(annotation, scope, viewer, viewerProfile) }))
      .sort((left, right) => right.compatibility - left.compatibility || String(right.annotation.createdAt).localeCompare(String(left.annotation.createdAt)))
      .map(({ annotation, compatibility }) => ({
      compatibility,
      id: annotation.id,
      note: annotation.body,
      literatureId: scope.literatureId,
      relationship: annotation.targets.some((target) => target.kind === "source_passage" || target.kind === "derived_passage") ? "同一文献字句的共享批注" : "同一文献的共享批注",
      source: "intuecho_community"
    }));
  }

  #recommendationCompatibility(annotation, scope, viewer, viewerProfile) {
    const passageTargets = annotation.targets.filter((target) => target.kind !== "whole_document");
    const evidenceIds = new Set([...(scope.evidenceIds ?? []), ...(scope.externalSourceIds ?? [])]);
    const passageMatch = evidenceIds.size > 0 && passageTargets.some((target) => {
      const hashes = [target.anchorHash, ...(target.evidence ?? []).map((item) => item.anchorHash)].filter(Boolean);
      return hashes.some((hash) => [...evidenceIds].some((id) => hash === id || hash.endsWith(`:${id}`)));
    });
    const sameStage = Boolean(viewerProfile?.educationStage && viewerProfile.educationStage === annotation.author.profile.educationStage);
    const viewerInstitutions = new Set(viewerProfile?.institutions.map((item) => item.name) ?? []);
    const sameInstitution = annotation.author.profile.institutions.some((item) => viewerInstitutions.has(item.name));
    const mutual = viewer?.id ? this.#mutual(viewer.id, annotation.author.id) : false;
    const ratingConfidence = annotation.ratingCount ? (annotation.ratingAverage / 5) * Math.min(1, Math.log2(annotation.ratingCount + 1) / 3) : 0;
    const score = 0.45 + (passageTargets.length ? 0.08 : 0) + (passageMatch ? 0.17 : 0) + ratingConfidence * 0.15 + (sameStage ? 0.04 : 0) + (sameInstitution ? 0.04 : 0) + (mutual ? 0.07 : 0);
    return Number(Math.min(1, score).toFixed(4));
  }

  #profileSnapshot(userId) {
    const profile = this.profile(userId);
    return { educationStage: profile.educationStage, institutions: profile.institutions };
  }

  #literatureRecord(id) {
    const row = this.db.prepare("SELECT * FROM literature_records_v2 WHERE id = ?").get(id);
    if (!row || row.identity_status !== "confirmed") return null;
    return this.#literatureSnapshot(id, row);
  }

  #literatureSnapshot(id, providedRow = null) {
    const row = providedRow ?? this.db.prepare("SELECT * FROM literature_records_v2 WHERE id = ?").get(id);
    if (!row) return null;
    const identifiers = row.identity_status === "confirmed"
      ? this.db.prepare("SELECT identifier_kind AS kind, 'public_registry' AS source, normalized_value AS value FROM literature_identifiers_v2 WHERE literature_id = ? ORDER BY identifier_kind, normalized_value").all(id)
      : this.db.prepare("SELECT identity_kind AS kind, identity_source AS source, identity_value AS value FROM literature_identities_v2 WHERE literature_id = ? ORDER BY identity_kind, identity_value").all(id);
    if (row.identity_status !== "confirmed") {
      return {
        authors: parseJson(row.authors_json, []),
        ...(row.document_type ? { documentType: row.document_type } : {}),
        identifiers,
        literatureId: row.id,
        recordSource: row.record_source,
        status: "legacy_unverified",
        title: row.title,
        ...(row.publication_year === null || row.publication_year === undefined ? {} : { year: row.publication_year })
      };
    }
    return {
      authors: parseJson(row.authors_json, []),
      ...(row.document_type ? { documentType: row.document_type } : {}),
      identifiers,
      literatureId: row.id,
      provenance: {
        confirmedAt: row.confirmed_at ?? row.updated_at,
        mode: "public_registry",
        ...(row.source_provider ? { provider: row.source_provider } : {})
      },
      revision: Number(row.revision),
      status: "confirmed",
      title: row.title,
      ...(row.publication_year === null || row.publication_year === undefined ? {} : { year: row.publication_year })
    };
  }

  #matchingLiteratureIds(identifiers) {
    const keys = new Set((identifiers ?? []).map((identifier) => `${identifier.kind}:${normalizeIdentity(identifier.kind, identifier.value)}`));
    const literatureIds = new Set();
    for (const row of this.db.prepare("SELECT literature_id, identifier_kind, normalized_value FROM literature_identifiers_v2").all()) {
      if (keys.has(`${row.identifier_kind}:${normalizeIdentity(row.identifier_kind, row.normalized_value)}`)) literatureIds.add(row.literature_id);
    }
    if (literatureIds.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
    return literatureIds;
  }

  #independentAggregateBibliographyMatches(input, provider) {
    if (!aggregateLiteratureProviders.has(provider) || !Number.isInteger(input.year)) return new Set();
    const rows = this.db.prepare(`
      SELECT DISTINCT claim.literature_id
        FROM literature_identity_claims_v2 claim
        JOIN literature_records_v2 literature ON literature.id = claim.literature_id
       WHERE claim.provider IN ('openalex', 'semantic_scholar')
         AND claim.provider <> ?
         AND literature.identity_status = 'confirmed'
         AND literature.publication_year = ?
       ORDER BY claim.literature_id
    `).all(provider, input.year);
    return new Set(rows
      .map((row) => this.#literatureRecord(row.literature_id))
      .filter((record) => record && sameLiteratureVersionBibliography(input, record))
      .map((record) => record.literatureId));
  }

  #resolveLiterature(reference, now, changedBy) {
    if (reference?.literatureId) {
      if (!this.db.prepare("SELECT 1 FROM literature_records_v2 WHERE id = ? AND identity_status = 'confirmed'").get(reference.literatureId)) {
        throw new AnnotationCommunityError("LITERATURE_NOT_FOUND", 404);
      }
      return reference.literatureId;
    }
    throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_REQUIRED", 409);
  }

  #replaceTargets(annotationId, targets, now, changedBy) {
    this.db.prepare("DELETE FROM annotation_target_evidence_v2 WHERE target_id IN (SELECT id FROM annotation_targets_v2 WHERE annotation_id = ?)").run(annotationId);
    this.db.prepare("DELETE FROM annotation_targets_v2 WHERE annotation_id = ?").run(annotationId);
    const insertTarget = this.db.prepare("INSERT INTO annotation_targets_v2(id, annotation_id, literature_id, target_kind, position, target_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insertEvidence = this.db.prepare("INSERT INTO annotation_target_evidence_v2(target_id, position, literature_id, evidence_json) VALUES (?, ?, ?, ?)");
    for (const [targetPosition, target] of targets.entries()) {
      const targetId = `target_${randomUUID()}`;
      const literatureId = this.#resolveLiterature(target.literature, now, changedBy);
      insertTarget.run(targetId, annotationId, literatureId, target.kind, targetPosition, JSON.stringify(target), now);
      for (const [position, evidence] of (target.kind === "derived_passage" ? target.evidence : []).entries()) {
        insertEvidence.run(targetId, position, this.#resolveLiterature(evidence.literature, now, changedBy), JSON.stringify(evidence));
      }
    }
  }

  #replaceUserTags(annotationId, tags, now) {
    this.db.prepare("DELETE FROM annotation_tags_v2 WHERE annotation_id = ? AND origin = 'user'").run(annotationId);
    const insert = this.db.prepare("INSERT INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, assigned_at, updated_at) VALUES (?, ?, ?, 'user', 'active', ?, ?)");
    for (const tag of uniqueTags(tags)) insert.run(annotationId, tagSlug(tag), tag, now, now);
  }

  #assignPlatformTags(annotationId, body, userTags, now) {
    this.db.prepare("DELETE FROM annotation_tags_v2 WHERE annotation_id = ? AND origin = 'platform' AND state = 'active'").run(annotationId);
    const excluded = new Set(uniqueTags(userTags).map(tagSlug));
    const examples = this.db.prepare(`
      SELECT assigned.tag_slug, assigned.tag_name, annotations.body
        FROM annotation_tags_v2 assigned
        JOIN annotations_v2 annotations ON annotations.id = assigned.annotation_id
       WHERE assigned.origin = 'user' AND assigned.state = 'active'
         AND assigned.annotation_id <> ? AND annotations.withdrawn_at IS NULL
       ORDER BY annotations.updated_at DESC LIMIT 2000
    `).all(annotationId);
    const best = new Map();
    for (const example of examples) {
      if (excluded.has(example.tag_slug)) continue;
      const score = localSemanticSimilarity(body, `${example.tag_name} ${example.body}`);
      const current = best.get(example.tag_slug);
      if (!current || score > current.score) best.set(example.tag_slug, { name: example.tag_name, score });
    }
    const insert = this.db.prepare(`INSERT OR IGNORE INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, confidence, classifier_version, assigned_at, updated_at) VALUES (?, ?, ?, 'platform', 'active', ?, 'local-semantic-v1', ?, ?)`);
    for (const [slug, candidate] of best) if (candidate.score >= 0.48) insert.run(annotationId, slug, candidate.name, candidate.score, now, now);
  }

  #annotationRow(id) {
    return this.db.prepare("SELECT * FROM annotations_v2 WHERE id = ?").get(id);
  }

  #mutual(first, second) {
    if (!first || !second) return false;
    return Boolean(this.db.prepare(`
      SELECT 1 WHERE EXISTS(SELECT 1 FROM user_follows_v2 WHERE follower_id = ? AND followed_id = ?)
        AND EXISTS(SELECT 1 FROM user_follows_v2 WHERE follower_id = ? AND followed_id = ?)
    `).get(first, second, second, first));
  }

  async #organizationVisible(input) {
    if (!this.authorizeOrganizationVisibility) return false;
    try {
      return Boolean(await this.authorizeOrganizationVisibility(input));
    } catch {
      throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
    }
  }

  async #organizationAccess(input) {
    if (this.authorizeOrganizationAccess) {
      try {
        const result = await this.authorizeOrganizationAccess(input);
        return { allowed: result?.allowed === true, role: result?.role ?? null };
      } catch {
        throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
      }
    }
    return { allowed: await this.#organizationVisible(input), role: null };
  }

  async #organizationInvitation(input) {
    if (!this.authorizeOrganizationInvitation) {
      throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
    }
    try {
      return await this.authorizeOrganizationInvitation(input);
    } catch {
      throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
    }
  }

  async #canView(row, viewer) {
    const rootAudience = this.#rootAudience(row);
    if (!rootAudience) return false;
    if (row.author_id === viewer?.id || rootAudience.author_id === viewer?.id) return true;
    if (row.visibility === "public") return true;
    if (row.visibility === "mutual_followers") {
      return this.#mutual(rootAudience.author_id, viewer?.id);
    }
    if (row.visibility === "organization") {
      if (!viewer?.id) return false;
      return this.#organizationVisible({ organizationId: row.organization_id, userId: viewer.id });
    }
    return false;
  }

  #rootAudience(row) {
    const seen = new Set();
    let current = row;
    while (current) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      let parentId = current.parent_annotation_id;
      if (current.source_reply_id) {
        const reply = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(current.source_reply_id);
        if (
          !reply ||
          reply.derived_annotation_id !== current.id ||
          reply.visibility !== current.visibility ||
          reply.organization_id !== current.organization_id
        ) {
          return null;
        }
        parentId = reply.parent_annotation_id;
      }
      if (!parentId) return current;
      const parent = this.#annotationRow(parentId);
      if (
        !parent ||
        parent.visibility !== current.visibility ||
        parent.organization_id !== current.organization_id
      ) {
        return null;
      }
      current = parent;
    }
    return null;
  }

  #sameAudienceState(first, second) {
    return Boolean(
      first &&
      second &&
      first.id === second.id &&
      first.author_id === second.author_id &&
      first.source_reply_id === second.source_reply_id &&
      first.visibility === second.visibility &&
      first.organization_id === second.organization_id &&
      Boolean(first.withdrawn_at) === Boolean(second.withdrawn_at)
    );
  }

  async createAnnotation(author, input) {
    const now = new Date().toISOString();
    if (input.visibility === "organization") {
      if (!await this.#organizationVisible({ organizationId: input.organizationId, userId: author.id })) {
        throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
      }
    }
    const id = `annotation_${randomUUID()}`;
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO annotations_v2(id, parent_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.body, author.id, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), input.visibility, input.organizationId ?? null, input.shareToPlaza ? 1 : 0, now, now);
      this.#replaceTargets(id, input.targets, now, author.id);
      this.#replaceUserTags(id, input.tags, now);
      this.#assignPlatformTags(id, input.body, input.tags, now);
    })();
    return this.annotation(id, author);
  }

  async updateAnnotation(id, author, update) {
    const authorizedRow = this.#annotationRow(id);
    if (!authorizedRow || authorizedRow.withdrawn_at) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    if (authorizedRow.author_id !== author.id) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
    if (authorizedRow.source_reply_id && update.body !== undefined) throw new AnnotationCommunityError("DERIVED_BODY_READ_ONLY");
    if (authorizedRow.source_reply_id && (update.visibility !== undefined || update.organizationId !== undefined || update.shareToPlaza !== undefined)) {
      throw new AnnotationCommunityError("REPLY_VISIBILITY_MISMATCH");
    }
    const visibility = update.visibility ?? authorizedRow.visibility;
    const organizationId = update.organizationId === undefined ? authorizedRow.organization_id : update.organizationId;
    const shareToPlaza = update.shareToPlaza ?? Boolean(authorizedRow.share_to_plaza);
      const targets = update.targets ?? this.#targets(id, false);
    if (targets.length === 0) throw new AnnotationCommunityError("ANNOTATION_TARGET_REQUIRED");
    if (shareToPlaza && visibility !== "public") throw new AnnotationCommunityError("PLAZA_REQUIRES_PUBLIC_VISIBILITY");
    if ((visibility === "organization") !== Boolean(organizationId)) throw new AnnotationCommunityError("INVALID_ANNOTATION_VISIBILITY");
    if (visibility === "organization" && !await this.#organizationVisible({ organizationId, userId: author.id })) {
      throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
    }
    const row = this.#annotationRow(id);
    if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || row.revision !== authorizedRow.revision) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    const scopeChanged = visibility !== row.visibility || organizationId !== row.organization_id;
    if (scopeChanged && this.db.prepare("SELECT 1 FROM annotation_replies_v2 WHERE parent_annotation_id = ? LIMIT 1").get(id)) {
      throw new AnnotationCommunityError("ANNOTATION_SCOPE_LOCKED_BY_REPLIES", 409);
    }
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO annotation_versions_v2(id, annotation_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`annotation_version_${randomUUID()}`, id, row.revision, JSON.stringify(this.#serialize(row, author, false)), author.id, now);
      this.db.prepare(`UPDATE annotations_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, visibility = ?, organization_id = ?, share_to_plaza = ?, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(update.body ?? row.body, author.name, author.initials ?? initialsFor(author.name), JSON.stringify(this.#profileSnapshot(author.id)), visibility, organizationId, shareToPlaza ? 1 : 0, now, id);
      if (update.targets) this.#replaceTargets(id, update.targets, now, author.id);
      if (update.tags) this.#replaceUserTags(id, update.tags, now);
      this.#assignPlatformTags(id, update.body ?? row.body, update.tags ?? this.#tags(id).filter((tag) => tag.origin === "user").map((tag) => tag.name), now);
    })();
    return this.annotation(id, author);
  }

  #targets(annotationId, hydrate = true) {
    const rows = this.db.prepare("SELECT id, literature_id, target_json FROM annotation_targets_v2 WHERE annotation_id = ? ORDER BY position").all(annotationId);
    return rows.map((row) => {
      const target = parseJson(row.target_json, null);
      if (!target || !hydrate) return target;
      const literatureRecord = this.#literatureRecord(row.literature_id);
      const hydrated = {
        ...target,
        literature: literatureRecord ? { ...target.literature, literatureRecord } : target.literature
      };
      if (target.kind === "derived_passage") {
        const evidence = this.db.prepare("SELECT literature_id, evidence_json FROM annotation_target_evidence_v2 WHERE target_id = ? ORDER BY position").all(row.id);
        hydrated.evidence = evidence.map((item) => {
          const value = parseJson(item.evidence_json, null);
          const record = this.#literatureRecord(item.literature_id);
          return value && record ? { ...value, literature: { ...value.literature, literatureRecord: record } } : value;
        }).filter(Boolean);
      }
      return hydrated;
    }).filter(Boolean);
  }

  #tags(annotationId) {
    return this.db.prepare("SELECT tag_name AS name, origin, state, confidence FROM annotation_tags_v2 WHERE annotation_id = ? AND state <> 'removed' ORDER BY origin, tag_name").all(annotationId);
  }

  #serialize(row, viewer, hydrateTargets = true) {
    const rating = this.db.prepare("SELECT count(*) AS count, avg(rating) AS average FROM annotation_ratings_v2 WHERE annotation_id = ?").get(row.id);
    const viewerRating = viewer?.id ? this.db.prepare("SELECT rating FROM annotation_ratings_v2 WHERE annotation_id = ? AND user_id = ?").get(row.id, viewer.id)?.rating ?? null : null;
    const viewerSaved = viewer?.id ? Boolean(this.db.prepare("SELECT 1 FROM annotation_saves_v2 WHERE annotation_id = ? AND user_id = ?").get(row.id, viewer.id)) : false;
    const sourceReply = row.source_reply_id ? this.db.prepare("SELECT parent_deleted_at FROM annotation_replies_v2 WHERE id = ?").get(row.source_reply_id) : null;
    return {
      author: { id: row.author_id, initials: row.author_initials, name: row.author_name, profile: parseJson(row.author_profile_snapshot_json, {}) },
      body: row.body,
      createdAt: row.created_at,
      id: row.id,
      organizationId: row.organization_id,
      originalReply: row.source_reply_id ? { replyId: row.source_reply_id, status: sourceReply?.parent_deleted_at ? "parent_deleted" : "available" } : null,
      ratingAverage: rating.average === null ? null : Number(Number(rating.average).toFixed(2)),
      ratingCount: Number(rating.count),
      revision: row.revision,
      shareToPlaza: Boolean(row.share_to_plaza),
      tags: this.#tags(row.id),
      targets: this.#targets(row.id, hydrateTargets),
      updatedAt: row.updated_at,
      viewerCanModerate: false,
      viewerIsAuthor: Boolean(viewer?.id && row.author_id === viewer.id),
      viewerSaved,
      viewerRating,
      visibility: row.visibility,
      withdrawnAt: row.withdrawn_at ?? null
    };
  }

  async annotation(id, viewer) {
    const authorizedRow = this.#annotationRow(id);
    if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const row = this.#annotationRow(id);
    if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !this.#rootAudience(row)) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    return this.#serialize(row, viewer);
  }

  #serializeReply(row) {
    const derived = row.derived_annotation_id ? this.#annotationRow(row.derived_annotation_id) : null;
    return {
      author: { id: row.author_id, initials: row.author_initials, name: row.author_name, profile: parseJson(row.author_profile_snapshot_json, {}) },
      body: row.body,
      createdAt: row.created_at,
      derivedAnnotationId: row.derived_annotation_id,
      derivedAnnotationState: !row.derived_annotation_id ? "none" : derived?.withdrawn_at ? "withdrawn" : "published",
      id: row.id,
      parentAnnotationId: row.parent_annotation_id,
      revision: row.revision,
      updatedAt: row.updated_at,
      viewerIsAuthor: false
    };
  }

  async createReply(parentAnnotationId, author, input) {
    const authorizedParent = this.#annotationRow(parentAnnotationId);
    if (!authorizedParent || authorizedParent.withdrawn_at || !await this.#canView(authorizedParent, author)) throw new AnnotationCommunityError("PARENT_ANNOTATION_NOT_FOUND", 404);
    if (authorizedParent.visibility === "organization" && !await this.#organizationVisible({ organizationId: authorizedParent.organization_id, userId: author.id })) {
      throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
    }
    const parent = this.#annotationRow(parentAnnotationId);
    if (
      !parent ||
      parent.withdrawn_at ||
      parent.visibility !== authorizedParent.visibility ||
      parent.organization_id !== authorizedParent.organization_id ||
      parent.revision !== authorizedParent.revision ||
      !this.#rootAudience(parent)
    ) {
      throw new AnnotationCommunityError("PARENT_ANNOTATION_NOT_FOUND", 404);
    }
    const now = new Date().toISOString();
    const replyId = `reply_${randomUUID()}`;
    const derivedAnnotationId = input.publishAsAnnotation ? `annotation_${randomUUID()}` : null;
    const profile = JSON.stringify(this.#profileSnapshot(author.id));
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO annotation_replies_v2(id, parent_annotation_id, derived_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(replyId, parentAnnotationId, null, input.body, author.id, author.name, author.initials ?? initialsFor(author.name), profile, parent.visibility, parent.organization_id, now, now);
      if (derivedAnnotationId) {
        this.db.prepare(`INSERT INTO annotations_v2(id, parent_annotation_id, source_reply_id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
          .run(derivedAnnotationId, replyId, input.body, author.id, author.name, author.initials ?? initialsFor(author.name), profile, parent.visibility, parent.organization_id, parent.visibility === "public" ? 1 : 0, now, now);
        this.#replaceTargets(derivedAnnotationId, input.targets, now, author.id);
        this.#replaceUserTags(derivedAnnotationId, input.tags, now);
        this.#assignPlatformTags(derivedAnnotationId, input.body, input.tags, now);
        this.db.prepare("UPDATE annotation_replies_v2 SET derived_annotation_id = ? WHERE id = ?").run(derivedAnnotationId, replyId);
      }
    })();
    const row = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    return { annotation: derivedAnnotationId ? await this.annotation(derivedAnnotationId, author) : null, reply: { ...this.#serializeReply(row), viewerIsAuthor: true } };
  }

  async updateReply(replyId, author, input) {
    const authorizedRow = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    if (!authorizedRow || authorizedRow.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    if (authorizedRow.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
    if (authorizedRow.visibility === "organization" && !await this.#organizationVisible({ organizationId: authorizedRow.organization_id, userId: author.id })) {
      throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
    }
    const row = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    if (
      !row ||
      row.deleted_at ||
      row.author_id !== authorizedRow.author_id ||
      row.visibility !== authorizedRow.visibility ||
      row.organization_id !== authorizedRow.organization_id ||
      row.revision !== authorizedRow.revision
    ) {
      throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    }
    const now = new Date().toISOString();
    const profile = JSON.stringify(this.#profileSnapshot(author.id));
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO annotation_reply_versions_v2(id, reply_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(`reply_version_${randomUUID()}`, replyId, row.revision, JSON.stringify(this.#serializeReply(row)), author.id, now);
      this.db.prepare("UPDATE annotation_replies_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
        .run(input.body, author.name, author.initials ?? initialsFor(author.name), profile, now, replyId);
      if (row.derived_annotation_id) {
        const derived = this.#annotationRow(row.derived_annotation_id);
        this.db.prepare("INSERT INTO annotation_versions_v2(id, annotation_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(`annotation_version_${randomUUID()}`, derived.id, derived.revision, JSON.stringify(this.#serialize(derived, author, false)), author.id, now);
        this.db.prepare("UPDATE annotations_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
          .run(input.body, author.name, author.initials ?? initialsFor(author.name), profile, now, derived.id);
      }
    })();
    return { ...this.#serializeReply(this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId)), viewerIsAuthor: true };
  }

  async updateReplyPublication(replyId, author, input) {
    const authorizedRow = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    if (!authorizedRow || authorizedRow.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    if (authorizedRow.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
    const authorizedParent = this.#annotationRow(authorizedRow.parent_annotation_id);
    if (authorizedRow.visibility === "organization" && !await this.#organizationVisible({ organizationId: authorizedRow.organization_id, userId: author.id })) {
      throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
    }
    const row = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    if (
      !row ||
      row.deleted_at ||
      row.author_id !== authorizedRow.author_id ||
      row.visibility !== authorizedRow.visibility ||
      row.organization_id !== authorizedRow.organization_id ||
      row.revision !== authorizedRow.revision
    ) {
      throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    }
    if (input.published && row.moderated_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    const parent = this.#annotationRow(row.parent_annotation_id);
    if (
      !parent ||
      parent.withdrawn_at ||
      parent.visibility !== row.visibility ||
      parent.organization_id !== row.organization_id ||
      !this.#sameAudienceState(authorizedParent, parent) ||
      parent.revision !== authorizedParent?.revision ||
      !this.#rootAudience(parent)
    ) {
      throw new AnnotationCommunityError("REPLY_VISIBILITY_MISMATCH");
    }
    const now = new Date().toISOString();
    let derivedAnnotationId = row.derived_annotation_id;
    this.db.transaction(() => {
      if (!input.published) {
        if (row.moderated_at) {
          this.db.prepare("UPDATE annotation_replies_v2 SET moderated_at = ?, moderation_reason = ?, moderated_by = ?, updated_at = ? WHERE id = ?")
            .run(now, "Projection withdrawal superseded platform or organization restore authority.", `author:${author.id}`.slice(0, 200), now, replyId);
        }
        if (derivedAnnotationId) {
          this.db.prepare("UPDATE annotations_v2 SET withdrawn_at = ?, updated_at = ? WHERE id = ?")
            .run(now, now, derivedAnnotationId);
        }
        return;
      }
      if (!derivedAnnotationId) {
        derivedAnnotationId = `annotation_${randomUUID()}`;
        this.db.prepare(`INSERT INTO annotations_v2(id, parent_annotation_id, source_reply_id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(derivedAnnotationId, replyId, row.body, row.author_id, row.author_name, row.author_initials, row.author_profile_snapshot_json, row.visibility, row.organization_id, row.visibility === "public" ? 1 : 0, 1, now, now);
        this.db.prepare("UPDATE annotation_replies_v2 SET derived_annotation_id = ? WHERE id = ?").run(derivedAnnotationId, replyId);
      } else {
        const derived = this.#annotationRow(derivedAnnotationId);
        this.db.prepare("INSERT INTO annotation_versions_v2(id, annotation_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(`annotation_version_${randomUUID()}`, derived.id, derived.revision, JSON.stringify(this.#serialize(derived, author, false)), author.id, now);
        this.db.prepare(`UPDATE annotations_v2 SET body = ?, author_name = ?, author_initials = ?, author_profile_snapshot_json = ?, visibility = ?, organization_id = ?, share_to_plaza = ?, revision = ?, withdrawn_at = NULL, updated_at = ? WHERE id = ?`)
          .run(row.body, row.author_name, row.author_initials, row.author_profile_snapshot_json, row.visibility, row.organization_id, row.visibility === "public" ? 1 : 0, derived.revision + 1, now, derivedAnnotationId);
      }
      this.#replaceTargets(derivedAnnotationId, input.targets, now, author.id);
      this.#replaceUserTags(derivedAnnotationId, input.tags, now);
      this.#assignPlatformTags(derivedAnnotationId, row.body, input.tags, now);
    })();
    const reply = { ...this.#serializeReply(this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId)), viewerIsAuthor: true };
    return { annotation: input.published ? await this.annotation(derivedAnnotationId, author) : null, reply };
  }

  async deleteReply(replyId, author) {
    const row = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(replyId);
    if (!row || row.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
    if (row.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE annotation_replies_v2 SET body = '[deleted]', deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, replyId);
      if (row.derived_annotation_id) {
        this.db.prepare("UPDATE annotations_v2 SET withdrawn_at = ?, updated_at = ? WHERE id = ?")
          .run(now, now, row.derived_annotation_id);
      }
    })();
    return { ok: true, replyId };
  }

  async replies(id, viewer) {
    await this.annotation(id, viewer);
    const rows = this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE parent_annotation_id = ? AND deleted_at IS NULL AND moderated_at IS NULL ORDER BY created_at, id").all(id);
    return rows.map((row) => ({ ...this.#serializeReply(row), viewerIsAuthor: Boolean(viewer?.id && row.author_id === viewer.id) }));
  }

  async plaza(viewer, filters = {}) {
    let rows = this.db.prepare("SELECT * FROM annotations_v2 WHERE share_to_plaza = 1 AND visibility = 'public' AND withdrawn_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 500").all();
    if (filters.literatureId) {
      rows = rows.filter((row) => Boolean(this.db.prepare(`
        SELECT 1 FROM annotation_targets_v2 target
         WHERE target.annotation_id = ? AND target.literature_id = ?
        UNION SELECT 1 FROM annotation_targets_v2 target JOIN annotation_target_evidence_v2 evidence ON evidence.target_id = target.id
         WHERE target.annotation_id = ? AND evidence.literature_id = ?
      `).get(row.id, filters.literatureId, row.id, filters.literatureId)));
    }
    const identityValue = filters.literatureIdentityValue ? normalizeIdentity(filters.literatureIdentityKind, filters.literatureIdentityValue) : null;
    if (identityValue) {
      const literatureIds = this.#matchingLiteratureIds([{ kind: filters.literatureIdentityKind, value: identityValue }]);
      rows = rows.filter((row) => Boolean(this.db.prepare(`
        SELECT 1 FROM annotation_targets_v2 target
         WHERE target.annotation_id = ? AND target.literature_id IN (${[...literatureIds].map(() => "?").join(",") || "NULL"})
        UNION SELECT 1 FROM annotation_targets_v2 target JOIN annotation_target_evidence_v2 evidence ON evidence.target_id = target.id
         WHERE target.annotation_id = ? AND evidence.literature_id IN (${[...literatureIds].map(() => "?").join(",") || "NULL"})
      `).get(row.id, ...literatureIds, row.id, ...literatureIds)));
    }
    if (filters.documentType) rows = rows.filter((row) => Boolean(this.db.prepare("SELECT 1 FROM annotation_targets_v2 target JOIN literature_records_v2 literature ON literature.id = target.literature_id WHERE target.annotation_id = ? AND literature.document_type = ?").get(row.id, filters.documentType)));
    if (filters.institution) rows = rows.filter((row) => parseJson(row.author_profile_snapshot_json, {}).institutions?.some((item) => item.name === filters.institution));
    if (filters.educationStage) rows = rows.filter((row) => parseJson(row.author_profile_snapshot_json, {}).educationStage === filters.educationStage);
    const query = String(filters.query ?? "").trim();
    const dynamicCriterion = query.startsWith("/") ? query.slice(1).trim() : "";
    if (query && !dynamicCriterion) {
      rows = rows.map((row) => ({ row, score: localSemanticSimilarity(query, this.#searchText(row)) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.row);
    }
    if (dynamicCriterion) {
      const scored = rows.map((row) => ({ row, score: localSemanticSimilarity(dynamicCriterion, this.#searchText(row)) }));
      const positive = scored.filter((item) => item.score >= Math.max(0.16, Math.min(0.45, scored[0]?.score ?? 0))).sort((a, b) => b.score - a.score);
      rows = positive.map((item) => item.row);
    }
    if (filters.sort === "recommended") rows.sort((a, b) => this.#ratingScore(b.id) - this.#ratingScore(a.id) || b.created_at.localeCompare(a.created_at));
    const annotations = [];
    for (const authorizedRow of rows) {
      const row = this.#annotationRow(authorizedRow.id);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !this.#rootAudience(row)) continue;
      annotations.push(this.#serialize(row, viewer));
      if (annotations.length >= Math.min(Number(filters.limit) || 30, 100)) break;
    }
    return annotations;
  }

  mine(viewer) {
    const rows = this.db.prepare("SELECT * FROM annotations_v2 WHERE author_id = ? AND withdrawn_at IS NULL ORDER BY updated_at DESC, id DESC").all(viewer.id);
    return rows.flatMap((authorizedRow) => {
      const row = this.#annotationRow(authorizedRow.id);
      return this.#sameAudienceState(authorizedRow, row) && !row.withdrawn_at && this.#rootAudience(row)
        ? [this.#serialize(row, viewer)]
        : [];
    });
  }

  async followingFeed(viewer) {
    const rows = this.db.prepare(`
      SELECT annotation.*
        FROM annotations_v2 annotation
        JOIN user_follows_v2 follow ON follow.followed_id = annotation.author_id
       WHERE follow.follower_id = ?
         AND annotation.withdrawn_at IS NULL
         AND (
           (annotation.visibility = 'public' AND annotation.share_to_plaza = 1) OR
           annotation.visibility = 'mutual_followers'
         )
       ORDER BY annotation.updated_at DESC, annotation.id DESC
       LIMIT 100
    `).all(viewer.id);
    const annotations = [];
    for (const authorizedRow of rows) {
      if (!await this.#canView(authorizedRow, viewer)) continue;
      const row = this.#annotationRow(authorizedRow.id);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !this.#rootAudience(row)) continue;
      annotations.push(this.#serialize(row, viewer));
    }
    return annotations;
  }

  async organizationFeed(viewer) {
    if (!this.listOrganizations) throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
    let memberships;
    try {
      memberships = await this.listOrganizations(viewer.id);
    } catch {
      throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
    }
    return memberships.map((membership) => {
      const canModerate = new Set(["owner", "admin"]).has(membership.role);
      const rows = this.db.prepare(`SELECT * FROM annotations_v2 WHERE organization_id = ? AND visibility = 'organization' AND (? = 1 OR withdrawn_at IS NULL) ORDER BY updated_at DESC, id DESC`).all(membership.organizationId, canModerate ? 1 : 0);
      return {
        ...membership,
        annotations: rows.flatMap((authorizedRow) => {
          const row = this.#annotationRow(authorizedRow.id);
          return this.#sameAudienceState(authorizedRow, row) && this.#rootAudience(row)
            ? [{ ...this.#serialize(row, viewer), viewerCanModerate: canModerate }]
            : [];
        })
      };
    });
  }

  async rateAnnotation(annotationId, viewer, rating) {
    const authorizedRow = this.#annotationRow(annotationId);
    if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const row = this.#annotationRow(annotationId);
    if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !this.#rootAudience(row)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    if (row.author_id === viewer.id) throw new AnnotationCommunityError("SELF_RATING_FORBIDDEN", 403);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO annotation_ratings_v2(annotation_id, user_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(annotation_id, user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`).run(annotationId, viewer.id, rating, now, now);
    const aggregate = this.db.prepare("SELECT count(*) AS count, avg(rating) AS average FROM annotation_ratings_v2 WHERE annotation_id = ?").get(annotationId);
    return { ratingAverage: Number(Number(aggregate.average).toFixed(2)), ratingCount: Number(aggregate.count), viewerRating: rating };
  }

  async toggleSave(annotationId, viewer) {
    const authorizedRow = this.#annotationRow(annotationId);
    if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const row = this.#annotationRow(annotationId);
    if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !this.#rootAudience(row)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const existing = this.db.prepare("SELECT 1 FROM annotation_saves_v2 WHERE annotation_id = ? AND user_id = ?").get(annotationId, viewer.id);
    if (existing) this.db.prepare("DELETE FROM annotation_saves_v2 WHERE annotation_id = ? AND user_id = ?").run(annotationId, viewer.id);
    else this.db.prepare("INSERT INTO annotation_saves_v2(annotation_id, user_id, created_at) VALUES (?, ?, ?)").run(annotationId, viewer.id, new Date().toISOString());
    return { saved: !existing };
  }

  withdraw(annotationId, viewer) {
    const row = this.#annotationRow(annotationId);
    if (!row) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    if (row.author_id !== viewer.id) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
    if (!this.#rootAudience(row)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const now = new Date().toISOString();
    if (row.withdrawn_at) {
      const linkedReply = row.source_reply_id
        ? this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(row.source_reply_id)
        : null;
      if (
        !linkedReply?.moderated_at ||
        linkedReply.derived_annotation_id !== row.id
      ) {
        throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      }
      this.db.prepare("UPDATE annotation_replies_v2 SET moderated_at = ?, moderation_reason = ?, moderated_by = ?, updated_at = ? WHERE id = ?")
        .run(now, "Projection withdrawal superseded platform or organization restore authority.", `author:${viewer.id}`.slice(0, 200), now, linkedReply.id);
      return { annotationId, ok: true };
    }
    this.db.transaction(() => {
      this.db.prepare("UPDATE annotations_v2 SET withdrawn_at = ?, updated_at = ? WHERE id = ?").run(now, now, annotationId);
      this.db.prepare("UPDATE annotation_replies_v2 SET body = '[deleted]', deleted_at = ?, parent_deleted_at = ?, updated_at = ? WHERE parent_annotation_id = ? AND deleted_at IS NULL").run(now, now, now, annotationId);
    })();
    return { annotationId, ok: true };
  }

  async moderateOrganizationAnnotation({ action, annotationId, reason, traceId, userId }) {
    const authorizedRow = this.#annotationRow(annotationId);
    if (!authorizedRow || authorizedRow.visibility !== "organization") throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const access = await this.#organizationAccess({ organizationId: authorizedRow.organization_id, userId });
    if (!access.allowed || !new Set(["owner", "admin"]).has(access.role)) throw new AnnotationCommunityError("ORGANIZATION_MODERATION_DENIED", 403);
    const row = this.#annotationRow(annotationId);
    if (!this.#sameAudienceState(authorizedRow, row) || row.visibility !== "organization") {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    if (row.revision !== authorizedRow.revision) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    return this.#moderateAnnotation({
      action,
      annotation: row,
      authority: "organization",
      moderatorId: userId,
      reason,
      traceId
    });
  }

  #moderateAnnotation({ action, annotation, authority, moderatorId, reason, traceId }) {
    const linkedReply = annotation.source_reply_id
      ? this.db.prepare("SELECT * FROM annotation_replies_v2 WHERE id = ?").get(annotation.source_reply_id)
      : null;
    if (
      !this.#rootAudience(annotation) ||
      (annotation.source_reply_id && linkedReply?.derived_annotation_id !== annotation.id)
    ) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    if (
      action === "restore" &&
      annotation.source_reply_id &&
      (
        !linkedReply?.moderated_at ||
        !linkedReply.moderated_by?.startsWith(`${authority}:`) ||
        (linkedReply.deleted_at && !linkedReply.parent_deleted_at)
      )
    ) {
      throw new AnnotationCommunityError("ANNOTATION_MODERATION_CONFLICT", 409);
    }
    const withdrawn = Boolean(annotation.withdrawn_at);
    if ((action === "withdraw" && withdrawn) || (action === "restore" && !withdrawn)) throw new AnnotationCommunityError("ANNOTATION_MODERATION_CONFLICT", 409);
    const now = new Date().toISOString();
    const linkedReplyId = annotation.source_reply_id ?? null;
    this.db.transaction(() => {
      this.db.prepare("UPDATE annotations_v2 SET withdrawn_at = ?, updated_at = ? WHERE id = ?").run(action === "withdraw" ? now : null, now, annotation.id);
      if (linkedReplyId) {
        this.db.prepare("UPDATE annotation_replies_v2 SET moderated_at = ?, moderation_reason = ?, moderated_by = ?, updated_at = ? WHERE id = ?")
          .run(action === "withdraw" ? now : null, action === "withdraw" ? reason : null, action === "withdraw" ? `${authority}:${moderatorId}`.slice(0, 200) : null, now, linkedReplyId);
      }
      this.db.prepare("INSERT INTO annotation_moderation_audit_v2(id, annotation_id, linked_reply_id, action, reason, admin_user_id, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(`annotationaudit_${randomUUID()}`, annotation.id, linkedReplyId, action, reason, moderatorId, traceId, now);
    })();
    return { action, annotationId: annotation.id, ok: true };
  }

  #ratingScore(annotationId) {
    const value = this.db.prepare("SELECT avg(rating) AS average, count(*) AS count FROM annotation_ratings_v2 WHERE annotation_id = ?").get(annotationId);
    return (Number(value.average) || 0) * Math.log2(Number(value.count) + 1);
  }

  #searchText(row) {
    const targets = this.#targets(row.id);
    const tags = this.#tags(row.id).map((tag) => tag.name);
    return [row.body, ...tags, ...targets.flatMap((target) => [target.literature?.literatureRecord?.title, target.literature?.metadata?.title, target.literature?.title, target.excerpt, target.derivedContent?.excerpt, ...(target.evidence ?? []).map((evidence) => evidence.literature?.literatureRecord?.title)])].filter(Boolean).join(" ");
  }

  toggleFollow(userId, targetUserId) {
    if (userId === targetUserId) throw new AnnotationCommunityError("CANNOT_FOLLOW_SELF");
    const existing = this.db.prepare("SELECT 1 FROM user_follows_v2 WHERE follower_id = ? AND followed_id = ?").get(userId, targetUserId);
    if (existing) this.db.prepare("DELETE FROM user_follows_v2 WHERE follower_id = ? AND followed_id = ?").run(userId, targetUserId);
    else this.db.prepare("INSERT INTO user_follows_v2(follower_id, followed_id, created_at) VALUES (?, ?, ?)").run(userId, targetUserId, new Date().toISOString());
    return { following: !existing, mutual: !existing && this.#mutual(userId, targetUserId) };
  }

  #conversationParticipant(userId) {
    const snapshot = this.db.prepare(`
      SELECT author_name, author_initials, author_profile_snapshot_json
        FROM (
          SELECT author_name, author_initials, author_profile_snapshot_json, updated_at
            FROM annotations_v2 WHERE author_id = ?
          UNION ALL
          SELECT author_name, author_initials, author_profile_snapshot_json, updated_at
            FROM annotation_replies_v2 WHERE author_id = ?
        ) snapshots
       ORDER BY updated_at DESC
       LIMIT 1
    `).get(userId, userId);
    return {
      id: userId,
      initials: snapshot?.author_initials ?? "研",
      name: snapshot?.author_name ?? "研究成员",
      profile: parseJson(snapshot?.author_profile_snapshot_json, { educationStage: null, institutions: [] })
    };
  }

  conversations(viewerId) {
    return this.db.prepare(`
      SELECT * FROM direct_conversations_v2
       WHERE first_user_id = ? OR second_user_id = ?
       ORDER BY COALESCE((
         SELECT message.created_at FROM direct_messages_v2 message
          WHERE message.conversation_id = direct_conversations_v2.id
          ORDER BY message.created_at DESC, message.id DESC LIMIT 1
       ), created_at) DESC, id DESC
    `).all(viewerId, viewerId).map((conversation) => {
      const participantId = conversation.first_user_id === viewerId ? conversation.second_user_id : conversation.first_user_id;
      const lastMessage = this.db.prepare("SELECT * FROM direct_messages_v2 WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(conversation.id);
      const read = this.db.prepare("SELECT * FROM direct_conversation_reads_v2 WHERE conversation_id = ? AND user_id = ?").get(conversation.id, viewerId);
      const unreadCount = this.db.prepare(`
        SELECT count(*) AS count FROM direct_messages_v2
         WHERE conversation_id = ? AND sender_id <> ?
           AND (? IS NULL OR created_at > ? OR (created_at = ? AND id > ?))
      `).get(conversation.id, viewerId, read?.last_read_at ?? null, read?.last_read_at ?? null, read?.last_read_at ?? null, read?.last_read_message_id ?? null);
      return {
        canSend: this.#mutual(viewerId, participantId),
        createdAt: conversation.created_at,
        id: conversation.id,
        lastMessage: lastMessage ? {
          body: lastMessage.body,
          createdAt: lastMessage.created_at,
          invitation: lastMessage.invitation_json ? parseJson(lastMessage.invitation_json, null) : null,
          kind: lastMessage.message_kind,
          senderId: lastMessage.sender_id
        } : null,
        participant: this.#conversationParticipant(participantId),
        unreadCount: Number(unreadCount.count)
      };
    });
  }

  createConversation(userId, participantId) {
    if (!this.#mutual(userId, participantId)) throw new AnnotationCommunityError("MUTUAL_FOLLOW_REQUIRED", 403);
    const [first, second] = [userId, participantId].sort();
    const existing = this.db.prepare("SELECT id FROM direct_conversations_v2 WHERE first_user_id = ? AND second_user_id = ?").get(first, second);
    if (existing) return existing;
    const id = `conversation_${randomUUID()}`;
    this.db.prepare("INSERT INTO direct_conversations_v2(id, first_user_id, second_user_id, created_at) VALUES (?, ?, ?, ?)").run(id, first, second, new Date().toISOString());
    return { id };
  }

  async sendMessage(conversationId, senderId, input) {
    const conversation = this.db.prepare("SELECT * FROM direct_conversations_v2 WHERE id = ?").get(conversationId);
    if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(senderId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
    const recipientId = conversation.first_user_id === senderId ? conversation.second_user_id : conversation.first_user_id;
    if (!this.#mutual(senderId, recipientId)) throw new AnnotationCommunityError("MUTUAL_FOLLOW_REQUIRED", 403);
    const id = `message_${randomUUID()}`;
    if (input.kind === "organization_invitation") {
      const invitation = await this.#organizationInvitation({
        ...input.invitation,
        idempotencyKey: `intuecho-${id}`,
        invitedUserId: recipientId,
        inviterId: senderId
      });
      if (!invitation?.invitationId) throw new AnnotationCommunityError("ORGANIZATION_INVITATION_DENIED", 403);
      input = { ...input, invitation: { ...input.invitation, ...invitation } };
    }
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO direct_messages_v2(id, conversation_id, sender_id, message_kind, body, invitation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, conversationId, senderId, input.kind, input.body, input.kind === "organization_invitation" ? JSON.stringify(input.invitation) : null, now);
    return { body: input.body, createdAt: now, id, invitation: input.kind === "organization_invitation" ? input.invitation : null, kind: input.kind, senderId };
  }

  messages(conversationId, viewerId) {
    const conversation = this.db.prepare("SELECT * FROM direct_conversations_v2 WHERE id = ?").get(conversationId);
    if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(viewerId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
    return this.db.prepare("SELECT * FROM direct_messages_v2 WHERE conversation_id = ? ORDER BY created_at, id").all(conversationId).map((row) => ({ body: row.body, createdAt: row.created_at, id: row.id, invitation: row.invitation_json ? parseJson(row.invitation_json, null) : null, kind: row.message_kind, senderId: row.sender_id }));
  }

  markConversationRead(conversationId, viewerId, messageId) {
    const conversation = this.db.prepare("SELECT * FROM direct_conversations_v2 WHERE id = ?").get(conversationId);
    if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(viewerId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
    const latest = this.db.prepare("SELECT id, created_at FROM direct_messages_v2 WHERE conversation_id = ? AND id = ?").get(conversationId, messageId);
    if (!latest) throw new AnnotationCommunityError("INVALID_READ_STATE");
    const current = this.db.prepare("SELECT * FROM direct_conversation_reads_v2 WHERE conversation_id = ? AND user_id = ?").get(conversationId, viewerId);
    if (!current || latest.created_at > current.last_read_at || (latest.created_at === current.last_read_at && latest.id > current.last_read_message_id)) {
      this.db.prepare(`
        INSERT INTO direct_conversation_reads_v2(conversation_id, user_id, last_read_message_id, last_read_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id, user_id) DO UPDATE SET
          last_read_message_id = excluded.last_read_message_id,
          last_read_at = excluded.last_read_at
      `).run(conversationId, viewerId, latest.id, latest.created_at);
    }
    const unread = this.db.prepare(`
      SELECT count(*) AS count FROM direct_messages_v2
       WHERE conversation_id = ? AND sender_id <> ?
         AND (created_at > ? OR (created_at = ? AND id > ?))
    `).get(conversationId, viewerId, latest.created_at, latest.created_at, latest.id);
    return { lastReadMessageId: latest.id, unreadCount: Number(unread.count) };
  }

  appealPlatformTag(annotationId, tag, userId, reason) {
    const row = this.#annotationRow(annotationId);
    if (!row) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    if (row.author_id !== userId) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
    const slug = tagSlug(tag);
    const assigned = this.db.prepare("SELECT state FROM annotation_tags_v2 WHERE annotation_id = ? AND tag_slug = ? AND origin = 'platform'").get(annotationId, slug);
    if (!assigned) throw new AnnotationCommunityError("PLATFORM_TAG_NOT_FOUND", 404);
    if (assigned.state !== "active") throw new AnnotationCommunityError("PLATFORM_TAG_APPEAL_NOT_ALLOWED", 409);
    const id = `appeal_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE annotation_tags_v2 SET state = 'appealed', updated_at = ? WHERE annotation_id = ? AND tag_slug = ? AND origin = 'platform'").run(now, annotationId, slug);
      this.db.prepare("INSERT INTO annotation_tag_appeals_v2(id, annotation_id, tag_slug, submitted_by, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(id, annotationId, slug, userId, reason, now);
    })();
    return { appealId: id, status: "pending" };
  }

  listTagAppeals(status = "pending") {
    return this.db.prepare(`
      SELECT appeal.*, annotation.body AS annotation_body,
             annotation.author_name, tag.tag_name
        FROM annotation_tag_appeals_v2 appeal
        JOIN annotations_v2 annotation ON annotation.id = appeal.annotation_id
        JOIN annotation_tags_v2 tag
          ON tag.annotation_id = appeal.annotation_id
         AND tag.tag_slug = appeal.tag_slug
         AND tag.origin = 'platform'
       WHERE appeal.status = ?
       ORDER BY appeal.created_at, appeal.id
    `).all(status).map((row) => ({
      annotationBody: row.annotation_body,
      annotationId: row.annotation_id,
      appealId: row.id,
      authorName: row.author_name,
      createdAt: row.created_at,
      reason: row.reason,
      resolutionReason: row.resolution_reason ?? null,
      resolvedAt: row.resolved_at ?? null,
      resolvedBy: row.resolved_by ?? null,
      status: row.status,
      submittedBy: row.submitted_by,
      tag: row.tag_name
    }));
  }

  resolveTagAppeal(appealId, adminUserId, input, traceId) {
    const appeal = this.db.prepare("SELECT * FROM annotation_tag_appeals_v2 WHERE id = ?").get(appealId);
    if (!appeal) throw new AnnotationCommunityError("TAG_APPEAL_NOT_FOUND", 404);
    if (appeal.status !== "pending") throw new AnnotationCommunityError("TAG_APPEAL_ALREADY_RESOLVED", 409);
    const now = new Date().toISOString();
    const tagState = input.decision === "accepted" ? "removed" : "upheld";
    this.db.transaction(() => {
      this.db.prepare("UPDATE annotation_tag_appeals_v2 SET status = ?, resolved_by = ?, resolution_reason = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
        .run(input.decision, adminUserId, input.reason, now, appealId);
      this.db.prepare("UPDATE annotation_tags_v2 SET state = ?, updated_at = ? WHERE annotation_id = ? AND tag_slug = ? AND origin = 'platform'")
        .run(tagState, now, appeal.annotation_id, appeal.tag_slug);
      this.db.prepare("INSERT INTO annotation_tag_appeal_audit_v2(id, appeal_id, annotation_id, tag_slug, decision, admin_user_id, reason, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(`appealaudit_${randomUUID()}`, appealId, appeal.annotation_id, appeal.tag_slug, input.decision, adminUserId, input.reason, traceId, now);
    })();
    return { appealId, decision: input.decision, resolvedAt: now };
  }

  listAdminAnnotations() {
    return this.db.prepare("SELECT * FROM annotations_v2 ORDER BY updated_at DESC, id DESC").all().map((row) => ({
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      id: row.id,
      parentAnnotationId: row.parent_annotation_id,
      updatedAt: row.updated_at,
      visibility: row.visibility,
      withdrawnAt: row.withdrawn_at ?? null
    }));
  }

  moderateAnnotation(input) {
    const annotation = this.#annotationRow(input.annotationId);
    if (!annotation) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    return this.#moderateAnnotation({
      action: input.action,
      annotation,
      authority: "platform",
      moderatorId: input.adminId,
      reason: input.reason,
      traceId: input.traceId
    });
  }
}
