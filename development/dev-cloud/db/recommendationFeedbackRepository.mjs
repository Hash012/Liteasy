const maximumFeedbackPerUser = 500;

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function feedbackKey(feedback) {
  const canonicalId = typeof feedback.canonicalId === "string" ? feedback.canonicalId.trim() : "";
  if (canonicalId) {
    return canonicalId;
  }
  return normalizeText(feedback.title).toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, " ").trim();
}

let singleton = null;

export function setRecommendationFeedbackRepository(repository) {
  singleton = repository;
}

export function createRecommendationFeedbackRepository(database) {
  const upsertRow = database.prepare(`
    INSERT INTO recommendation_feedback (
      owner_key, feedback_key, canonical_id, candidate_id, action, source, title, context_json, created_at
    ) VALUES (
      @ownerKey, @feedbackKey, @canonicalId, @candidateId, @action, @source, @title, @contextJson, @createdAt
    )
    ON CONFLICT(owner_key, feedback_key) DO UPDATE SET
      canonical_id = excluded.canonical_id,
      candidate_id = excluded.candidate_id,
      action = excluded.action,
      source = excluded.source,
      title = excluded.title,
      context_json = excluded.context_json,
      created_at = excluded.created_at
  `);
  const listRowsForUser = database.prepare(`
    SELECT action, canonical_id, candidate_id, created_at, source, title
    FROM recommendation_feedback
    WHERE owner_key = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ${maximumFeedbackPerUser}
  `);
  const deleteForUser = database.prepare(`DELETE FROM recommendation_feedback WHERE owner_key = ?`);
  const countForUser = database.prepare(`SELECT COUNT(*) AS total FROM recommendation_feedback WHERE owner_key = ?`);
  const trimForUser = database.prepare(`
    DELETE FROM recommendation_feedback
    WHERE owner_key = ? AND id NOT IN (
      SELECT id FROM recommendation_feedback
      WHERE owner_key = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${maximumFeedbackPerUser}
    )
  `);

  function mapRow(row) {
    return {
      action: row.action,
      ...(row.canonical_id ? { canonicalId: row.canonical_id } : {}),
      candidateId: row.candidate_id,
      createdAt: row.created_at,
      source: row.source,
      title: row.title
    };
  }

  return {
    clearForUser(userId) {
      const cleared = countForUser.get(userId)?.total ?? 0;
      deleteForUser.run(userId);
      return cleared;
    },

    list(userId) {
      return listRowsForUser.all(userId).map(mapRow);
    },

    resetAll() {
      database.exec("DELETE FROM recommendation_feedback");
      return { reset: true };
    },

    save(userId, feedback, now = new Date()) {
      const record = {
        action: feedback.action,
        ...(feedback.canonicalId ? { canonicalId: feedback.canonicalId } : {}),
        candidateId: feedback.candidateId,
        createdAt: now.toISOString(),
        source: feedback.source,
        title: feedback.title
      };
      upsertRow.run({
        action: record.action,
        candidateId: record.candidateId ?? null,
        canonicalId: record.canonicalId ?? null,
        contextJson: feedback.context ? JSON.stringify(feedback.context) : null,
        createdAt: record.createdAt,
        feedbackKey: feedbackKey(record),
        ownerKey: userId,
        source: record.source,
        title: record.title
      });
      const trim = database.transaction(() => trimForUser.run(userId, userId));
      trim();
      return record;
    }
  };
}

function requireSingleton() {
  if (!singleton) {
    throw new Error("recommendation_feedback_repository_not_initialized");
  }
  return singleton;
}

export function listRecommendationFeedback(userId) {
  return requireSingleton().list(userId);
}

export function saveRecommendationFeedback(userId, feedback, now) {
  return requireSingleton().save(userId, feedback, now);
}

export function clearRecommendationFeedbackForUser(userId) {
  return requireSingleton().clearForUser(userId);
}

export function resetRecommendationFeedbackData() {
  return requireSingleton().resetAll();
}

export function __resetRecommendationFeedbackRepository() {
  singleton = null;
}
