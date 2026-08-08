import { randomUUID } from "node:crypto";

const stages = new Set([
  "未设置",
  "本科生",
  "硕士研究生",
  "博士研究生",
  "教师/研究员",
  "产业研发"
]);

const signalWeights = {
  paper_opened: 0.15,
  recommendation_saved: 1
};

export class PersonalizationValidationError extends Error {}

function defaultProfile() {
  return {
    disciplines: [],
    stage: "未设置"
  };
}

function parseDisciplines(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new PersonalizationValidationError("研究画像格式无效。");
  }

  const stage = normalizeText(profile.stage);
  const rawDisciplines = Array.isArray(profile.disciplines) ? profile.disciplines : null;
  if (!stages.has(stage) || rawDisciplines === null || rawDisciplines.length > 12) {
    throw new PersonalizationValidationError("研究阶段或研究学科格式无效。");
  }

  const disciplines = rawDisciplines.map((discipline) => {
    if (!discipline || typeof discipline !== "object" || Array.isArray(discipline)) {
      throw new PersonalizationValidationError("研究学科格式无效。");
    }

    const categoryCode = normalizeText(discipline.categoryCode);
    const categoryName = normalizeText(discipline.categoryName);
    const code = normalizeText(discipline.code);
    const description = normalizeText(discipline.description);
    const name = normalizeText(discipline.name);
    if (
      !categoryCode ||
      !categoryName ||
      !code ||
      !name ||
      categoryCode.length > 12 ||
      categoryName.length > 80 ||
      code.length > 24 ||
      name.length > 120 ||
      description.length > 240
    ) {
      throw new PersonalizationValidationError("研究学科格式无效。");
    }

    return {
      categoryCode,
      categoryName,
      code,
      description,
      name
    };
  });

  const distinctCodes = new Set(disciplines.map((discipline) => discipline.code));
  if (distinctCodes.size !== disciplines.length) {
    throw new PersonalizationValidationError("研究学科不能重复选择。");
  }

  return { disciplines, stage };
}

function extractTerms(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return [];
  }

  const latinTerms = normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chineseTerms = chineseRuns.flatMap((run) =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  );
  return [...new Set([...latinTerms, ...chineseTerms])].slice(0, 16);
}

function buildAssistantSummary(terms) {
  const focusTerms = terms
    .filter((term) => term.weight > 0)
    .slice(0, 5)
    .map((term) => term.term);
  return focusTerms.length > 0
    ? `近期产品内关注：${focusTerms.join("、")}`
    : undefined;
}

function mapProfile(row) {
  if (!row) {
    return {
      ...defaultProfile(),
      profileVersion: 0
    };
  }

  return {
    disciplines: parseDisciplines(row.disciplines_json),
    profileVersion: row.profile_version,
    stage: row.stage
  };
}

function toPublicSnapshot(state) {
  return {
    assistantSummary: state.assistantSummary,
    enabled: state.enabled,
    personalizationVersion: state.personalizationVersion,
    profile: state.profile,
    tags: state.tags
  };
}

