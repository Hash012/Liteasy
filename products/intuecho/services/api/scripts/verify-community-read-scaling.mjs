import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";

export async function verifyCommunityReadScaling(pool) {
  const fixtureId = randomUUID();
  let queryCount = 0;
  const counted = { query: (...args) => { queryCount += 1; return pool.query(...args); }, connect: (...args) => pool.connect(...args) };
  const repository = new PostgresAnnotationCommunityRepository(counted);
  const actor = { id: "scale-pg-author", name: "Synthetic scale author", initials: "SS" };
  const reader = { id: "scale-pg-reader", name: "Synthetic scale reader", initials: "SR" };
  const report = [];
  for (const size of [100, 1000, 10000]) {
    const prefix = `scale-pg-${fixtureId}-${size}-`;
    const literature = await repository.confirmRefetchedLiterature(actor, { candidateKey: `crossref:doi:10.1000/scale-${fixtureId}-${size}`, provider: "crossref", record: { title: `Synthetic scale ${size}`, authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: `10.1000/scale-${fixtureId}-${size}` }], year: 2026 } });
    const fixtureClient = await pool.connect();
    await fixtureClient.query("BEGIN");
    try {
    await fixtureClient.query(`INSERT INTO annotations(id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, share_to_plaza, created_at, updated_at)
      SELECT $1 || n::text, 'Synthetic scale body', $2, 'Synthetic', 'SS', '{}'::jsonb, 'public', true,
        '2026-01-01'::timestamptz + n * interval '1 microsecond', '2026-01-01'::timestamptz FROM generate_series(1, $3::integer) n`, [prefix, actor.id, size]);
    await fixtureClient.query(`INSERT INTO annotation_targets(id, annotation_id, literature_id, target_kind, position, target)
      SELECT $1 || 'target-' || n::text, $1 || n::text, $2, 'whole_document', 0,
        jsonb_build_object('kind', 'whole_document', 'literature', jsonb_build_object('literatureId', $2::text)) FROM generate_series(1, $3::integer) n`, [prefix, literature.literatureId, size]);
    await fixtureClient.query("COMMIT");
    } catch (error) { await fixtureClient.query("ROLLBACK"); throw error; } finally { fixtureClient.release(); }
    await pool.query("ANALYZE annotations; ANALYZE annotation_targets; ANALYZE literature_identifiers");
    const samples = []; let counts = [];
    for (let iteration = 0; iteration < 15; iteration += 1) {
      queryCount = 0; const start = performance.now();
      const page = await repository.plazaPage(reader, { literatureId: literature.literatureId, limit: 30 });
      samples.push(performance.now() - start); counts.push(queryCount);
      assert.equal(page.annotations.length, 30); assert.ok(page.nextCursor);
      assert.ok(page.annotations.every((item) => item.targets[0].literature.literatureRecord.literatureId === literature.literatureId));
    }
    assert.ok(Math.max(...counts) <= 10, `bounded hydration must not regress to N+1: ${counts}`);
    queryCount = 0;
    for (let index = size; index > size - 30; index -= 1) await repository.annotation(`${prefix}${index}`, reader);
    const detailQueriesFor30 = queryCount;
    let cursor; const seen = new Set();
    do {
      const page = await repository.plazaPage(reader, { literatureId: literature.literatureId, limit: 100, cursor });
      for (const annotation of page.annotations) { assert.ok(!seen.has(annotation.id)); seen.add(annotation.id); }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, size, "microsecond cursor must not skip rows truncated by JS Date");
    await repository.withdraw(`${prefix}${size}`, actor);
    assert.ok(!(await repository.plazaPage(reader, { literatureId: literature.literatureId, limit: 30 })).annotations.some((item) => item.id === `${prefix}${size}`));
    const plan = (await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM annotations WHERE share_to_plaza AND visibility='public' AND withdrawn_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 30")).rows[0]["QUERY PLAN"][0];
    const identifierPlan = (await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT literature_id FROM literature_identifiers WHERE identifier_kind='doi' AND normalized_value=$1", [`10.1000/scale-${fixtureId}-${size}`])).rows[0]["QUERY PLAN"][0];
    samples.sort((a, b) => a - b);
    report.push({ fixtureRows: size, iterations: samples.length, pageSize: 30, pageQueries: Math.max(...counts), detailQueriesFor30, p95Ms: Number(samples[Math.ceil(samples.length * .95) - 1].toFixed(3)), pagePlan: plan.Plan, identifierPlan: identifierPlan.Plan });
  }
  let allowed = true;
  const scoped = new PostgresAnnotationCommunityRepository(pool, { listOrganizations: async () => [{ organizationId: "scale-revoked", name: "Synthetic", role: "member" }], authorizeOrganizationVisibility: async () => allowed });
  const literature = await scoped.findLiteratureByIdentifiers([{ kind: "doi", value: `https://doi.org/10.1000/scale-${fixtureId}-100` }]);
  assert.ok(literature);
  const org = await scoped.createAnnotation(actor, { body: "Synthetic revoked content", visibility: "organization", organizationId: "scale-revoked", shareToPlaza: false, targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }], tags: [] });
  assert.equal((await scoped.organizationFeed(reader))[0].annotations[0].id, org.id);
  allowed = false;
  assert.deepEqual(await scoped.organizationFeed(reader), []);
  return { fixtureVersion: "community-read-scale-v1", measurements: report, currentScopeRechecked: true, cursorNoGapsOrDuplicates: true };
}
