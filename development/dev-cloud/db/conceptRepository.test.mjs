import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./database.mjs";
import { createConceptRepository, loadDisciplineCatalog } from "./conceptRepository.mjs";

function sampleCatalogItems() {
  return [
    { categoryCode: "01", categoryName: "哲学", code: "0101", name: "哲学" },
    { categoryCode: "02", categoryName: "经济学", code: "0201", name: "理论经济学" },
    { categoryCode: "02", categoryName: "经济学", code: "0202", name: "应用经济学" }
  ];
}

test("seedDisciplineCatalog inserts categories and disciplines with parent links", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  const result = repo.seedDisciplineCatalog(sampleCatalogItems());
  assert.equal(result.categories, 2);
  assert.equal(result.disciplines, 3);

  const philosophy = repo.getByCode("0101");
  assert.equal(philosophy.label, "哲学");
  assert.equal(philosophy.conceptKind, "discipline");
  assert.equal(philosophy.source, "discipline_catalog");
  assert.equal(philosophy.parentId, "discipline:cat:01");

  const category = repo.getByCode("01");
  assert.equal(category.conceptKind, "category");
  assert.equal(category.parentId, null);
});

test("seedDisciplineCatalog is idempotent on re-seed", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  repo.seedDisciplineCatalog(sampleCatalogItems());
  const again = repo.seedDisciplineCatalog(sampleCatalogItems());
  // Idempotent: counts reflect items seen this run, not new rows.
  assert.equal(again.categories, 2);
  assert.equal(again.disciplines, 3);
  assert.equal(repo.countBySource("discipline_catalog"), 5); // 2 categories + 3 disciplines
});

test("list filters by parent returns only children", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  repo.seedDisciplineCatalog(sampleCatalogItems());
  const economicsChildren = repo.list({ parentId: "discipline:cat:02" });
  assert.equal(economicsChildren.length, 2);
  assert.ok(economicsChildren.every((c) => c.conceptKind === "discipline"));
});

test("list filters by source and concept kind", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  repo.seedDisciplineCatalog(sampleCatalogItems());
  const categories = repo.list({ source: "discipline_catalog", conceptKind: "category" });
  assert.equal(categories.length, 2);
  const disciplines = repo.list({ source: "discipline_catalog", conceptKind: "discipline" });
  assert.equal(disciplines.length, 3);
});

test("getByCode returns null for unknown code", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  repo.seedDisciplineCatalog(sampleCatalogItems());
  assert.equal(repo.getByCode("9999"), null);
});

test("loadDisciplineCatalog loads the real shared catalog", () => {
  const catalog = loadDisciplineCatalog();
  assert.equal(catalog.items.length, 117);
  assert.ok(catalog.items[0].categoryCode);
});

test("seeding the real catalog produces 117 disciplines and 14 categories", () => {
  const repo = createConceptRepository(createDatabase({ databasePath: ":memory:" }));
  const catalog = loadDisciplineCatalog();
  repo.seedDisciplineCatalog(catalog.items);
  const disciplines = repo.list({ source: "discipline_catalog", conceptKind: "discipline" });
  const categories = repo.list({ source: "discipline_catalog", conceptKind: "category" });
  assert.equal(disciplines.length, 117);
  assert.equal(categories.length, 14);
});