export function createPersonalizationRepository(database) {
  const findSetting = database.prepare(`
    SELECT enabled FROM personalization_settings WHERE owner_key = ?
  `);
  const findProfile = database.prepare(`
    SELECT stage, disciplines_json, profile_version
    FROM academic_profiles
    WHERE owner_key = ?
  `);
  const findState = database.prepare(`
    SELECT version FROM personalization_states WHERE owner_key = ?
  `);
  const insertState = database.prepare(`
    INSERT INTO personalization_states (owner_key, version, updated_at)
    VALUES (@ownerKey, 1, @updatedAt)
    ON CONFLICT(owner_key) DO UPDATE SET
      version = personalization_states.version + 1,
      updated_at = excluded.updated_at
  `);
  const upsertProfile = database.prepare(`
    INSERT INTO academic_profiles (
      owner_key, stage, disciplines_json, profile_version, updated_at
    ) VALUES (
      @ownerKey, @stage, @disciplinesJson, 1, @updatedAt
    )
    ON CONFLICT(owner_key) DO UPDATE SET
      stage = excluded.stage,
      disciplines_json = excluded.disciplines_json,
      profile_version = academic_profiles.profile_version + 1,
      updated_at = excluded.updated_at
  `);
  const deleteProfile = database.prepare(`
    DELETE FROM academic_profiles WHERE owner_key = ?
  `);
  const deleteTerms = database.prepare(`
    DELETE FROM personalization_terms WHERE owner_key = ?
  `);
  const deleteSuppressions = database.prepare(`
    DELETE FROM recommendation_suppressions WHERE owner_key = ?
  `);
  const deleteCandidates = database.prepare(
    "DELETE FROM recommendation_candidates WHERE owner_key = ?"
  );
  const deleteFeedback = database.prepare(
    "DELETE FROM recommendation_feedback WHERE owner_key = ?"
  );
  const deleteRecommendationCache = database.prepare(
    "DELETE FROM recommendation_cache_entries WHERE owner_key = ?"
  );
  const deleteExternalPdfGrants = database.prepare(
    "DELETE FROM external_pdf_grants WHERE owner_key = ?"
  );
  const deleteManifest = database.prepare(
    "DELETE FROM local_library_manifest_entries WHERE owner_key = ?"
  );
  const listTerms = database.prepare(`
    SELECT term, weight
    FROM personalization_terms
    WHERE owner_key = ?
    ORDER BY weight DESC, updated_at DESC, term ASC
    LIMIT 24
  `);
  const listSuppressions = database.prepare(`
    SELECT recommendation_id
    FROM recommendation_suppressions
    WHERE owner_key = ?
  `);
  const upsertTerm = database.prepare(`
    INSERT INTO personalization_terms (owner_key, term, weight, updated_at, tag_id, signal_source)
    VALUES (@ownerKey, @term, @weight, @updatedAt, @tagId, @signalSource)
    ON CONFLICT(owner_key, term) DO UPDATE SET
      weight = MIN(6, MAX(-4, personalization_terms.weight + excluded.weight)),
      evidence_count = personalization_terms.evidence_count + 1,
      signal_source = COALESCE(excluded.signal_source, personalization_terms.signal_source),
      tag_id = COALESCE(excluded.tag_id, personalization_terms.tag_id),
      updated_at = excluded.updated_at
  `);
  const listWorkTags = database.prepare(`
    SELECT t.id AS tag_id, t.label, t.normalized
    FROM paper_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.work_id = ?
    ORDER BY t.normalized
  `);
  const addSuppression = database.prepare(`
    INSERT INTO recommendation_suppressions (owner_key, recommendation_id, created_at)
    VALUES (@ownerKey, @recommendationId, @createdAt)
    ON CONFLICT(owner_key, recommendation_id) DO NOTHING
  `);

  const listUserTags = database.prepare(`
    SELECT term, weight, evidence_count, signal_source, tag_id
    FROM personalization_terms
    WHERE owner_key = ? AND weight > 0
    ORDER BY weight DESC, evidence_count DESC, updated_at DESC, term ASC
    LIMIT 12
  `);

  function readState(ownerKey) {
    const profile = mapProfile(findProfile.get(ownerKey));
    const state = findState.get(ownerKey);
    const terms = listTerms.all(ownerKey);
    const tags = listUserTags.all(ownerKey).map((row) => ({
      evidenceCount: row.evidence_count,
      label: row.term,
      signalSource: row.signal_source,
      tagId: row.tag_id,
      weight: Number(row.weight)
    }));
    return {
      assistantSummary: buildAssistantSummary(terms),
      enabled: findSetting.get(ownerKey)?.enabled !== 0,
      personalizationVersion: state?.version ?? 0,
      profile,
      suppressedRecommendationIds: listSuppressions
        .all(ownerKey)
        .map((row) => row.recommendation_id),
      tags,
      terms
    };
  }

  const saveProfile = database.transaction((ownerKey, profile) => {
    const updatedAt = new Date().toISOString();
    upsertProfile.run({
      disciplinesJson: JSON.stringify(profile.disciplines),
      ownerKey,
      stage: profile.stage,
      updatedAt
    });
    insertState.run({ ownerKey, updatedAt });
    return readState(ownerKey);
  });

  const clearProfileAndPersonalization = database.transaction((ownerKey) => {
    const updatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO personalization_settings (owner_key, enabled, updated_at)
      VALUES (?, 0, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        enabled = 0,
        updated_at = excluded.updated_at
    `).run(ownerKey, updatedAt);
    deleteProfile.run(ownerKey);
    deleteTerms.run(ownerKey);
    deleteSuppressions.run(ownerKey);
    const deletedCandidates = deleteCandidates.run(ownerKey).changes;
    const deletedFeedback = deleteFeedback.run(ownerKey).changes;
    const deletedCacheEntries = deleteRecommendationCache.run(ownerKey).changes;
    const deletedExternalPdfGrants = deleteExternalPdfGrants.run(ownerKey).changes;
    const deletedManifestEntries = deleteManifest.run(ownerKey).changes;
    insertState.run({ ownerKey, updatedAt });
    return {
      deletion: {
        cacheEntries: deletedCacheEntries,
        candidates: deletedCandidates,
        externalPdfGrants: deletedExternalPdfGrants,
        localManifestEntries: deletedManifestEntries,
        recommendationFeedback: deletedFeedback
      },
      state: readState(ownerKey)
    };
  });

  const recordSignal = database.transaction((ownerKey, signal) => {
    const updatedAt = new Date().toISOString();
    if (signal.kind === "recommendation_dismissed") {
      addSuppression.run({
        createdAt: updatedAt,
        ownerKey,
        recommendationId: signal.recommendationId
      });
    } else {
      const weight = signalWeights[signal.kind];
      // 统一按 normalized term 去重：标题抽取 + 论文已打标 tag 合并后每条只 upsert 一次，
      // 避免 title 与 work tag 重叠时 evidence_count 翻倍。
      const tagByTerm = new Map();
      for (const term of extractTerms(signal.title)) {
        tagByTerm.set(term, null);
      }
      if (signal.workId) {
        for (const workTag of listWorkTags.all(signal.workId)) {
          // work tag 提供规范化 tag_id，覆盖同名 title 抽取项。
          tagByTerm.set(workTag.normalized, workTag.tag_id);
        }
      }
      for (const [term, tagId] of tagByTerm) {
        upsertTerm.run({
          ownerKey,
          signalSource: signal.kind,
          tagId,
          term,
          updatedAt,
          weight
        });
      }
    }
    insertState.run({ ownerKey, updatedAt });
    return readState(ownerKey);
  });

  return {
    clear(ownerKey) {
      const cleared = clearProfileAndPersonalization(ownerKey);
      return {
        ...toPublicSnapshot(cleared.state),
        cleared: true,
        deletion: cleared.deletion
      };
    },

    deleteForAccount(ownerKey) {
      const deletion = database.transaction(() => {
        const cleared = {
          cacheEntries: deleteRecommendationCache.run(ownerKey).changes,
          candidates: deleteCandidates.run(ownerKey).changes,
          externalPdfGrants: deleteExternalPdfGrants.run(ownerKey).changes,
          feedback: deleteFeedback.run(ownerKey).changes,
          localManifestEntries: deleteManifest.run(ownerKey).changes,
          profile: deleteProfile.run(ownerKey).changes,
          suppressions: deleteSuppressions.run(ownerKey).changes,
          terms: deleteTerms.run(ownerKey).changes
        };
        database.prepare("DELETE FROM personalization_settings WHERE owner_key = ?").run(ownerKey);
        database.prepare("DELETE FROM personalization_states WHERE owner_key = ?").run(ownerKey);
        return cleared;
      })();
      return deletion;
    },

    get(ownerKey) {
      return toPublicSnapshot(readState(ownerKey));
    },

    getRecommendationPreferences(ownerKey) {
      const state = readState(ownerKey);
      if (!state.enabled) {
        return {
          enabled: false,
          profile: defaultProfile(),
          suppressedRecommendationIds: [],
          terms: []
        };
      }
      return {
        enabled: true,
        profile: state.profile,
        suppressedRecommendationIds: state.suppressedRecommendationIds,
        terms: state.terms
      };
    },

    recordSignal(ownerKey, signal) {
      if (!readState(ownerKey).enabled) {
        return toPublicSnapshot(readState(ownerKey));
      }
      if (
        !signal ||
        typeof signal !== "object" ||
        !["paper_opened", "recommendation_saved", "recommendation_dismissed"].includes(signal.kind)
      ) {
        throw new PersonalizationValidationError("个性化操作无效。");
      }

      if (signal.kind === "recommendation_dismissed") {
        if (typeof signal.recommendationId !== "string" || signal.recommendationId.length === 0) {
          throw new PersonalizationValidationError("推荐标识无效。");
        }
      } else if (typeof signal.title !== "string" || normalizeText(signal.title).length === 0) {
        throw new PersonalizationValidationError("文献标题无效。");
      }

      const validated = { kind: signal.kind };
      if (signal.kind === "recommendation_dismissed") {
        validated.recommendationId = signal.recommendationId;
      } else {
        validated.title = signal.title;
        if (
          typeof signal.workId === "string" &&
          signal.workId.length > 0 &&
          signal.workId.length <= 80 &&
          /^[A-Za-z0-9._-]+$/.test(signal.workId)
        ) {
          validated.workId = signal.workId;
        }
      }

      return toPublicSnapshot(recordSignal(ownerKey, validated));
    },

    save(ownerKey, profile) {
      return toPublicSnapshot(saveProfile(ownerKey, normalizeProfile(profile)));
    },

    setEnabled(ownerKey, enabledInput) {
      if (typeof enabledInput !== "boolean") {
        throw new PersonalizationValidationError("个性化开关无效。");
      }
      const timestamp = new Date().toISOString();
      database.transaction(() => {
        database.prepare(`
          INSERT INTO personalization_settings (owner_key, enabled, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(owner_key) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `).run(ownerKey, enabledInput ? 1 : 0, timestamp);
        insertState.run({ ownerKey, updatedAt: timestamp });
        if (!enabledInput) deleteRecommendationCache.run(ownerKey);
      })();
      return toPublicSnapshot(readState(ownerKey));
    },

    syncLocalManifest(ownerKey, documentsInput) {
      if (!readState(ownerKey).enabled) {
        return {
          acceptedCount: 0,
          disabled: true,
          rejectedCount: 0,
          syncId: randomUUID(),
          syncedAt: new Date().toISOString()
        };
      }
      const documents = Array.isArray(documentsInput) ? documentsInput : [];
      const accepted = [];
      let rejectedCount = 0;
      for (const document of documents.slice(0, 20_000)) {
        const syncDocumentId = normalizeText(document?.syncDocumentId ?? document?.id);
        const title = normalizeText(document?.title);
        const contentHash = normalizeText(document?.contentHash).toLowerCase();
        const authors = Array.isArray(document?.authors)
          ? document.authors.filter((author) => typeof author === "string").slice(0, 100)
          : [];
        const isValid =
          /^[A-Za-z0-9._:-]{1,180}$/.test(syncDocumentId) &&
          title.length > 0 &&
          title.length <= 500 &&
          (!contentHash || /^[a-f0-9]{64}$/.test(contentHash)) &&
          typeof document?.sourcePath === "undefined";
        if (!isValid) {
          rejectedCount += 1;
          continue;
        }
        accepted.push({
          authors,
          contentHash: contentHash || null,
          doi: normalizeText(document.doi).slice(0, 300) || null,
          publicationYear: Number.isInteger(document.publicationYear)
            ? document.publicationYear
            : null,
          syncDocumentId,
          title
        });
      }
      const timestamp = new Date().toISOString();
      database.transaction(() => {
        const keepIds = new Set();
        const upsert = database.prepare(`
          INSERT INTO local_library_manifest_entries (
            owner_key, sync_document_id, content_hash, title, authors_json,
            doi, publication_year, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_key, sync_document_id) DO UPDATE SET
            content_hash = excluded.content_hash,
            title = excluded.title,
            authors_json = excluded.authors_json,
            doi = excluded.doi,
            publication_year = excluded.publication_year,
            updated_at = excluded.updated_at
        `);
        for (const document of accepted) {
          keepIds.add(document.syncDocumentId);
          upsert.run(
            ownerKey,
            document.syncDocumentId,
            document.contentHash,
            document.title,
            JSON.stringify(document.authors),
            document.doi,
            document.publicationYear,
            timestamp
          );
        }
        const existing = database.prepare(`
          SELECT sync_document_id FROM local_library_manifest_entries WHERE owner_key = ?
        `).all(ownerKey);
        const remove = database.prepare(`
          DELETE FROM local_library_manifest_entries
          WHERE owner_key = ? AND sync_document_id = ?
        `);
        for (const row of existing) {
          if (!keepIds.has(row.sync_document_id)) remove.run(ownerKey, row.sync_document_id);
        }
        insertState.run({ ownerKey, updatedAt: timestamp });
      })();
      return {
        acceptedCount: accepted.length,
        disabled: false,
        rejectedCount,
        syncId: randomUUID(),
        syncedAt: timestamp
      };
    }
  };
}
