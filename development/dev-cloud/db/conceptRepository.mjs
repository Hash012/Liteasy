import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function mapConcept(row) {
  if (!row) {
    return null;
  }
  return {
    categoryCode: row.category_code,
    categoryName: row.category_name,
    conceptKind: row.concept_kind,
    createdAt: row.created_at,
    id: row.id,
    label: row.label,
    parentId: row.parent_concept_id,
    source: row.source,
    sourceId: row.source_id
  };
}

export function createConceptRepository(database) {
  const upsertConcept = database.prepare(`
    INSERT INTO concepts (
      id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    ) VALUES (
      @id, @label, @source, @sourceId, @conceptKind, @parentId,
      @categoryCode, @categoryName, @createdAt
    )
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      source = excluded.source,
      source_id = excluded.source_id,
      concept_kind = excluded.concept_kind,
      parent_concept_id = excluded.parent_concept_id,
      category_code = excluded.category_code,
      category_name = excluded.category_name
  `);
  const findById = database.prepare(`
    SELECT id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    FROM concepts WHERE id = ?
  `);
  const findBySource = database.prepare(`
    SELECT id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    FROM concepts WHERE source = ? AND source_id = ?
  `);
  const listBySource = database.prepare(`
    SELECT id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    FROM concepts WHERE source = ? ORDER BY source_id, label
  `);
  const listByParent = database.prepare(`
    SELECT id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    FROM concepts WHERE parent_concept_id = ? ORDER BY source_id, label
  `);
  const listAll = database.prepare(`
    SELECT id, label, source, source_id, concept_kind, parent_concept_id,
      category_code, category_name, created_at
    FROM concepts ORDER BY source, source_id, label
  `);
  const countBySource = database.prepare(`
    SELECT COUNT(*) AS total FROM concepts WHERE source = ?
  `);

  const seedDisciplineCatalog = database.transaction((items) => {
    const now = new Date().toISOString();
    const categoryCache = new Map();
    let categories = 0;
    let disciplines = 0;

    const ensureCategory = (item) => {
      const categoryCode = normalizeText(item.categoryCode);
      const categoryName = normalizeText(item.categoryName);
      if (!categoryCode || !categoryName) {
        return null;
      }
      if (categoryCache.has(categoryCode)) {
        return categoryCache.get(categoryCode);
      }
      const id = `discipline:cat:${categoryCode}`;
      upsertConcept.run({
        categoryCode,
        categoryName,
        conceptKind: "category",
        createdAt: now,
        id,
        label: categoryName,
        parentId: null,
        source: "discipline_catalog",
        sourceId: categoryCode
      });
      categoryCache.set(categoryCode, id);
      categories += 1;
      return id;
    };

    for (const item of Array.isArray(items) ? items : []) {
      const code = normalizeText(item.code);
      const name = normalizeText(item.name);
      if (!code || !name) {
        continue;
      }
      const parentId = ensureCategory(item);
      upsertConcept.run({
        categoryCode: normalizeText(item.categoryCode),
        categoryName: normalizeText(item.categoryName),
        conceptKind: "discipline",
        createdAt: now,
        id: `discipline:${code}`,
        label: name,
        parentId,
        source: "discipline_catalog",
        sourceId: code
      });
      disciplines += 1;
    }

    return { categories, disciplines };
  });

  return {
    countBySource(source) {
      return countBySource.get(source)?.total ?? 0;
    },

    getById(id) {
      return mapConcept(findById.get(normalizeText(id)));
    },

    getBySourceId(source, sourceId) {
      return mapConcept(findBySource.get(normalizeText(source), normalizeText(sourceId)));
    },

    getByCode(code) {
      return mapConcept(findBySource.get("discipline_catalog", normalizeText(code)));
    },

    list({ source, parentId, conceptKind } = {}) {
      let rows;
      if (parentId) {
        rows = listByParent.all(normalizeText(parentId));
      } else if (source) {
        rows = listBySource.all(normalizeText(source));
      } else {
        rows = listAll.all();
      }
      const mapped = rows.map(mapConcept);
      return conceptKind ? mapped.filter((c) => c.conceptKind === conceptKind) : mapped;
    },

    seedDisciplineCatalog(items) {
      return seedDisciplineCatalog(items);
    }
  };
}

export function loadDisciplineCatalog() {
  const catalogPath = path.resolve(currentDir, "../../../products/liteasy/packages/shared/disciplineCatalog.json");
  const raw = fs.readFileSync(catalogPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    name: parsed.name,
    scope: parsed.scope,
    source: parsed.source,
    items: Array.isArray(parsed.items) ? parsed.items : []
  };
}
