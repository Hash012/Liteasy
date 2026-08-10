import { randomUUID } from "node:crypto";
import { withTransaction } from "./postgres.mjs";
import { AnnotationCommunityError, desktopAnnotationPublicationDigest, localSemanticSimilarity } from "./annotationCommunitySqlite.mjs";
import {
  hasCrossVersionIdentifierConflict,
  isConfirmableLiteratureIdentifierKind,
  literatureIdentifierRole,
  LiteratureIdentityConflictError,
  normalizeLiteratureIdentifier,
  normalizeLiteratureRelations,
  sameLiteratureBibliography,
  sameLiteratureVersionBibliography,
  selectLiteratureClaimIdentifier,
  titleAuthorsYearFingerprint
} from "./literatureIdentity.mjs";

const aggregateLiteratureProviders = new Set(["openalex", "semantic_scholar"]);
const confirmedLiteratureProviders = new Set(["crossref", "arxiv", "openalex", "semantic_scholar"]);
const literatureResolverActor = "literature_resolver";

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

export class PostgresAnnotationCommunityRepository {
  constructor(pool, { authorizeOrganizationAccess, authorizeOrganizationInvitation, authorizeOrganizationVisibility, listOrganizations } = {}) {
    this.pool = pool;
    this.authorizeOrganizationAccess = authorizeOrganizationAccess;
    this.authorizeOrganizationInvitation = authorizeOrganizationInvitation;
    this.authorizeOrganizationVisibility = authorizeOrganizationVisibility;
    this.listOrganizations = listOrganizations;
  }

