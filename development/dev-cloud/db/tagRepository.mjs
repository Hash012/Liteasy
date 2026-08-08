import { createHash } from "node:crypto";

export class TagRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "TagRepositoryError";
  }
}

const tagSources = new Set(["extracted", "recommended", "explicit"]);
const paperTagSources = new Set(["title", "abstract"]);

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

// 关键词抽取：latin 词（≥3 字符）+ 中文 bigram。与 personalizationRepository 的
// extractTerms 同构，作为 tag-centric 体系的共享抽取入口（M4 用户画像复用）。
export function extractTags(value, limit = 16) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return [];
  }
  const latinTerms = normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const chineseRuns = normalized.match(/[一-鿿]{2,}/g) ?? [];
  const chineseTerms = chineseRuns.flatMap((run) =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  );
  const unique = [...new Set([...latinTerms, ...chineseTerms])];
  return unique.slice(0, limit).map((label) => ({
    label,
    normalized: label
  }));
}

function tagId(normalized) {
  return `t_${createHash("sha1").update(normalized).digest("hex").slice(0, 16)}`;
}

function mapTag(row) {
  if (!row) {
    return null;
  }
  return {
    createdAt: row.created_at,
    id: row.id,
    label: row.label,
    normalized: row.normalized,
    occurrenceCount: row.occurrence_count,
    source: row.source,
    sourceKind: row.source_kind,
    updatedAt: row.updated_at
  };
}

function mapPaperTag(row) {
  return {
    createdAt: row.created_at,
    source: row.source,
    tagId: row.tag_id,
    weight: row.weight,
    workId: row.work_id
  };
}

function mapWorkSummary(row) {
  return {
    canonicalId: row.canonical_id,
    canonicalProvider: row.canonical_provider,
    id: row.id,
    title: row.title,
    type: row.type,
    year: row.year
  };
}

export function createTagRepository(database) {
  const findTagById = database.prepare(`
    SELECT id, label, normalized, source, source_kind, occurrence_count, created_at, updated_at
    FROM tags WHERE id = ?
  `);
  const findTagByNormalized = database.prepare(`
    SELECT id, label, normalized, source, source_kind, occurrence_count, created_at, updated_at
    FROM tags WHERE normalized = ?
  `);
  const insertTag = database.prepare(`
    INSERT INTO tags (id, label, normalized, source, source_kind, occurrence_count, created_at, updated_at)
    VALUES (@id, @label, @normalized, @source, @sourceKind, 0, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      source = excluded.source,
      source_kind = COALESCE(excluded.source_kind, tags.source_kind),
      updated_at = excluded.updated_at
  `);
  const insertPaperTag = database.prepare(`
    INSERT INTO paper_tags (work_id, tag_id, source, weight, created_at)
    VALUES (@workId, @tagId, @source, @weight, @createdAt)
    ON CONFLICT(work_id, tag_id) DO UPDATE SET
      source = excluded.source,
      weight = excluded.weight
  `);
  const deletePaperTagsForWork = database.prepare(`
    DELETE FROM paper_tags WHERE work_id = ?
  `);
  const recomputeOccurrence = database.prepare(`
    UPDATE tags SET occurrence_count = (
      SELECT COUNT(*) FROM paper_tags WHERE paper_tags.tag_id = tags.id
    ) WHERE id = ?
  `);
  const listTopTags = database.prepare(`
    SELECT id, label, normalized, source, source_kind, occurrence_count, created_at, updated_at
    FROM tags
    WHERE occurrence_count >= @minOccurrence
    ORDER BY occurrence_count DESC, normalized
    LIMIT @limit
  `);
  const listTagsForWork = database.prepare(`
    SELECT t.id, t.label, t.normalized, t.source, t.source_kind, t.occurrence_count,
      pt.source AS paper_source, pt.weight, pt.created_at
    FROM paper_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.work_id = ?
    ORDER BY pt.weight DESC, t.normalized
  `);
  const listWorksForTag = database.prepare(`
    SELECT w.id, w.title, w.year, w.type, w.canonical_provider, w.canonical_id,
      pt.source AS paper_source, pt.weight
    FROM paper_tags pt
    JOIN works w ON w.id = pt.work_id
    WHERE pt.tag_id = ?
    ORDER BY pt.weight DESC, w.id
    LIMIT @limit
  `);

  function ensureTag(label, source, sourceKind, now) {
    const normalized = label.normalized ?? label;
    const displayLabel = label.label ?? normalized;
    const id = tagId(normalized);
    insertTag.run({
      createdAt: now,
      id,
      label: displayLabel,
      normalized,
      source: tagSources.has(source) ? source : "extracted",
      sourceKind: sourceKind ?? null,
      updatedAt: now
    });
    return id;
  }

  const indexWork = database.transaction((workId, { title, abstract } = {}) => {
    const id = normalizeText(workId);
    if (!id) {
      throw new TagRepositoryError("invalid_work_id");
    }
    const now = new Date().toISOString();
    const collected = [];
    const seenNormalized = new Set();

    const addFromText = (text, source) => {
      for (const tag of extractTags(text)) {
        if (seenNormalized.has(tag.normalized)) {
          continue;
        }
        seenNormalized.add(tag.normalized);
        const tagIdValue = ensureTag(tag, "extracted", source, now);
        insertPaperTag.run({
          createdAt: now,
          source: paperTagSources.has(source) ? source : "title",
          tagId: tagIdValue,
          weight: source === "abstract" ? 0.6 : 1,
          workId: id
        });
        recomputeOccurrence.run(tagIdValue);
        collected.push({ label: tag.label, normalized: tag.normalized, source, tagId: tagIdValue });
      }
    };

    // 先清旧再重打，保证幂等（重索引不残留废弃 tag 链接）。
    deletePaperTagsForWork.run(id);
    if (title) {
      addFromText(title, "title");
    }
    if (abstract) {
      addFromText(abstract, "abstract");
    }

    // 重算所有受影响 tag 的 occurrence（已在上面对新插入的逐个重算；
    // 删除阶段可能让某些 tag 的 occurrence 变 0，统一重算被本 work 影响过的 tag）。
    const affected = database.prepare(
      "SELECT DISTINCT tag_id FROM paper_tags WHERE work_id = ?"
    ).all(id);
    for (const row of affected) {
      recomputeOccurrence.run(row.tag_id);
    }

    return {
      tags: collected,
      workId: id
    };
  });

  return {
    extractTags,

    getById(id) {
      return mapTag(findTagById.get(normalizeText(id)));
    },

    getByNormalized(normalized) {
      return mapTag(findTagByNormalized.get(normalizeText(normalized)));
    },

    indexWork(workId, input) {
      return indexWork(workId, input);
    },

    listTags({ limit = 100, minOccurrence = 1 } = {}) {
      return listTopTags.all({
        limit: Math.min(Math.max(1, Number(limit) || 100), 500),
        minOccurrence: Math.max(0, Number(minOccurrence) || 0)
      }).map(mapTag);
    },

    listTagsForWork(workId) {
      return listTagsForWork.all(normalizeText(workId)).map((row) => ({
        ...mapTag(row),
        paperSource: row.paper_source,
        weight: row.weight
      }));
    },

    listWorksForTag(tagId, { limit = 50 } = {}) {
      return listWorksForTag.all({
        limit: Math.min(Math.max(1, Number(limit) || 50), 200)
      }, normalizeText(tagId)).map((row) => ({
        ...mapWorkSummary(row),
        paperSource: row.paper_source,
        weight: row.weight
      }));
    }
  };
}
