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

  const matches = normalized.match(/[a-z0-9][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...new Set(matches)].slice(0, 16);
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
    personalizationVersion: state.personalizationVersion,
    profile: state.profile
  };
}

export function createPersonalizationRepository(database) {
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
    INSERT INTO personalization_terms (owner_key, term, weight, updated_at)
    VALUES (@ownerKey, @term, @weight, @updatedAt)
    ON CONFLICT(owner_key, term) DO UPDATE SET
      weight = MIN(6, MAX(-4, personalization_terms.weight + excluded.weight)),
      updated_at = excluded.updated_at
  `);
  const addSuppression = database.prepare(`
    INSERT INTO recommendation_suppressions (owner_key, recommendation_id, created_at)
    VALUES (@ownerKey, @recommendationId, @createdAt)
    ON CONFLICT(owner_key, recommendation_id) DO NOTHING
  `);

  function readState(ownerKey) {
    const profile = mapProfile(findProfile.get(ownerKey));
    const state = findState.get(ownerKey);
    const terms = listTerms.all(ownerKey);
    return {
      assistantSummary: buildAssistantSummary(terms),
      personalizationVersion: state?.version ?? 0,
      profile,
      suppressedRecommendationIds: listSuppressions
        .all(ownerKey)
        .map((row) => row.recommendation_id),
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
    deleteProfile.run(ownerKey);
    deleteTerms.run(ownerKey);
    deleteSuppressions.run(ownerKey);
    insertState.run({ ownerKey, updatedAt });
    return readState(ownerKey);
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
      for (const term of extractTerms(signal.title)) {
        upsertTerm.run({ ownerKey, term, updatedAt, weight });
      }
    }
    insertState.run({ ownerKey, updatedAt });
    return readState(ownerKey);
  });

  return {
    clear(ownerKey) {
      return toPublicSnapshot(clearProfileAndPersonalization(ownerKey));
    },

    get(ownerKey) {
      return toPublicSnapshot(readState(ownerKey));
    },

    getRecommendationPreferences(ownerKey) {
      const state = readState(ownerKey);
      return {
        profile: state.profile,
        suppressedRecommendationIds: state.suppressedRecommendationIds,
        terms: state.terms
      };
    },

    recordSignal(ownerKey, signal) {
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

      return toPublicSnapshot(recordSignal(ownerKey, signal));
    },

    save(ownerKey, profile) {
      return toPublicSnapshot(saveProfile(ownerKey, normalizeProfile(profile)));
    }
  };
}