  async findLiteratureByIdentifiers(identifiers, client = this.pool) {
    const normalized = [...new Map((identifiers ?? []).map((identifier) => {
      const kind = identifier.kind;
      const value = normalizeIdentity(kind, identifier.value);
      return [`${kind}:${value}`, { kind, value }];
    })).values()];
    const literatureIds = await this.#matchingLiteratureIds(normalized, client);
    if (literatureIds.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
    const id = [...literatureIds][0];
    return id ? this.#literatureRecord(id, client) : null;
  }

  async findLiteratureById(literatureId, client = this.pool) {
    const id = String(literatureId ?? "").trim();
    return id ? this.#literatureRecord(id, client) : null;
  }

  async searchStoredLiterature(query, limit = 10, client = this.pool) {
    const bounded = Math.max(1, Math.min(Number(limit) || 10, 10));
    const value = String(query ?? "").trim();
    if (!value) return [];
    const result = await client.query(`
      SELECT DISTINCT literature.id
        FROM literature_records literature
        LEFT JOIN literature_identifiers identifier ON identifier.literature_id = literature.id
       WHERE literature.confirmation_status = 'confirmed'
         AND (literature.title ILIKE $1 OR literature.authors::text ILIKE $1 OR identifier.normalized_value ILIKE $1)
       ORDER BY literature.id
       LIMIT $2
    `, [`%${value}%`, bounded]);
    const records = [];
    for (const row of result.rows) records.push(await this.#literatureRecord(row.id, client));
    return records.filter(Boolean);
  }

  async confirmRefetchedLiterature(owner, verifiedCandidate) {
    const provider = verifiedCandidate?.provider;
    const record = verifiedCandidate?.record;
    if (!new Set(["crossref", "arxiv", "openalex", "semantic_scholar"]).has(provider) ||
      !verifiedCandidate?.candidateKey || !record || !Array.isArray(record.identifiers)) {
      throw new AnnotationCommunityError("LITERATURE_CANDIDATE_NOT_FOUND", 404);
    }
    const primary = record.identifiers[0];
    if (!primary || !isConfirmableLiteratureIdentifierKind(primary.kind) || primary.source !== "public_registry") {
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
    const evidenceCandidates = [verifiedCandidate, ...(Array.isArray(verifiedCandidate.corroborations) ? verifiedCandidate.corroborations : [])];
    if (new Set(evidenceCandidates.map((candidate) => candidate?.provider)).size !== evidenceCandidates.length) {
      throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_INVALID");
    }
    for (const candidate of evidenceCandidates) {
      const candidateRecord = candidate?.record;
      const primary = candidateRecord?.identifiers?.[0];
      if (!confirmedLiteratureProviders.has(candidate?.provider) || !candidate?.candidateKey || !primary ||
        !isConfirmableLiteratureIdentifierKind(primary.kind) ||
        primary.source !== "public_registry" || candidateRecord.identifiers.some((identifier) => identifier.source !== "public_registry")) {
        throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_INVALID");
      }
      const expectedKey = primary ? `${candidate.provider}:${primary.kind}:${normalizeIdentity(primary.kind, primary.value)}` : "";
      if (candidate.candidateKey !== expectedKey || hasCrossVersionIdentifierConflict(candidateRecord)) {
        throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      }
      if (candidate !== verifiedCandidate && !sameLiteratureVersionBibliography(record, candidateRecord)) {
        throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      }
    }
    const input = {
      authors: [...(record.authors ?? [])],
      documentType: record.documentType,
      identifiers: evidenceCandidates.flatMap((candidate) => candidate.record.identifiers.map((identifier) => ({ ...identifier }))),
      title: record.title,
      year: record.year
    };
    if (!input.identifiers.some((identifier) => isConfirmableLiteratureIdentifierKind(identifier.kind))) {
      throw new AnnotationCommunityError("LITERATURE_IDENTITY_REQUIRED");
    }
    const normalized = [...new Map(input.identifiers.map((identifier) => {
      const value = normalizeIdentity(identifier.kind, identifier.value);
      return [`${identifier.kind}:${value}`, { ...identifier, value }];
    })).values()];
    return withTransaction(this.pool, async (client) => {
      const providerRecords = evidenceCandidates.map((candidate) => ({
        candidate,
        providerRecordId: normalizeIdentity(candidate.record.identifiers[0].kind, candidate.record.identifiers[0].value)
      }));
      const lockOrder = [...normalized].sort((left, right) => `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`));
      for (const { candidate, providerRecordId } of providerRecords) {
        lockOrder.push({ kind: `provider:${candidate.provider}`, value: providerRecordId });
      }
      try {
        lockOrder.push({ kind: "provider-bibliography", value: titleAuthorsYearFingerprint(input) });
      } catch {
        // Incomplete bibliographies cannot participate in independent-source reuse.
      }
      for (const identifier of lockOrder) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${identifier.kind}:${identifier.value}`]);
      }
      const identityMatches = await this.#matchingLiteratureIds(normalized, client, true);
      const claimResults = [];
      for (const { candidate, providerRecordId } of providerRecords) {
        claimResults.push(await client.query(`
          SELECT identifier.literature_id, claim.identifier_id
            FROM literature_identity_claims claim
            JOIN literature_identifiers identifier ON identifier.id = claim.identifier_id
           WHERE claim.provider = $1 AND claim.provider_record_id = $2
           FOR UPDATE OF claim
        `, [candidate.provider, providerRecordId]));
      }
      const matched = new Set(identityMatches);
      for (const claimResult of claimResults) if (claimResult.rows[0]) matched.add(claimResult.rows[0].literature_id);
      const providerBibliographyMatches = new Set();
      for (const candidate of evidenceCandidates) {
        for (const literatureId of await this.#independentProviderBibliographyMatches(input, candidate.provider, client)) {
          providerBibliographyMatches.add(literatureId);
        }
      }
      for (const literatureId of providerBibliographyMatches) {
        matched.add(literatureId);
      }
      if (matched.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      const now = new Date();
      const literatureId = [...matched][0] ?? `literature_${randomUUID()}`;
      const existingResult = matched.size ? await client.query("SELECT * FROM literature_records WHERE id = $1 FOR UPDATE", [literatureId]) : { rows: [] };
      const existing = existingResult.rows[0];
      if (existing && !sameLiteratureBibliography(input, {
        authors: existing.authors,
        title: existing.title,
        year: existing.publication_year
      })) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
      if (!existing) {
        await client.query(`INSERT INTO literature_records(id, title, authors, publication_year, version_kind, record_source, source_provider, confirmed_at, revision, confirmation_status)
          VALUES ($1, $2, $3::jsonb, $4, $5, 'public_registry', $6, $7, 1, 'confirmed')`, [literatureId, input.title, JSON.stringify(input.authors), input.year ?? null, input.documentType ?? null, provider, now]);
      } else {
        const currentAuthors = JSON.stringify(existing.authors ?? []);
        const nextAuthors = JSON.stringify(input.authors);
        const existingIdentities = (await client.query("SELECT identifier_kind AS kind, normalized_value AS value FROM literature_identifiers WHERE literature_id = $1 ORDER BY identifier_kind, normalized_value", [literatureId])).rows;
        const existingIdentityKeys = new Set(existingIdentities.map((identifier) => `${identifier.kind}:${normalizeIdentity(identifier.kind, identifier.value)}`));
        const identityAddition = normalized.some((identifier) => !existingIdentityKeys.has(`${identifier.kind}:${identifier.value}`));
        const changed = existing.title !== input.title || currentAuthors !== nextAuthors || existing.publication_year !== (input.year ?? null) || existing.version_kind !== (input.documentType ?? null) || existing.confirmation_status !== "confirmed" || existing.source_provider !== provider || identityAddition || claimResults.some((result) => !result.rows[0]);
        if (changed) {
          const current = await this.#literatureSnapshot(literatureId, client);
          const revision = Number(existing.revision ?? 1);
          await client.query("INSERT INTO literature_record_versions(id, literature_id, revision, snapshot, changed_by, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (literature_id, revision) DO NOTHING", [`literature_record_version_${randomUUID()}`, literatureId, revision, JSON.stringify(current), literatureResolverActor, now]);
          await client.query(`UPDATE literature_records SET title = $2, authors = $3::jsonb, publication_year = $4, version_kind = $5, record_source = 'public_registry', source_provider = $6, confirmed_at = $7, revision = $8, confirmation_status = 'confirmed', updated_at = $9 WHERE id = $1`, [literatureId, input.title, nextAuthors, input.year ?? null, input.documentType ?? null, provider, now, revision + 1, now]);
        }
      }
      for (const identifier of normalized) {
        await client.query("INSERT INTO literature_identifiers(id, literature_id, identifier_kind, identifier_role, normalized_value, is_legacy_alias, created_at) VALUES ($1, $2, $3, $4, $5, false, $6) ON CONFLICT (literature_id, identifier_kind, normalized_value) DO NOTHING", [`literature_identifier_${randomUUID()}`, literatureId, identifier.kind, literatureIdentifierRole(identifier.kind), identifier.value, now]);
      }
      const identifierResult = await client.query("SELECT id, identifier_kind AS kind, normalized_value AS value FROM literature_identifiers WHERE literature_id = $1 ORDER BY identifier_kind, normalized_value", [literatureId]);
      for (const { candidate, providerRecordId } of providerRecords) {
        const claimIdentifier = selectLiteratureClaimIdentifier(identifierResult.rows, candidate.provider);
        if (!claimIdentifier?.id) throw new AnnotationCommunityError("LITERATURE_IDENTITY_REQUIRED");
        const relations = normalizeLiteratureRelations(candidate.relations);
        const claimEvidence = {
          candidateKey: candidate.candidateKey,
          confirmationBasis: evidenceCandidates.length > 1 || providerBibliographyMatches.size > 0
            ? "independent_provider_bibliography"
            : aggregateLiteratureProviders.has(candidate.provider)
              ? "user_selected_refetch"
              : "primary_registry_refetch",
          ...(candidate.recordUrl ? { recordUrl: candidate.recordUrl } : {}),
          ...(relations.length ? { relations } : {}),
          sourceTier: new Set(["crossref", "arxiv"]).has(candidate.provider) ? "primary" : "aggregate"
        };
        await client.query(`INSERT INTO literature_identity_claims(id, identifier_id, provider, provider_record_id, verification_status, evidence, observed_at, created_at)
          VALUES ($1, $2, $3, $4, 'confirmed', $5::jsonb, $6, $6)
          ON CONFLICT (provider, provider_record_id) DO UPDATE SET
            identifier_id = excluded.identifier_id,
            verification_status = excluded.verification_status,
            evidence = excluded.evidence,
            observed_at = excluded.observed_at
          WHERE EXISTS (
            SELECT 1 FROM literature_identifiers current_identifier
             WHERE current_identifier.id = literature_identity_claims.identifier_id
               AND current_identifier.literature_id = $7
          )`, [
          `literature_claim_${randomUUID()}`,
          claimIdentifier.id,
          candidate.provider,
          providerRecordId,
          JSON.stringify(claimEvidence),
          now,
          literatureId
        ]);
        await this.#confirmEvidenceRelations(literatureId, candidate.provider, candidate.candidateKey, relations, now, client);
      }
      await this.#backfillEvidenceRelations(normalized, literatureId, now, client);
      if (!existing) {
        const snapshot = await this.#literatureRecord(literatureId, client);
        await client.query("INSERT INTO literature_record_versions(id, literature_id, revision, snapshot, changed_by, created_at) VALUES ($1, $2, 1, $3::jsonb, $4, $5)", [`literature_record_version_${randomUUID()}`, literatureId, JSON.stringify(snapshot), literatureResolverActor, now]);
      }
      return this.#literatureRecord(literatureId, client);
    });
  }

  async verifyLiteratureProjection(literatureId, revision, client = this.pool) {
    const record = await this.#literatureRecord(String(literatureId ?? "").trim(), client);
    return record && record.revision === revision ? record : null;
  }

  async confirmLiteratureRelation(input) {
    return withTransaction(this.pool, async (client) => {
      const [from, to] = await Promise.all([
        this.#literatureRecord(input?.fromLiteratureId, client),
        this.#literatureRecord(input?.toLiteratureId, client)
      ]);
      if (!from || !to || from.literatureId === to.literatureId) throw new AnnotationCommunityError("LITERATURE_RELATION_INVALID");
      if (!input?.evidence || typeof input.evidence !== "object" || Array.isArray(input.evidence) ||
        Object.keys(input.evidence).length === 0) {
        throw new AnnotationCommunityError("LITERATURE_RELATION_EVIDENCE_REQUIRED");
      }
      const result = await client.query(`
        INSERT INTO literature_relations(id, from_literature_id, to_literature_id, relation_type, provider, verification_status, evidence)
        VALUES ($1, $2, $3, $4, $5, 'confirmed', $6::jsonb)
        ON CONFLICT (from_literature_id, to_literature_id, relation_type)
        DO UPDATE SET evidence = literature_relations.evidence
        RETURNING *
      `, [`literature_relation_${randomUUID()}`, from.literatureId, to.literatureId, input.relationType, input.provider, JSON.stringify(input.evidence)]);
      return result.rows[0];
    });
  }

  async findLiteratureRelations(literatureId, client = this.pool) {
    const result = await client.query("SELECT * FROM literature_relations WHERE from_literature_id = $1 OR to_literature_id = $1 ORDER BY created_at, id", [literatureId]);
    return result.rows.map((row) => ({
      createdAt: this.#timestamp(row.created_at),
      evidence: row.evidence,
      fromLiteratureId: row.from_literature_id,
      provider: row.provider,
      relationType: row.relation_type,
      toLiteratureId: row.to_literature_id,
      verificationStatus: row.verification_status
    }));
  }

  async profile(userId, client = this.pool) {
    const profile = await client.query(
      "SELECT education_stage, revision FROM community_user_profiles WHERE user_id = $1",
      [userId]
    );
    const institutions = await client.query(
      "SELECT institution_name AS name FROM community_profile_institutions WHERE user_id = $1 ORDER BY position",
      [userId]
    );
    return {
      educationStage: profile.rows[0]?.education_stage ?? null,
      institutions: institutions.rows,
      revision: Number(profile.rows[0]?.revision ?? 0)
    };
  }

  async updateProfile(userId, input) {
    return withTransaction(this.pool, async (client) => {
      await client.query(`
        INSERT INTO community_user_profiles(user_id, education_stage)
        VALUES ($1, $2)
        ON CONFLICT(user_id) DO UPDATE SET education_stage = EXCLUDED.education_stage,
          revision = community_user_profiles.revision + 1, updated_at = now()
      `, [userId, input.educationStage]);
      await client.query("DELETE FROM community_profile_institutions WHERE user_id = $1", [userId]);
      for (const [position, institution] of input.institutions.entries()) {
        await client.query("INSERT INTO community_profile_institutions(user_id, institution_name, position) VALUES ($1, $2, $3)", [userId, institution.name, position]);
      }
      return this.profile(userId, client);
    });
  }

  async createHandoff(ownerId, input) {
    const id = `handoff_${randomUUID()}`;
    const result = await this.pool.query(`INSERT INTO desktop_annotation_handoffs(id, owner_id, payload, expires_at) VALUES ($1, $2, $3::jsonb, now() + interval '5 minutes') RETURNING expires_at`, [id, ownerId, JSON.stringify(input)]);
    return { expiresAt: result.rows[0].expires_at, handoffId: id };
  }

  async consumeHandoff(id, ownerId) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query("SELECT * FROM desktop_annotation_handoffs WHERE id = $1 FOR UPDATE", [id]);
      const row = result.rows[0];
      if (!row) throw new AnnotationCommunityError("HANDOFF_NOT_FOUND", 404);
      if (row.owner_id !== ownerId) throw new AnnotationCommunityError("HANDOFF_FORBIDDEN", 403);
      if (row.expires_at <= new Date()) throw new AnnotationCommunityError("HANDOFF_EXPIRED", 410);
      const replayed = Boolean(row.consumed_at);
      if (!replayed) await client.query("UPDATE desktop_annotation_handoffs SET consumed_at = now() WHERE id = $1", [id]);
      return { draft: row.payload, replayed };
    });
  }

  async syncDesktopAnnotations(author, items) {
    return this.#withDesktopPublicationLifecycle(author, items,
      () => items.map((item) => this.#publicationFailure(item, "ANNOTATION_PUBLICATION_OWNER_DELETED")),
      async (client) => {
        const results = [];
        for (const item of items) {
          const priorResult = await client.query("SELECT * FROM desktop_annotation_syncs WHERE owner_id = $1 AND queue_key = $2 FOR UPDATE", [author.id, item.queueKey]);
          const prior = priorResult.rows[0];
          const id = prior?.annotation_id ?? `annotation_${randomUUID()}`;
          if (!prior) {
            await client.query(`INSERT INTO annotations(id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, share_to_plaza, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'public', true, $7, $8)`, [id, item.body, author.id, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), item.createdAt, item.updatedAt]);
            await this.#replaceTargets(client, id, item.targets, author.id);
            await this.#assignPlatformTags(client, id, item.body, []);
            await client.query(`INSERT INTO desktop_annotation_syncs(owner_id, queue_key, source_annotation_id, annotation_id, source_created_at, source_updated_at) VALUES ($1, $2, $3, $4, $5, $6)`, [author.id, item.queueKey, item.annotationId, id, item.createdAt, item.updatedAt]);
          } else if (new Date(item.updatedAt) >= prior.source_updated_at) {
            await client.query(`UPDATE annotations SET body = $2, author_name = $3, author_initials = $4, author_profile_snapshot = $5::jsonb, revision = revision + 1, updated_at = $6 WHERE id = $1`, [id, item.body, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), item.updatedAt]);
            await this.#replaceTargets(client, id, item.targets, author.id);
            await this.#assignPlatformTags(client, id, item.body, []);
            await client.query(`UPDATE desktop_annotation_syncs SET source_annotation_id = $3, source_updated_at = $4, updated_at = now() WHERE owner_id = $1 AND queue_key = $2`, [author.id, item.queueKey, item.annotationId, item.updatedAt]);
          }
          results.push({ annotationId: item.annotationId, intuechoAnnotationId: id, queueKey: item.queueKey, status: "synced", syncedAt: new Date().toISOString() });
        }
        return results;
      });
  }

  async applyDesktopAnnotationPublications(author, operations) {
    return this.#withDesktopPublicationLifecycle(author, operations,
      () => operations.map((operation) => this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_OWNER_DELETED")),
      async (client) => {
        const results = [];
        for (const operation of operations) {
          const operationDigest = desktopAnnotationPublicationDigest(operation);
          const priorResult = await client.query("SELECT * FROM desktop_annotation_publications WHERE owner_id = $1 AND queue_key = $2 FOR UPDATE", [author.id, operation.queueKey]);
          const prior = priorResult.rows[0];
          if (prior && prior.source_annotation_id !== operation.annotationId) {
            results.push(this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_QUEUE_CONFLICT"));
            continue;
          }
          if (prior && this.#publicationIsStale(prior, operation)) {
            results.push(this.#publicationFailure(operation, "STALE_ANNOTATION_PUBLICATION"));
            continue;
          }
          if (prior && Number(prior.source_revision) === operation.revision && new Date(prior.source_updated_at).getTime() === new Date(operation.updatedAt).getTime()) {
            if (prior.operation_digest !== operationDigest) {
              results.push(this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_VERSION_CONFLICT"));
              continue;
            }
            results.push(this.#publicationResult(operation, prior));
            continue;
          }
          if (operation.operation === "retract") {
            results.push(await this.#retractDesktopPublication(client, author, operation, operationDigest, prior));
          } else {
            results.push(await this.#upsertDesktopPublication(client, author, operation, operationDigest, prior));
          }
        }
        return results;
      });
  }

  async #withDesktopPublicationLifecycle(author, items, deletedResult, operation) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${author.id}`]);
      const deleted = await client.query("SELECT 1 FROM account_deletion_jobs WHERE subject_id = $1", [author.id]);
      if (deleted.rows[0]) return deletedResult();
      const queueKeys = [...new Set(items.map((item) => item.queueKey))].sort();
      for (const queueKey of queueKeys) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`desktop-publication:${author.id}:${queueKey}`]);
      }
      return operation(client);
    });
  }

  #timestamp(value) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  #publicationFailure(operation, error) {
    return { annotationId: operation.annotationId, error, queueKey: operation.queueKey };
  }

  #publicationIsStale(prior, operation) {
    if (operation.revision < Number(prior.source_revision)) return true;
    if (operation.revision === Number(prior.source_revision)) return new Date(prior.source_updated_at).getTime() !== new Date(operation.updatedAt).getTime();
    return Date.parse(operation.updatedAt) < Date.parse(prior.source_updated_at);
  }

  #publicationResult(operation, row) {
    return {
      annotationId: operation.annotationId,
      queueKey: operation.queueKey,
      remoteAnnotationId: row.annotation_id,
      remoteRevision: Number(row.remote_revision),
      state: row.state,
      syncedAt: this.#timestamp(row.synced_at)
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

  async #upsertDesktopPublication(client, author, operation, operationDigest, prior) {
    const confirmed = await this.#literatureRecord(operation.literatureId, client);
    if (!confirmed) return this.#publicationFailure(operation, "LITERATURE_NOT_FOUND");
    const id = prior?.annotation_id ?? `annotation_${randomUUID()}`;
    let remoteRevision = 1;
    if (!prior) {
      await client.query(`INSERT INTO annotations(id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'public', NULL, true, 1, $7, $7)`, [id, operation.body, author.id, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), operation.updatedAt]);
    } else {
      const annotation = await client.query("SELECT revision FROM annotations WHERE id = $1 AND author_id = $2 FOR UPDATE", [id, author.id]);
      if (!annotation.rows[0]) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_NOT_FOUND");
      remoteRevision = Number(annotation.rows[0].revision) + 1;
      await client.query("UPDATE annotations SET body = $2, author_name = $3, author_initials = $4, author_profile_snapshot = $5::jsonb, visibility = 'public', organization_id = NULL, share_to_plaza = true, revision = $6, updated_at = $7 WHERE id = $1", [id, operation.body, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), remoteRevision, operation.updatedAt]);
    }
    await this.#replaceTargets(client, id, [this.#publicationTarget(confirmed.literatureId, operation.sourcePassage)], author.id);
    await this.#assignPlatformTags(client, id, operation.body, []);
    const syncedAt = new Date().toISOString();
    if (!prior) {
      await client.query("INSERT INTO desktop_annotation_publications(owner_id, queue_key, source_annotation_id, annotation_id, source_revision, source_updated_at, operation_digest, state, remote_revision, synced_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, $9)", [author.id, operation.queueKey, operation.annotationId, id, operation.revision, operation.updatedAt, operationDigest, remoteRevision, syncedAt]);
    } else {
      await client.query("UPDATE desktop_annotation_publications SET source_revision = $3, source_updated_at = $4, operation_digest = $5, state = 'published', remote_revision = $6, synced_at = $7 WHERE owner_id = $1 AND queue_key = $2", [author.id, operation.queueKey, operation.revision, operation.updatedAt, operationDigest, remoteRevision, syncedAt]);
    }
    return this.#publicationResult(operation, { annotation_id: id, remote_revision: remoteRevision, state: "published", synced_at: syncedAt });
  }

  async #retractDesktopPublication(client, author, operation, operationDigest, prior) {
    if (!prior) return this.#publicationFailure(operation, "ANNOTATION_PUBLICATION_NOT_FOUND");
    if (prior.annotation_id !== operation.remoteAnnotationId) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_MISMATCH");
    const annotation = await client.query("SELECT revision FROM annotations WHERE id = $1 AND author_id = $2 FOR UPDATE", [prior.annotation_id, author.id]);
    if (!annotation.rows[0]) return this.#publicationFailure(operation, "REMOTE_ANNOTATION_NOT_FOUND");
    const remoteRevision = Number(annotation.rows[0].revision) + 1;
    await client.query("UPDATE annotations SET visibility = 'private', organization_id = NULL, share_to_plaza = false, revision = $2, updated_at = $3 WHERE id = $1", [prior.annotation_id, remoteRevision, operation.updatedAt]);
    const syncedAt = new Date().toISOString();
    await client.query("UPDATE desktop_annotation_publications SET source_revision = $3, source_updated_at = $4, operation_digest = $5, state = 'retracted', remote_revision = $6, synced_at = $7 WHERE owner_id = $1 AND queue_key = $2", [author.id, operation.queueKey, operation.revision, operation.updatedAt, operationDigest, remoteRevision, syncedAt]);
    return this.#publicationResult(operation, { annotation_id: prior.annotation_id, remote_revision: remoteRevision, state: "retracted", synced_at: syncedAt });
  }

  async communityRecommendations(scope, viewer = null) {
    const annotations = await this.plaza(viewer, { limit: 20, literatureId: scope.literatureId, sort: "recommended" });
    const viewerProfile = viewer?.id ? await this.profile(viewer.id) : null;
    const ranked = [];
    for (const annotation of annotations) ranked.push({ annotation, compatibility: await this.#recommendationCompatibility(annotation, scope, viewer, viewerProfile) });
    return ranked.sort((left, right) => right.compatibility - left.compatibility || String(right.annotation.createdAt).localeCompare(String(left.annotation.createdAt))).map(({ annotation, compatibility }) => ({
      compatibility,
      id: annotation.id,
      note: annotation.body,
      literatureId: scope.literatureId,
      relationship: annotation.targets.some((target) => target.kind === "source_passage" || target.kind === "derived_passage") ? "同一文献字句的共享批注" : "同一文献的共享批注",
      source: "intuecho_community"
    }));
  }

  async #recommendationCompatibility(annotation, scope, viewer, viewerProfile) {
    const passageTargets = annotation.targets.filter((target) => target.kind !== "whole_document");
    const evidenceIds = new Set([...(scope.evidenceIds ?? []), ...(scope.externalSourceIds ?? [])]);
    const passageMatch = evidenceIds.size > 0 && passageTargets.some((target) => {
      const hashes = [target.anchorHash, ...(target.evidence ?? []).map((item) => item.anchorHash)].filter(Boolean);
      return hashes.some((hash) => [...evidenceIds].some((id) => hash === id || hash.endsWith(`:${id}`)));
    });
    const sameStage = Boolean(viewerProfile?.educationStage && viewerProfile.educationStage === annotation.author.profile.educationStage);
    const viewerInstitutions = new Set(viewerProfile?.institutions.map((item) => item.name) ?? []);
    const sameInstitution = annotation.author.profile.institutions.some((item) => viewerInstitutions.has(item.name));
    const mutual = viewer?.id ? await this.#mutual(viewer.id, annotation.author.id) : false;
    const ratingConfidence = annotation.ratingCount ? (annotation.ratingAverage / 5) * Math.min(1, Math.log2(annotation.ratingCount + 1) / 3) : 0;
    const score = 0.45 + (passageTargets.length ? 0.08 : 0) + (passageMatch ? 0.17 : 0) + ratingConfidence * 0.15 + (sameStage ? 0.04 : 0) + (sameInstitution ? 0.04 : 0) + (mutual ? 0.07 : 0);
    return Number(Math.min(1, score).toFixed(4));
  }

  async #profileSnapshot(userId, client) {
    const profile = await this.profile(userId, client);
    return { educationStage: profile.educationStage, institutions: profile.institutions };
  }

  async #literatureRecord(id, client = this.pool) {
    const result = await client.query("SELECT * FROM literature_records WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row || row.confirmation_status !== "confirmed") return null;
    return this.#literatureSnapshot(id, client, row);
  }

  async #literatureSnapshot(id, client = this.pool, providedRow = null) {
    const result = providedRow ? { rows: [providedRow] } : await client.query("SELECT * FROM literature_records WHERE id = $1", [id]);
    const row = result.rows[0];
    if (!row) return null;
    const identities = row.confirmation_status === "confirmed"
      ? await client.query("SELECT identifier_kind AS kind, identifier_role AS role, CASE identifier_role WHEN 'candidate_alias' THEN 'metadata' ELSE 'public_registry' END AS source, normalized_value AS value FROM literature_identifiers WHERE literature_id = $1 ORDER BY identifier_kind, normalized_value", [id])
      : await client.query("SELECT identity_kind AS kind, identity_source AS source, identity_value AS value FROM literature_identities WHERE literature_id = $1 ORDER BY identity_kind, identity_value", [id]);
    if (row.confirmation_status !== "confirmed") {
      return {
        authors: Array.isArray(row.authors) ? row.authors : [],
        identifiers: identities.rows,
        literatureId: row.id,
        recordSource: row.record_source,
        status: "legacy_unverified",
        title: row.title,
        ...(row.version_kind ? { documentType: row.version_kind } : {}),
        ...(row.publication_year === null || row.publication_year === undefined ? {} : { year: row.publication_year })
      };
    }
    const confirmedAtValue = row.confirmed_at ?? row.updated_at;
    const confirmedAt = confirmedAtValue instanceof Date ? confirmedAtValue.toISOString() : new Date(confirmedAtValue).toISOString();
    return {
      authors: Array.isArray(row.authors) ? row.authors : [],
      ...(row.version_kind ? { documentType: row.version_kind } : {}),
      identifiers: identities.rows,
      literatureId: row.id,
      provenance: {
        confirmedAt,
        mode: "public_registry",
        ...(row.source_provider ? { provider: row.source_provider } : {})
      },
      revision: Number(row.revision),
      status: "confirmed",
      title: row.title,
      ...(row.publication_year === null || row.publication_year === undefined ? {} : { year: row.publication_year })
    };
  }

  async #confirmedLiteratureByIdentifier(identifier, client = this.pool) {
    const result = await client.query(`
      SELECT literature.id
        FROM literature_identifiers identifier
        JOIN literature_records literature ON literature.id = identifier.literature_id
       WHERE identifier.identifier_kind = $1
         AND identifier.normalized_value = $2
         AND literature.confirmation_status = 'confirmed'
    `, [identifier.kind, normalizeIdentity(identifier.kind, identifier.value)]);
    return result.rows[0]?.id ?? null;
  }

  async #insertEvidenceRelation(fromLiteratureId, toLiteratureId, relation, provider, candidateKey, now, client = this.pool) {
    if (!fromLiteratureId || !toLiteratureId || fromLiteratureId === toLiteratureId) return;
    await client.query(`
      INSERT INTO literature_relations(
        id, from_literature_id, to_literature_id, relation_type,
        provider, verification_status, evidence, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'confirmed', $6::jsonb, $7)
      ON CONFLICT (from_literature_id, to_literature_id, relation_type) DO NOTHING
    `, [
      `literature_relation_${randomUUID()}`,
      fromLiteratureId,
      toLiteratureId,
      relation.relationType,
      provider,
      JSON.stringify({
        candidateKey,
        ...relation.evidence,
        targetIdentifier: relation.targetIdentifier
      }),
      now
    ]);
  }

  async #confirmEvidenceRelations(literatureId, provider, candidateKey, relations, now, client = this.pool) {
    for (const relation of relations) {
      const targetLiteratureId = await this.#confirmedLiteratureByIdentifier(relation.targetIdentifier, client);
      if (!targetLiteratureId) continue;
      const fromLiteratureId = relation.direction === "from_current" ? literatureId : targetLiteratureId;
      const toLiteratureId = relation.direction === "from_current" ? targetLiteratureId : literatureId;
      await this.#insertEvidenceRelation(fromLiteratureId, toLiteratureId, relation, provider, candidateKey, now, client);
    }
  }

  async #backfillEvidenceRelations(identifiers, literatureId, now, client = this.pool) {
    const targetKeys = new Set(identifiers.map((identifier) => `${identifier.kind}:${normalizeIdentity(identifier.kind, identifier.value)}`));
    const result = await client.query(`
      SELECT claim.provider, claim.evidence, identifier.literature_id
        FROM literature_identity_claims claim
        JOIN literature_identifiers identifier ON identifier.id = claim.identifier_id
        JOIN literature_records literature ON literature.id = identifier.literature_id
       WHERE literature.confirmation_status = 'confirmed'
         AND claim.evidence ? 'relations'
    `);
    for (const claim of result.rows) {
      for (const relation of normalizeLiteratureRelations(claim.evidence?.relations)) {
        const targetKey = `${relation.targetIdentifier.kind}:${relation.targetIdentifier.value}`;
        if (!targetKeys.has(targetKey)) continue;
        const fromLiteratureId = relation.direction === "from_current" ? claim.literature_id : literatureId;
        const toLiteratureId = relation.direction === "from_current" ? literatureId : claim.literature_id;
        await this.#insertEvidenceRelation(fromLiteratureId, toLiteratureId, relation, claim.provider, claim.evidence?.candidateKey, now, client);
      }
    }
  }

  async #matchingLiteratureIds(identifiers, client = this.pool, lock = false) {
    const keys = new Set((identifiers ?? []).map((identifier) => `${identifier.kind}:${normalizeIdentity(identifier.kind, identifier.value)}`));
    const kinds = [...new Set((identifiers ?? []).map((identifier) => identifier.kind))];
    if (kinds.length === 0) return new Set();
    const result = await client.query("SELECT literature_id, identifier_kind, normalized_value FROM literature_identifiers WHERE identifier_kind = ANY($1::text[])", [kinds]);
    const literatureIds = new Set();
    for (const row of result.rows) {
      if (keys.has(`${row.identifier_kind}:${normalizeIdentity(row.identifier_kind, row.normalized_value)}`)) literatureIds.add(row.literature_id);
    }
    if (lock && literatureIds.size > 0) {
      await client.query("SELECT literature_id FROM literature_identifiers WHERE literature_id = ANY($1::text[]) FOR UPDATE", [[...literatureIds]]);
    }
    if (literatureIds.size > 1) throw new LiteratureIdentityConflictError("LITERATURE_IDENTITY_CONFLICT");
    return literatureIds;
  }

  async #independentProviderBibliographyMatches(input, provider, client = this.pool) {
    if (!confirmedLiteratureProviders.has(provider) || !Number.isInteger(input.year)) return new Set();
    const result = await client.query(`
      SELECT DISTINCT identifier.literature_id
        FROM literature_identity_claims claim
        JOIN literature_identifiers identifier ON identifier.id = claim.identifier_id
        JOIN literature_records literature ON literature.id = identifier.literature_id
       WHERE claim.provider <> $1
         AND ($1 = ANY($2::text[]) OR claim.provider = ANY($2::text[]))
         AND literature.confirmation_status = 'confirmed'
         AND literature.publication_year = $3
       ORDER BY identifier.literature_id
    `, [provider, [...aggregateLiteratureProviders], input.year]);
    const matches = [];
    for (const row of result.rows) {
      const record = await this.#literatureRecord(row.literature_id, client);
      if (record && sameLiteratureVersionBibliography(input, record)) matches.push(record.literatureId);
    }
    return new Set(matches);
  }

  async #resolveLiterature(client, reference, changedBy) {
    if (reference?.literatureId) {
      const found = await client.query("SELECT 1 FROM literature_records WHERE id = $1 AND confirmation_status = 'confirmed'", [reference.literatureId]);
      if (!found.rows[0]) throw new AnnotationCommunityError("LITERATURE_NOT_FOUND", 404);
      return reference.literatureId;
    }
    throw new AnnotationCommunityError("LITERATURE_CONFIRMATION_REQUIRED", 409);
  }

  async #replaceTargets(client, annotationId, targets, changedBy) {
    await client.query("DELETE FROM annotation_targets WHERE annotation_id = $1", [annotationId]);
    for (const [targetPosition, target] of targets.entries()) {
      const targetId = `target_${randomUUID()}`;
      const literatureId = await this.#resolveLiterature(client, target.literature, changedBy);
      await client.query(`INSERT INTO annotation_targets(id, annotation_id, literature_id, target_kind, position, target) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [targetId, annotationId, literatureId, target.kind, targetPosition, JSON.stringify(target)]);
      if (target.kind === "derived_passage") {
        for (const [position, evidence] of target.evidence.entries()) {
          await client.query(`INSERT INTO annotation_target_evidence(target_id, position, literature_id, evidence) VALUES ($1, $2, $3, $4::jsonb)`, [targetId, position, await this.#resolveLiterature(client, evidence.literature, changedBy), JSON.stringify(evidence)]);
        }
      }
    }
  }

  async #replaceUserTags(client, annotationId, values) {
    await client.query("DELETE FROM annotation_tags WHERE annotation_id = $1 AND origin = 'user'", [annotationId]);
    for (const name of uniqueTags(values)) {
      const slug = tagSlug(name);
      const tag = await client.query(`INSERT INTO tags(id, slug, name) VALUES ($1, $2, $3) ON CONFLICT(slug) DO UPDATE SET name = tags.name RETURNING id`, [`tag_${randomUUID()}`, slug, name]);
      await client.query(`INSERT INTO annotation_tags(annotation_id, tag_id, origin, state) VALUES ($1, $2, 'user', 'active')`, [annotationId, tag.rows[0].id]);
    }
  }

  async #assignPlatformTags(client, annotationId, body, userTags) {
    await client.query("DELETE FROM annotation_tags WHERE annotation_id = $1 AND origin = 'platform' AND state = 'active'", [annotationId]);
    const excluded = new Set(uniqueTags(userTags).map(tagSlug));
    const examples = await client.query(`
      SELECT tags.id AS tag_id, tags.slug, tags.name, annotations.body
        FROM annotation_tags assigned
        JOIN tags ON tags.id = assigned.tag_id
        JOIN annotations ON annotations.id = assigned.annotation_id
       WHERE assigned.origin = 'user' AND assigned.state = 'active'
         AND assigned.annotation_id <> $1 AND annotations.withdrawn_at IS NULL
       ORDER BY annotations.updated_at DESC LIMIT 2000
    `, [annotationId]);
    const best = new Map();
    for (const example of examples.rows) {
      if (excluded.has(example.slug)) continue;
      const score = localSemanticSimilarity(body, `${example.name} ${example.body}`);
      const current = best.get(example.slug);
      if (!current || score > current.score) best.set(example.slug, { ...example, score });
    }
    for (const candidate of best.values()) {
      if (candidate.score < 0.48) continue;
      await client.query(`INSERT INTO annotation_tags(annotation_id, tag_id, origin, state, confidence, classifier_version) VALUES ($1, $2, 'platform', 'active', $3, 'local-semantic-v1') ON CONFLICT(annotation_id, tag_id, origin) DO NOTHING`, [annotationId, candidate.tag_id, candidate.score]);
    }
  }

  async #row(id, client = this.pool, lock = false) {
    const result = await client.query(`SELECT * FROM annotations WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
    return result.rows[0] ?? null;
  }

  async #mutual(first, second, client = this.pool) {
    if (!first || !second) return false;
    const result = await client.query(`SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $1 AND followed_id = $2) AND EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $2 AND followed_id = $1) AS mutual`, [first, second]);
    return Boolean(result.rows[0].mutual);
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

  async #canView(row, viewer, client = this.pool) {
    const rootAudience = await this.#rootAudience(row, client);
    if (!rootAudience) return false;
    if (row.author_id === viewer?.id || rootAudience.author_id === viewer?.id) return true;
    if (row.visibility === "public") return true;
    if (row.visibility === "mutual_followers") {
      return this.#mutual(rootAudience.author_id, viewer?.id, client);
    }
    if (row.visibility === "organization" && viewer?.id) {
      return this.#organizationVisible({ organizationId: row.organization_id, userId: viewer.id });
    }
    return false;
  }

  async #rootAudience(row, client = this.pool) {
    const seen = new Set();
    let current = row;
    while (current) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      let parentId = current.parent_annotation_id;
      if (current.source_reply_id) {
        const reply = await this.#replyRow(current.source_reply_id, client);
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
      const parent = await this.#row(parentId, client);
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
    if (input.visibility === "organization" && !await this.#organizationVisible({ organizationId: input.organizationId, userId: author.id })) {
      throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
    }
    return withTransaction(this.pool, async (client) => {
      const id = `annotation_${randomUUID()}`;
      await client.query(`
        INSERT INTO annotations(id, parent_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, organization_id, share_to_plaza)
        VALUES ($1, NULL, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      `, [id, input.body, author.id, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), input.visibility, input.organizationId ?? null, input.shareToPlaza]);
      await this.#replaceTargets(client, id, input.targets, author.id);
      await this.#replaceUserTags(client, id, input.tags);
      await this.#assignPlatformTags(client, id, input.body, input.tags);
      return this.annotation(id, author, client);
    });
  }

  async updateAnnotation(id, author, update) {
    return withTransaction(this.pool, async (client) => {
      const authorizedRow = await this.#row(id, client, true);
      if (!authorizedRow || authorizedRow.withdrawn_at) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      if (authorizedRow.author_id !== author.id) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
      if (authorizedRow.source_reply_id && update.body !== undefined) throw new AnnotationCommunityError("DERIVED_BODY_READ_ONLY");
      if (authorizedRow.source_reply_id && (update.visibility !== undefined || update.organizationId !== undefined || update.shareToPlaza !== undefined)) {
        throw new AnnotationCommunityError("REPLY_VISIBILITY_MISMATCH");
      }
      const visibility = update.visibility ?? authorizedRow.visibility;
      const organizationId = update.organizationId === undefined ? authorizedRow.organization_id : update.organizationId;
      const shareToPlaza = update.shareToPlaza ?? authorizedRow.share_to_plaza;
      const targetCount = update.targets ? update.targets.length : Number((await client.query("SELECT count(*) FROM annotation_targets WHERE annotation_id = $1", [id])).rows[0].count);
      if (targetCount === 0) throw new AnnotationCommunityError("ANNOTATION_TARGET_REQUIRED");
      if (shareToPlaza && visibility !== "public") throw new AnnotationCommunityError("PLAZA_REQUIRES_PUBLIC_VISIBILITY");
      if ((visibility === "organization") !== Boolean(organizationId)) throw new AnnotationCommunityError("INVALID_ANNOTATION_VISIBILITY");
      if (visibility === "organization" && !await this.#organizationVisible({ organizationId, userId: author.id })) throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
      const row = await this.#row(id, client, true);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || Number(row.revision) !== Number(authorizedRow.revision)) {
        throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      }
      const scopeChanged = visibility !== row.visibility || organizationId !== row.organization_id;
      if (scopeChanged && (await client.query("SELECT 1 FROM annotation_replies WHERE parent_annotation_id = $1 LIMIT 1", [id])).rows[0]) {
        throw new AnnotationCommunityError("ANNOTATION_SCOPE_LOCKED_BY_REPLIES", 409);
      }
      const oldTargets = await this.#targets(id, client, false);
      const oldTags = await this.#tags(id, client);
      await client.query(`INSERT INTO annotation_versions(id, annotation_id, revision, body, author_profile_snapshot, visibility, organization_id, share_to_plaza, targets, tags, changed_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`, [`annotation_version_${randomUUID()}`, id, row.revision, row.body, JSON.stringify(row.author_profile_snapshot), row.visibility, row.organization_id, row.share_to_plaza, JSON.stringify(oldTargets), JSON.stringify(oldTags), author.id]);
      await client.query(`UPDATE annotations SET body = $2, author_name = $3, author_initials = $4, author_profile_snapshot = $5::jsonb, visibility = $6, organization_id = $7, share_to_plaza = $8, revision = revision + 1, updated_at = now() WHERE id = $1`, [id, update.body ?? row.body, author.name, author.initials, JSON.stringify(await this.#profileSnapshot(author.id, client)), visibility, organizationId, shareToPlaza]);
      if (update.targets) await this.#replaceTargets(client, id, update.targets, author.id);
      if (update.tags) await this.#replaceUserTags(client, id, update.tags);
      const userTags = update.tags ?? (await client.query(`SELECT tags.name FROM annotation_tags JOIN tags ON tags.id = annotation_tags.tag_id WHERE annotation_tags.annotation_id = $1 AND annotation_tags.origin = 'user'`, [id])).rows.map((tag) => tag.name);
      await this.#assignPlatformTags(client, id, update.body ?? row.body, userTags);
      return this.annotation(id, author, client);
    });
  }

  async #targets(id, client = this.pool, hydrate = true) {
    const result = await client.query("SELECT id, literature_id, target FROM annotation_targets WHERE annotation_id = $1 ORDER BY position", [id]);
    if (!hydrate) return result.rows.map((row) => row.target);
    const targets = [];
    for (const row of result.rows) {
      const literatureRecord = await this.#literatureRecord(row.literature_id, client);
      const target = {
        ...row.target,
        literature: literatureRecord ? { ...row.target.literature, literatureRecord } : row.target.literature
      };
      if (row.target.kind === "derived_passage") {
        const evidence = await client.query("SELECT literature_id, evidence FROM annotation_target_evidence WHERE target_id = $1 ORDER BY position", [row.id]);
        target.evidence = [];
        for (const item of evidence.rows) {
          const record = await this.#literatureRecord(item.literature_id, client);
          target.evidence.push(record ? { ...item.evidence, literature: { ...item.evidence.literature, literatureRecord: record } } : item.evidence);
        }
      }
      targets.push(target);
    }
    return targets;
  }

  async #tags(id, client = this.pool) {
    const result = await client.query(`SELECT tags.name, annotation_tags.origin, annotation_tags.state, annotation_tags.confidence FROM annotation_tags JOIN tags ON tags.id = annotation_tags.tag_id WHERE annotation_tags.annotation_id = $1 AND annotation_tags.state <> 'removed' ORDER BY annotation_tags.origin, tags.name`, [id]);
    return result.rows;
  }

  async #serialize(row, viewer, client = this.pool) {
    const targets = await this.#targets(row.id, client);
    const tags = await this.#tags(row.id, client);
    const viewerState = viewer?.id
      ? await client.query(`SELECT (SELECT rating FROM annotation_ratings WHERE annotation_id = $1 AND user_id = $2) AS rating, EXISTS(SELECT 1 FROM annotation_saves WHERE annotation_id = $1 AND user_id = $2) AS saved`, [row.id, viewer.id])
      : { rows: [{ rating: null, saved: false }] };
    const rating = await client.query("SELECT count(*)::int AS count, avg(rating)::double precision AS average FROM annotation_ratings WHERE annotation_id = $1", [row.id]);
    const sourceReply = row.source_reply_id ? await client.query("SELECT parent_deleted_at FROM annotation_replies WHERE id = $1", [row.source_reply_id]) : { rows: [] };
    return {
      author: { id: row.author_id, initials: row.author_initials, name: row.author_name, profile: row.author_profile_snapshot },
      body: row.body,
      createdAt: row.created_at,
      id: row.id,
      organizationId: row.organization_id,
      originalReply: row.source_reply_id ? { replyId: row.source_reply_id, status: sourceReply.rows[0]?.parent_deleted_at ? "parent_deleted" : "available" } : null,
      ratingAverage: rating.rows[0].average === null ? null : Number(Number(rating.rows[0].average).toFixed(2)),
      ratingCount: Number(rating.rows[0].count),
      revision: Number(row.revision),
      shareToPlaza: row.share_to_plaza,
      tags,
      targets,
      updatedAt: row.updated_at,
      viewerCanModerate: false,
      viewerIsAuthor: Boolean(viewer?.id && row.author_id === viewer.id),
      viewerSaved: Boolean(viewerState.rows[0].saved),
      viewerRating: viewerState.rows[0].rating === null ? null : Number(viewerState.rows[0].rating),
      visibility: row.visibility,
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null
    };
  }

  async annotation(id, viewer, client = this.pool) {
    const authorizedRow = await this.#row(id, client);
    if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer, client)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const row = await this.#row(id, client);
    if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row, client)) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    return this.#serialize(row, viewer, client);
  }

  async #replyRow(id, client = this.pool, lock = false) {
    const result = await client.query(`
      SELECT reply.*, derived.withdrawn_at AS derived_withdrawn_at
        FROM annotation_replies reply
        LEFT JOIN annotations derived ON derived.id = reply.derived_annotation_id
       WHERE reply.id = $1
       ${lock ? "FOR UPDATE OF reply" : ""}
    `, [id]);
    return result.rows[0] ?? null;
  }

  #serializeReply(row, viewer) {
    return {
      author: { id: row.author_id, initials: row.author_initials, name: row.author_name, profile: row.author_profile_snapshot },
      body: row.body,
      createdAt: row.created_at,
      derivedAnnotationId: row.derived_annotation_id,
      derivedAnnotationState: !row.derived_annotation_id ? "none" : row.derived_withdrawn_at ? "withdrawn" : "published",
      id: row.id,
      parentAnnotationId: row.parent_annotation_id,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      viewerIsAuthor: Boolean(viewer?.id && row.author_id === viewer.id)
    };
  }

  async createReply(parentAnnotationId, author, input) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${author.id}`]);
      const parent = await this.#row(parentAnnotationId, client, true);
      if (!parent || parent.withdrawn_at || !await this.#canView(parent, author, client)) throw new AnnotationCommunityError("PARENT_ANNOTATION_NOT_FOUND", 404);
      if (parent.visibility === "organization" && !await this.#organizationVisible({ organizationId: parent.organization_id, userId: author.id })) {
        throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
      }
      const currentParent = await this.#row(parentAnnotationId, client, true);
      if (
        !currentParent ||
        !this.#sameAudienceState(parent, currentParent) ||
        Number(currentParent.revision) !== Number(parent.revision) ||
        currentParent.withdrawn_at ||
        !await this.#rootAudience(currentParent, client)
      ) {
        throw new AnnotationCommunityError("PARENT_ANNOTATION_NOT_FOUND", 404);
      }
      const effectiveParent = currentParent;
      const replyId = `reply_${randomUUID()}`;
      const derivedAnnotationId = input.publishAsAnnotation ? `annotation_${randomUUID()}` : null;
      const profile = JSON.stringify(await this.#profileSnapshot(author.id, client));
      await client.query(`INSERT INTO annotation_replies(id, parent_annotation_id, derived_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, organization_id) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, $9)`, [replyId, parentAnnotationId, input.body, author.id, author.name, author.initials, profile, effectiveParent.visibility, effectiveParent.organization_id]);
      if (derivedAnnotationId) {
        await client.query(`INSERT INTO annotations(id, source_reply_id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, organization_id, share_to_plaza) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`, [derivedAnnotationId, replyId, input.body, author.id, author.name, author.initials, profile, effectiveParent.visibility, effectiveParent.organization_id, effectiveParent.visibility === "public"]);
        await this.#replaceTargets(client, derivedAnnotationId, input.targets, author.id);
        await this.#replaceUserTags(client, derivedAnnotationId, input.tags);
        await this.#assignPlatformTags(client, derivedAnnotationId, input.body, input.tags);
        await client.query("UPDATE annotation_replies SET derived_annotation_id = $2 WHERE id = $1", [replyId, derivedAnnotationId]);
      }
      const reply = await this.#replyRow(replyId, client);
      return { annotation: derivedAnnotationId ? await this.annotation(derivedAnnotationId, author, client) : null, reply: this.#serializeReply(reply, author) };
    });
  }

  async updateReply(replyId, author, input) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${author.id}`]);
      const row = await this.#replyRow(replyId, client, true);
      if (!row || row.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
      if (row.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
      if (row.visibility === "organization" && !await this.#organizationVisible({ organizationId: row.organization_id, userId: author.id })) throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
      const profile = JSON.stringify(await this.#profileSnapshot(author.id, client));
      await client.query(`INSERT INTO annotation_reply_versions(id, reply_id, revision, body, author_profile_snapshot, changed_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [`reply_version_${randomUUID()}`, replyId, row.revision, row.body, JSON.stringify(row.author_profile_snapshot), author.id]);
      await client.query("UPDATE annotation_replies SET body = $2, author_name = $3, author_initials = $4, author_profile_snapshot = $5::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1", [replyId, input.body, author.name, author.initials, profile]);
      if (row.derived_annotation_id) {
        const derived = await this.#row(row.derived_annotation_id, client, true);
        const targets = await this.#targets(derived.id, client, false);
        const tags = await this.#tags(derived.id, client);
        await client.query(`INSERT INTO annotation_versions(id, annotation_id, revision, body, author_profile_snapshot, visibility, organization_id, share_to_plaza, targets, tags, changed_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`, [`annotation_version_${randomUUID()}`, derived.id, derived.revision, derived.body, JSON.stringify(derived.author_profile_snapshot), derived.visibility, derived.organization_id, derived.share_to_plaza, JSON.stringify(targets), JSON.stringify(tags), author.id]);
        await client.query("UPDATE annotations SET body = $2, author_name = $3, author_initials = $4, author_profile_snapshot = $5::jsonb, revision = $6, updated_at = now() WHERE id = $1", [derived.id, input.body, author.name, author.initials, profile, Number(derived.revision) + 1]);
      }
      return this.#serializeReply(await this.#replyRow(replyId, client), author);
    });
  }

  async updateReplyPublication(replyId, author, input) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${author.id}`]);
      const row = await this.#replyRow(replyId, client, true);
      if (!row || row.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
      if (row.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
      const authorizedParent = await this.#row(row.parent_annotation_id, client);
      if (row.visibility === "organization" && !await this.#organizationVisible({ organizationId: row.organization_id, userId: author.id })) {
        throw new AnnotationCommunityError("ORGANIZATION_ACCESS_DENIED", 403);
      }
      if (input.published && row.moderated_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
      const parent = await this.#row(row.parent_annotation_id, client, true);
      if (
        !parent ||
        parent.withdrawn_at ||
        parent.visibility !== row.visibility ||
        parent.organization_id !== row.organization_id ||
        !this.#sameAudienceState(authorizedParent, parent) ||
        Number(parent.revision) !== Number(authorizedParent?.revision) ||
        !await this.#rootAudience(parent, client)
      ) {
        throw new AnnotationCommunityError("REPLY_VISIBILITY_MISMATCH");
      }
      let derivedAnnotationId = row.derived_annotation_id;
      if (!input.published) {
        if (row.moderated_at) {
          await client.query(`
            UPDATE annotation_replies
               SET moderated_at = now(),
                   moderation_reason = 'Projection withdrawal superseded platform or organization restore authority.',
                   moderated_by = $2,
                   updated_at = now()
             WHERE id = $1
          `, [replyId, `author:${author.id}`.slice(0, 200)]);
        }
        if (derivedAnnotationId) {
          await this.#row(derivedAnnotationId, client, true);
          await client.query("UPDATE annotations SET withdrawn_at = now(), updated_at = now() WHERE id = $1", [derivedAnnotationId]);
        }
        return {
          annotation: null,
          reply: this.#serializeReply(await this.#replyRow(replyId, client), author)
        };
      }
      if (!derivedAnnotationId) {
        derivedAnnotationId = `annotation_${randomUUID()}`;
        await client.query(`
          INSERT INTO annotations(
            id, source_reply_id, body, author_id, author_name, author_initials,
            author_profile_snapshot, visibility, organization_id, share_to_plaza, revision
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
        `, [derivedAnnotationId, replyId, row.body, row.author_id, row.author_name, row.author_initials, JSON.stringify(row.author_profile_snapshot), row.visibility, row.organization_id, row.visibility === "public", 1]);
        await client.query("UPDATE annotation_replies SET derived_annotation_id = $2 WHERE id = $1", [replyId, derivedAnnotationId]);
      } else {
        const derived = await this.#row(derivedAnnotationId, client, true);
        const targets = await this.#targets(derived.id, client, false);
        const tags = await this.#tags(derived.id, client);
        await client.query(`INSERT INTO annotation_versions(id, annotation_id, revision, body, author_profile_snapshot, visibility, organization_id, share_to_plaza, targets, tags, changed_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`, [`annotation_version_${randomUUID()}`, derived.id, derived.revision, derived.body, JSON.stringify(derived.author_profile_snapshot), derived.visibility, derived.organization_id, derived.share_to_plaza, JSON.stringify(targets), JSON.stringify(tags), author.id]);
        await client.query(`
          UPDATE annotations
             SET body = $2, author_name = $3, author_initials = $4,
                 author_profile_snapshot = $5::jsonb, visibility = $6,
                 organization_id = $7, share_to_plaza = $8, revision = $9,
                 withdrawn_at = NULL, updated_at = now()
           WHERE id = $1
        `, [derivedAnnotationId, row.body, row.author_name, row.author_initials, JSON.stringify(row.author_profile_snapshot), row.visibility, row.organization_id, row.visibility === "public", Number(derived.revision) + 1]);
      }
      await this.#replaceTargets(client, derivedAnnotationId, input.targets, author.id);
      await this.#replaceUserTags(client, derivedAnnotationId, input.tags);
      await this.#assignPlatformTags(client, derivedAnnotationId, row.body, input.tags);
      return {
        annotation: await this.annotation(derivedAnnotationId, author, client),
        reply: this.#serializeReply(await this.#replyRow(replyId, client), author)
      };
    });
  }

  async deleteReply(replyId, author) {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`intuecho-account-deletion:${author.id}`]);
      const row = await this.#replyRow(replyId, client, true);
      if (!row || row.deleted_at) throw new AnnotationCommunityError("REPLY_NOT_FOUND", 404);
      if (row.author_id !== author.id) throw new AnnotationCommunityError("NOT_REPLY_AUTHOR", 403);
      if (row.derived_annotation_id) await this.#row(row.derived_annotation_id, client, true);
      await client.query("UPDATE annotation_replies SET body = '[deleted]', deleted_at = now(), updated_at = now() WHERE id = $1", [replyId]);
      if (row.derived_annotation_id) {
        await client.query("UPDATE annotations SET withdrawn_at = now(), updated_at = now() WHERE id = $1", [row.derived_annotation_id]);
      }
      return { ok: true, replyId };
    });
  }

  async replies(id, viewer) {
    await this.annotation(id, viewer);
    const result = await this.pool.query(`
      SELECT reply.*, derived.withdrawn_at AS derived_withdrawn_at
        FROM annotation_replies reply
        LEFT JOIN annotations derived ON derived.id = reply.derived_annotation_id
       WHERE reply.parent_annotation_id = $1
         AND reply.deleted_at IS NULL
         AND reply.moderated_at IS NULL
       ORDER BY reply.created_at, reply.id
    `, [id]);
    return result.rows.map((row) => this.#serializeReply(row, viewer));
  }

  async plaza(viewer, filters = {}) {
    const values = [];
    const clauses = ["annotations.share_to_plaza", "annotations.visibility = 'public'", "annotations.withdrawn_at IS NULL"];
    if (filters.institution) {
      values.push(filters.institution);
      clauses.push(`annotations.author_profile_snapshot -> 'institutions' @> jsonb_build_array(jsonb_build_object('name', $${values.length}::text))`);
    }
    if (filters.educationStage) {
      values.push(filters.educationStage);
      clauses.push(`annotations.author_profile_snapshot ->> 'educationStage' = $${values.length}`);
    }
    if (filters.documentType) {
      values.push(filters.documentType);
      clauses.push(`EXISTS(SELECT 1 FROM annotation_targets target JOIN literature_records literature ON literature.id = target.literature_id WHERE target.annotation_id = annotations.id AND literature.version_kind = $${values.length})`);
    }
    if (filters.literatureId) {
      values.push(filters.literatureId);
      const literatureIdIndex = values.length;
      clauses.push(`EXISTS(
        SELECT 1 FROM annotation_targets target WHERE target.annotation_id = annotations.id AND target.literature_id = $${literatureIdIndex}
        UNION ALL
        SELECT 1 FROM annotation_targets target JOIN annotation_target_evidence evidence ON evidence.target_id = target.id WHERE target.annotation_id = annotations.id AND evidence.literature_id = $${literatureIdIndex}
      )`);
    }
    if (filters.literatureIdentityValue) {
      const literatureIds = await this.#matchingLiteratureIds([{
        kind: filters.literatureIdentityKind,
        value: filters.literatureIdentityValue
      }]);
      values.push([...literatureIds]);
      const idsIndex = values.length;
      clauses.push(`EXISTS(
        SELECT 1 FROM annotation_targets target WHERE target.annotation_id = annotations.id AND target.literature_id = ANY($${idsIndex}::text[])
        UNION ALL
        SELECT 1 FROM annotation_targets target JOIN annotation_target_evidence evidence ON evidence.target_id = target.id WHERE target.annotation_id = annotations.id AND evidence.literature_id = ANY($${idsIndex}::text[])
      )`);
    }
    const result = await this.pool.query(`SELECT annotations.* FROM annotations WHERE ${clauses.join(" AND ")} ORDER BY annotations.created_at DESC, annotations.id DESC LIMIT 500`, values);
    let serialized = [];
    for (const authorizedRow of result.rows) {
      const row = await this.#row(authorizedRow.id);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row)) continue;
      serialized.push(await this.#serialize(row, viewer));
    }
    const query = String(filters.query ?? "").trim();
    if (query) {
      const criterion = query.startsWith("/") ? query.slice(1).trim() : query;
      const scored = serialized.map((annotation) => ({ annotation, score: localSemanticSimilarity(criterion, this.#searchText(annotation)) }));
      const maximum = Math.max(0, ...scored.map((item) => item.score));
      serialized = scored.filter((item) => query.startsWith("/") ? item.score >= Math.max(0.16, Math.min(0.45, maximum * 0.55)) : item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.annotation);
    }
    if (filters.sort === "recommended") serialized.sort((a, b) => ((b.ratingAverage ?? 0) * Math.log2(b.ratingCount + 1)) - ((a.ratingAverage ?? 0) * Math.log2(a.ratingCount + 1)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return serialized.slice(0, Math.min(Number(filters.limit) || 30, 100));
  }

  async mine(viewer) {
    const result = await this.pool.query("SELECT * FROM annotations WHERE author_id = $1 AND withdrawn_at IS NULL ORDER BY updated_at DESC, id DESC", [viewer.id]);
    const annotations = [];
    for (const authorizedRow of result.rows) {
      const row = await this.#row(authorizedRow.id);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row)) continue;
      annotations.push(await this.#serialize(row, viewer));
    }
    return annotations;
  }

  async followingFeed(viewer) {
    const result = await this.pool.query(`
      SELECT annotation.*
        FROM annotations annotation
        JOIN user_follows follow ON follow.followed_id = annotation.author_id
       WHERE follow.follower_id = $1
         AND annotation.withdrawn_at IS NULL
         AND (
           (annotation.visibility = 'public' AND annotation.share_to_plaza = true) OR
           annotation.visibility = 'mutual_followers'
         )
       ORDER BY annotation.updated_at DESC, annotation.id DESC
       LIMIT 100
    `, [viewer.id]);
    const annotations = [];
    for (const authorizedRow of result.rows) {
      if (!await this.#canView(authorizedRow, viewer)) continue;
      const row = await this.#row(authorizedRow.id);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row)) continue;
      annotations.push(await this.#serialize(row, viewer));
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
    const organizations = [];
    for (const membership of memberships) {
      const canModerate = new Set(["owner", "admin"]).has(membership.role);
      const result = await this.pool.query(`SELECT * FROM annotations WHERE organization_id = $1 AND visibility = 'organization' AND ($2::boolean OR withdrawn_at IS NULL) ORDER BY updated_at DESC, id DESC`, [membership.organizationId, canModerate]);
      const annotations = [];
      for (const authorizedRow of result.rows) {
        const row = await this.#row(authorizedRow.id);
        if (!this.#sameAudienceState(authorizedRow, row) || !await this.#rootAudience(row)) continue;
        annotations.push({
          ...await this.#serialize(row, viewer),
          viewerCanModerate: canModerate
        });
      }
      organizations.push({ ...membership, annotations });
    }
    return organizations;
  }

  async rateAnnotation(annotationId, viewer, rating) {
    return withTransaction(this.pool, async (client) => {
      const authorizedRow = await this.#row(annotationId, client);
      if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer, client)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      const row = await this.#row(annotationId, client, true);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row, client)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      if (row.author_id === viewer.id) throw new AnnotationCommunityError("SELF_RATING_FORBIDDEN", 403);
      await client.query(`INSERT INTO annotation_ratings(annotation_id, user_id, rating) VALUES ($1, $2, $3) ON CONFLICT(annotation_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`, [annotationId, viewer.id, rating]);
      const aggregate = await client.query("SELECT count(*)::int AS count, avg(rating)::double precision AS average FROM annotation_ratings WHERE annotation_id = $1", [annotationId]);
      return { ratingAverage: Number(Number(aggregate.rows[0].average).toFixed(2)), ratingCount: Number(aggregate.rows[0].count), viewerRating: rating };
    });
  }

  async toggleSave(annotationId, viewer) {
    return withTransaction(this.pool, async (client) => {
      const authorizedRow = await this.#row(annotationId, client);
      if (!authorizedRow || authorizedRow.withdrawn_at || !await this.#canView(authorizedRow, viewer, client)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      const row = await this.#row(annotationId, client, true);
      if (!this.#sameAudienceState(authorizedRow, row) || row.withdrawn_at || !await this.#rootAudience(row, client)) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      const removed = await client.query("DELETE FROM annotation_saves WHERE annotation_id = $1 AND user_id = $2 RETURNING annotation_id", [annotationId, viewer.id]);
      if (removed.rowCount) return { saved: false };
      await client.query("INSERT INTO annotation_saves(annotation_id, user_id) VALUES ($1, $2)", [annotationId, viewer.id]);
      return { saved: true };
    });
  }

  async withdraw(annotationId, viewer) {
    return withTransaction(this.pool, async (client) => {
      const candidate = await this.#row(annotationId, client);
      if (!candidate) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      if (candidate.author_id !== viewer.id) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
      const linkedReply = candidate.source_reply_id
        ? await this.#replyRow(candidate.source_reply_id, client, true)
        : null;
      const annotation = await this.#row(annotationId, client, true);
      if (
        !this.#sameAudienceState(candidate, annotation) ||
        annotation.author_id !== viewer.id ||
        !await this.#rootAudience(annotation, client) ||
        (annotation.source_reply_id && linkedReply?.derived_annotation_id !== annotation.id)
      ) {
        throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      }
      if (annotation.withdrawn_at) {
        if (!linkedReply?.moderated_at) {
          throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
        }
        await client.query(`
          UPDATE annotation_replies
             SET moderated_at = now(),
                 moderation_reason = 'Projection withdrawal superseded platform or organization restore authority.',
                 moderated_by = $2,
                 updated_at = now()
           WHERE id = $1
        `, [linkedReply.id, `author:${viewer.id}`.slice(0, 200)]);
        return { annotationId, ok: true };
      }
      await client.query("UPDATE annotations SET withdrawn_at = now(), updated_at = now() WHERE id = $1", [annotationId]);
      await client.query("UPDATE annotation_replies SET body = '[deleted]', deleted_at = now(), parent_deleted_at = now(), updated_at = now() WHERE parent_annotation_id = $1 AND deleted_at IS NULL", [annotationId]);
      return { annotationId, ok: true };
    });
  }

  async moderateOrganizationAnnotation({ action, annotationId, reason, traceId, userId }) {
    const authorizedRow = await this.#row(annotationId);
    if (!authorizedRow || authorizedRow.visibility !== "organization") throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    const access = await this.#organizationAccess({ organizationId: authorizedRow.organization_id, userId });
    if (!access.allowed || !new Set(["owner", "admin"]).has(access.role)) throw new AnnotationCommunityError("ORGANIZATION_MODERATION_DENIED", 403);
    return withTransaction(this.pool, (client) => this.#moderateAnnotation(client, {
      action,
      authority: "organization",
      authorizedRow,
      moderatorId: userId,
      reason,
      traceId
    }));
  }

  #searchText(annotation) {
    return [annotation.body, ...annotation.tags.map((tag) => tag.name), ...annotation.targets.flatMap((target) => [target.literature?.literatureRecord?.title, target.literature?.metadata?.title, target.literature?.title, target.excerpt, target.derivedContent?.excerpt, ...(target.evidence ?? []).map((evidence) => evidence.literature?.literatureRecord?.title)])].filter(Boolean).join(" ");
  }

  async toggleFollow(userId, targetUserId) {
    if (userId === targetUserId) throw new AnnotationCommunityError("CANNOT_FOLLOW_SELF");
    return withTransaction(this.pool, async (client) => {
      const removed = await client.query("DELETE FROM user_follows WHERE follower_id = $1 AND followed_id = $2 RETURNING followed_id", [userId, targetUserId]);
      const following = removed.rowCount === 0;
      if (following) await client.query("INSERT INTO user_follows(follower_id, followed_id) VALUES ($1, $2)", [userId, targetUserId]);
      return { following, mutual: following && await this.#mutual(userId, targetUserId, client) };
    });
  }

  async conversations(viewerId) {
    const result = await this.pool.query(`
      SELECT conversation.*,
             CASE WHEN conversation.first_user_id = $1 THEN conversation.second_user_id ELSE conversation.first_user_id END AS participant_id,
             participant.author_name AS participant_name,
             participant.author_initials AS participant_initials,
             participant.author_profile_snapshot AS participant_profile,
             latest.body AS last_message_body,
             latest.created_at AS last_message_created_at,
             latest.invitation AS last_message_invitation,
             latest.message_kind AS last_message_kind,
             latest.sender_id AS last_message_sender_id,
             COALESCE(unread.unread_count, 0)::int AS unread_count,
             EXISTS(
               SELECT 1 FROM user_follows outbound
                WHERE outbound.follower_id = $1
                  AND outbound.followed_id = CASE WHEN conversation.first_user_id = $1 THEN conversation.second_user_id ELSE conversation.first_user_id END
             ) AND EXISTS(
               SELECT 1 FROM user_follows inbound
                WHERE inbound.follower_id = CASE WHEN conversation.first_user_id = $1 THEN conversation.second_user_id ELSE conversation.first_user_id END
                  AND inbound.followed_id = $1
             ) AS can_send
        FROM direct_conversations conversation
        LEFT JOIN LATERAL (
          SELECT message.* FROM direct_messages message
           WHERE message.conversation_id = conversation.id
           ORDER BY message.created_at DESC, message.id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS unread_count
            FROM direct_messages message
            LEFT JOIN direct_conversation_reads receipt
              ON receipt.conversation_id = conversation.id
             AND receipt.user_id = $1
           WHERE message.conversation_id = conversation.id
             AND message.sender_id <> $1
             AND (
               receipt.last_read_at IS NULL OR
               (message.created_at, message.id) > (receipt.last_read_at, receipt.last_read_message_id)
             )
        ) unread ON true
        LEFT JOIN LATERAL (
          SELECT snapshot.author_name, snapshot.author_initials, snapshot.author_profile_snapshot
            FROM (
              SELECT annotation.author_id, annotation.author_name, annotation.author_initials, annotation.author_profile_snapshot, annotation.updated_at
                FROM annotations annotation
              UNION ALL
              SELECT reply.author_id, reply.author_name, reply.author_initials, reply.author_profile_snapshot, reply.updated_at
                FROM annotation_replies reply
            ) snapshot
           WHERE snapshot.author_id = CASE WHEN conversation.first_user_id = $1 THEN conversation.second_user_id ELSE conversation.first_user_id END
           ORDER BY snapshot.updated_at DESC LIMIT 1
        ) participant ON true
       WHERE conversation.first_user_id = $1 OR conversation.second_user_id = $1
       ORDER BY COALESCE(latest.created_at, conversation.created_at) DESC, conversation.id DESC
    `, [viewerId]);
    return result.rows.map((row) => ({
      canSend: Boolean(row.can_send),
      createdAt: row.created_at.toISOString(),
      id: row.id,
      lastMessage: row.last_message_created_at ? {
        body: row.last_message_body,
        createdAt: row.last_message_created_at.toISOString(),
        invitation: row.last_message_invitation,
        kind: row.last_message_kind,
        senderId: row.last_message_sender_id
      } : null,
      participant: {
        id: row.participant_id,
        initials: row.participant_initials ?? "研",
        name: row.participant_name ?? "研究成员",
        profile: row.participant_profile ?? { educationStage: null, institutions: [] }
      },
      unreadCount: Number(row.unread_count)
    }));
  }

  async createConversation(userId, participantId) {
    if (!await this.#mutual(userId, participantId)) throw new AnnotationCommunityError("MUTUAL_FOLLOW_REQUIRED", 403);
    const [first, second] = [userId, participantId].sort();
    const result = await this.pool.query(`INSERT INTO direct_conversations(id, first_user_id, second_user_id) VALUES ($1, $2, $3) ON CONFLICT(first_user_id, second_user_id) DO UPDATE SET first_user_id = EXCLUDED.first_user_id RETURNING id`, [`conversation_${randomUUID()}`, first, second]);
    return { id: result.rows[0].id };
  }

  async sendMessage(conversationId, senderId, input) {
    const found = await this.pool.query("SELECT * FROM direct_conversations WHERE id = $1", [conversationId]);
    const conversation = found.rows[0];
    if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(senderId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
    const recipientId = conversation.first_user_id === senderId ? conversation.second_user_id : conversation.first_user_id;
    if (!await this.#mutual(senderId, recipientId)) throw new AnnotationCommunityError("MUTUAL_FOLLOW_REQUIRED", 403);
    const id = `message_${randomUUID()}`;
    let invitation = null;
    if (input.kind === "organization_invitation") {
      const authorization = await this.#organizationInvitation({
        ...input.invitation,
        idempotencyKey: `intuecho-${id}`,
        invitedUserId: recipientId,
        inviterId: senderId
      });
      if (!authorization?.invitationId) throw new AnnotationCommunityError("ORGANIZATION_INVITATION_DENIED", 403);
      invitation = { ...input.invitation, ...authorization };
    }
    const result = await this.pool.query(`INSERT INTO direct_messages(id, conversation_id, sender_id, message_kind, body, invitation) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`, [id, conversationId, senderId, input.kind, input.body, invitation ? JSON.stringify(invitation) : null]);
    const row = result.rows[0];
    return { body: row.body, createdAt: row.created_at, id: row.id, invitation: row.invitation, kind: row.message_kind, senderId: row.sender_id };
  }

  async messages(conversationId, viewerId) {
    const found = await this.pool.query("SELECT * FROM direct_conversations WHERE id = $1", [conversationId]);
    const conversation = found.rows[0];
    if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(viewerId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
    const result = await this.pool.query("SELECT * FROM direct_messages WHERE conversation_id = $1 ORDER BY created_at, id", [conversationId]);
    return result.rows.map((row) => ({ body: row.body, createdAt: row.created_at, id: row.id, invitation: row.invitation, kind: row.message_kind, senderId: row.sender_id }));
  }

  async markConversationRead(conversationId, viewerId, messageId) {
    return withTransaction(this.pool, async (client) => {
      const found = await client.query("SELECT * FROM direct_conversations WHERE id = $1", [conversationId]);
      const conversation = found.rows[0];
      if (!conversation || !new Set([conversation.first_user_id, conversation.second_user_id]).has(viewerId)) throw new AnnotationCommunityError("CONVERSATION_NOT_FOUND", 404);
      const latest = await client.query("SELECT id, created_at FROM direct_messages WHERE conversation_id = $1 AND id = $2", [conversationId, messageId]);
      if (!latest.rows[0]) throw new AnnotationCommunityError("INVALID_READ_STATE");
      const message = latest.rows[0];
      await client.query(`
        INSERT INTO direct_conversation_reads(conversation_id, user_id, last_read_message_id, last_read_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(conversation_id, user_id) DO UPDATE SET
          last_read_message_id = EXCLUDED.last_read_message_id,
          last_read_at = EXCLUDED.last_read_at
        WHERE (direct_conversation_reads.last_read_at, direct_conversation_reads.last_read_message_id)
            < (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)
      `, [conversationId, viewerId, message.id, message.created_at]);
      const unread = await client.query(`
        SELECT count(*)::int AS count FROM direct_messages
         WHERE conversation_id = $1 AND sender_id <> $2
           AND (created_at, id) > ($3, $4)
      `, [conversationId, viewerId, message.created_at, message.id]);
      return { lastReadMessageId: message.id, unreadCount: Number(unread.rows[0].count) };
    });
  }

  async appealPlatformTag(annotationId, tag, userId, reason) {
    return withTransaction(this.pool, async (client) => {
      const row = await this.#row(annotationId, client, true);
      if (!row) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      if (row.author_id !== userId) throw new AnnotationCommunityError("NOT_ANNOTATION_AUTHOR", 403);
      const found = await client.query(`SELECT annotation_tags.tag_id, annotation_tags.state FROM annotation_tags JOIN tags ON tags.id = annotation_tags.tag_id WHERE annotation_tags.annotation_id = $1 AND tags.slug = $2 AND annotation_tags.origin = 'platform' FOR UPDATE`, [annotationId, tagSlug(tag)]);
      if (!found.rows[0]) throw new AnnotationCommunityError("PLATFORM_TAG_NOT_FOUND", 404);
      if (found.rows[0].state !== "active") throw new AnnotationCommunityError("PLATFORM_TAG_APPEAL_NOT_ALLOWED", 409);
      const id = `appeal_${randomUUID()}`;
      await client.query(`UPDATE annotation_tags SET state = 'appealed', updated_at = now() WHERE annotation_id = $1 AND tag_id = $2 AND origin = 'platform'`, [annotationId, found.rows[0].tag_id]);
      await client.query(`INSERT INTO annotation_tag_appeals(id, annotation_id, tag_id, submitted_by, reason) VALUES ($1, $2, $3, $4, $5)`, [id, annotationId, found.rows[0].tag_id, userId, reason]);
      return { appealId: id, status: "pending" };
    });
  }

  async listTagAppeals(status = "pending") {
    const result = await this.pool.query(`
      SELECT appeal.*, annotation.body AS annotation_body,
             annotation.author_name, tags.name AS tag_name
        FROM annotation_tag_appeals appeal
        JOIN annotations annotation ON annotation.id = appeal.annotation_id
        JOIN tags ON tags.id = appeal.tag_id
       WHERE appeal.status = $1
       ORDER BY appeal.created_at, appeal.id
    `, [status]);
    return result.rows.map((row) => ({
      annotationBody: row.annotation_body,
      annotationId: row.annotation_id,
      appealId: row.id,
      authorName: row.author_name,
      createdAt: row.created_at.toISOString(),
      reason: row.reason,
      resolutionReason: row.resolution_reason ?? null,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      resolvedBy: row.resolved_by ?? null,
      status: row.status,
      submittedBy: row.submitted_by,
      tag: row.tag_name
    }));
  }

  async resolveTagAppeal(appealId, adminUserId, input, traceId) {
    return withTransaction(this.pool, async (client) => {
      const found = await client.query("SELECT * FROM annotation_tag_appeals WHERE id = $1 FOR UPDATE", [appealId]);
      const appeal = found.rows[0];
      if (!appeal) throw new AnnotationCommunityError("TAG_APPEAL_NOT_FOUND", 404);
      if (appeal.status !== "pending") throw new AnnotationCommunityError("TAG_APPEAL_ALREADY_RESOLVED", 409);
      const tagState = input.decision === "accepted" ? "removed" : "upheld";
      const resolved = await client.query(`
        UPDATE annotation_tag_appeals
           SET status = $2, resolved_by = $3, resolution_reason = $4, resolved_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING resolved_at
      `, [appealId, input.decision, adminUserId, input.reason]);
      await client.query("UPDATE annotation_tags SET state = $3, updated_at = now() WHERE annotation_id = $1 AND tag_id = $2 AND origin = 'platform'", [appeal.annotation_id, appeal.tag_id, tagState]);
      await client.query(`
        INSERT INTO annotation_tag_appeal_audit(
          id, appeal_id, annotation_id, tag_id, decision, admin_user_id, reason, trace_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [`appealaudit_${randomUUID()}`, appealId, appeal.annotation_id, appeal.tag_id, input.decision, adminUserId, input.reason, traceId]);
      return { appealId, decision: input.decision, resolvedAt: resolved.rows[0].resolved_at.toISOString() };
    });
  }

  async listAdminAnnotations() {
    const result = await this.pool.query("SELECT * FROM annotations ORDER BY updated_at DESC, id DESC LIMIT 500");
    return result.rows.map((row) => ({
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      id: row.id,
      parentAnnotationId: row.parent_annotation_id,
      updatedAt: row.updated_at.toISOString(),
      visibility: row.visibility,
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null
    }));
  }

  async moderateAnnotation(input) {
    return withTransaction(this.pool, async (client) => {
      const authorizedRow = await this.#row(input.annotationId, client);
      if (!authorizedRow) throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
      return this.#moderateAnnotation(client, {
        action: input.action,
        authority: "platform",
        authorizedRow,
        moderatorId: input.adminId,
        reason: input.reason,
        traceId: input.traceId
      });
    });
  }

  async #moderateAnnotation(client, { action, authority, authorizedRow, moderatorId, reason, traceId }) {
    const linkedReply = authorizedRow.source_reply_id
      ? await this.#replyRow(authorizedRow.source_reply_id, client, true)
      : null;
    const annotation = await this.#row(authorizedRow.id, client, true);
    if (
      !this.#sameAudienceState(authorizedRow, annotation) ||
      Number(annotation.revision) !== Number(authorizedRow.revision) ||
      (authority === "organization" && annotation.visibility !== "organization") ||
      !await this.#rootAudience(annotation, client) ||
      (annotation.source_reply_id && linkedReply?.derived_annotation_id !== annotation.id)
    ) {
      throw new AnnotationCommunityError("ANNOTATION_NOT_FOUND", 404);
    }
    if (
      action === "restore" &&
      annotation.source_reply_id &&
      (
        !linkedReply.moderated_at ||
        !linkedReply.moderated_by?.startsWith(`${authority}:`) ||
        (linkedReply.deleted_at && !linkedReply.parent_deleted_at)
      )
    ) {
      throw new AnnotationCommunityError("ANNOTATION_MODERATION_CONFLICT", 409);
    }
    if ((action === "withdraw") === Boolean(annotation.withdrawn_at)) {
      throw new AnnotationCommunityError("ANNOTATION_MODERATION_CONFLICT", 409);
    }
    await client.query("UPDATE annotations SET withdrawn_at = CASE WHEN $2 = 'withdraw' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1", [annotation.id, action]);
    if (annotation.source_reply_id) {
      await client.query(`
        UPDATE annotation_replies
           SET moderated_at = CASE WHEN $2 = 'withdraw' THEN now() ELSE NULL END,
               moderation_reason = CASE WHEN $2 = 'withdraw' THEN $3 ELSE NULL END,
               moderated_by = CASE WHEN $2 = 'withdraw' THEN $4 ELSE NULL END,
               updated_at = now()
         WHERE id = $1
      `, [annotation.source_reply_id, action, reason, `${authority}:${moderatorId}`.slice(0, 200)]);
    }
    await client.query(`
      INSERT INTO annotation_moderation_audit(id, annotation_id, linked_reply_id, action, reason, admin_user_id, trace_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [`annotationaudit_${randomUUID()}`, annotation.id, annotation.source_reply_id, action, reason, moderatorId, traceId]);
    return { action, annotationId: annotation.id, ok: true };
  }
}
