import assert from "node:assert/strict";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
export async function verifyStructuredCollaboration(pool) {
  let allowed = true;
  const repository = new PostgresAnnotationCommunityRepository(pool, { authorizeOrganizationVisibility: async () => allowed });
  const host = { id: "structured-host", name: "Synthetic host", initials: "SH" };
  const reader = { id: "structured-reader", name: "Synthetic reader", initials: "SR" };
  const literature = await repository.confirmRefetchedLiterature(host, { candidateKey: "crossref:doi:10.1000/structured-pg", provider: "crossref", record: { title: "Synthetic structured source", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/structured-pg" }], year: 2026 } });
  assert.ok((await repository.readingSources("structured-org", host, "Synthetic structured")).some((item) => item.literatureId === literature.literatureId));
  const base = { body: "Structured pack", visibility: "organization", organizationId: "structured-org", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }], collaboration: { schemaVersion: 1, kind: "reading_pack", sourceRefs: [{ sourceNamespace: "intuecho.literature", sourceId: literature.literatureId, revision: literature.revision }] } };
  const pack = await repository.createAnnotation(host, { ...base, notificationIntent: "reading_task" });
  assert.equal(pack.collaboration.kind, "reading_pack");
  await repository.updateAnnotation(pack.id, host, { expectedRevision: 1, tags: ["Renamed"] });
  assert.equal((await repository.communitySourceRevision(reader, "intuecho.annotation", pack.id, 1)).collaboration.kind, "reading_pack");
  const question = (await repository.createReply(pack.id, reader, { body: "Original question", publishAsAnnotation: false, targets: [], tags: [], collaboration: { schemaVersion: 1, kind: "question", parentPackId: pack.id, sourceRefs: [] } })).reply;
  await repository.updateReply(question.id, reader, { body: "Corrected question", expectedRevision: 1 });
  const summary = { body: "Host synthesis", publishAsAnnotation: false, tags: [], targets: [], collaboration: { schemaVersion: 1, kind: "host_summary", parentPackId: pack.id, sourceRefs: [{ sourceNamespace: "intuecho.reply", sourceId: question.id, revision: 1 }] } };
  await assert.rejects(repository.createReply(pack.id, host, summary), { code: "SOURCE_REVISION_CONFLICT" });
  const historical = await repository.communitySourceRevision(host, "intuecho.reply", question.id, 1);
  assert.equal(historical.body, "Original question"); assert.equal(historical.currentRevision, 2); assert.equal(historical.collaboration.kind, "question");
  summary.collaboration.sourceRefs[0].revision = 2;
  assert.equal((await repository.createReply(pack.id, host, summary)).reply.collaboration.kind, "host_summary");
  await assert.rejects(repository.createReply(pack.id, reader, summary), { code: "HOST_SUMMARY_AUTHOR_REQUIRED" });
  allowed = false;
  await assert.rejects(repository.communitySourceRevision(reader, "intuecho.reply", question.id, 1), { code: "ANNOTATION_NOT_FOUND" });
  return { zeroDataSources: true, typedSemantics: true, actualRevisionChecked: true, historicalAccessRechecked: true };
}

export async function verifySourceCommitRaces(pool) {
  const host = { id: "source-race-host", name: "Synthetic host", initials: "SH" };
  const reader = { id: "source-race-reader", name: "Synthetic reader", initials: "SR" };
  let lockPid; let reachLock;
  const waiting = () => new Promise((resolve) => { reachLock = resolve; });
  let watchedSource;
  const wrappedPool = {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return { release: () => client.release(), query(sql, values) {
        const promise = client.query(sql, values);
        if (sql.includes("FROM annotation_replies") && sql.includes("FOR SHARE") && values?.[0] === watchedSource) { lockPid = client.processID; reachLock?.(); }
        return promise;
      } };
    }
  };
  const repository = new PostgresAnnotationCommunityRepository(wrappedPool, { authorizeOrganizationVisibility: async () => true });
  const literature = await repository.confirmRefetchedLiterature(host, { candidateKey: "crossref:doi:10.1000/source-race-pg", provider: "crossref", record: { title: "Synthetic source race", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/source-race-pg" }], year: 2026 } });
  const base = { body: "Source race pack", visibility: "organization", organizationId: "source-race-org", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }], collaboration: { schemaVersion: 1, kind: "reading_pack", sourceRefs: [] } };
  const pack = await repository.createAnnotation(host, base);
  for (const mode of ["edit", "withdraw"]) {
    const source = (await repository.createReply(pack.id, reader, { body: "Source before race", publishAsAnnotation: false, tags: [], targets: [] })).reply;
    const blocker = await pool.connect();
    let result;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM annotation_replies WHERE id = $1 FOR UPDATE", [source.id]);
      watchedSource = source.id;
      const reached = waiting();
      result = repository.createReply(pack.id, host, { body: "Must not commit stale synthesis", publishAsAnnotation: false, tags: [], targets: [], collaboration: { schemaVersion: 1, kind: "host_summary", parentPackId: pack.id, sourceRefs: [{ sourceNamespace: "intuecho.reply", sourceId: source.id, revision: 1 }] } }).then((value) => ({ value }), (error) => ({ error }));
      await reached;
      const deadline = Date.now() + 5000; let blocked = false;
      while (Date.now() < deadline) {
        const state = (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [lockPid])).rows[0];
        if (state?.wait_event_type === "Lock") { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "actual PostgreSQL source read must wait for the write lock");
      if (mode === "edit") await blocker.query("UPDATE annotation_replies SET body='Synthetic committed correction', revision=revision+1 WHERE id=$1", [source.id]);
      else await blocker.query("UPDATE annotation_replies SET body='[deleted]', deleted_at=now() WHERE id=$1", [source.id]);
      await blocker.query("COMMIT");
      const outcome = await result;
      assert.equal(outcome.error?.code, mode === "edit" ? "SOURCE_REVISION_CONFLICT" : "SOURCE_NOT_FOUND");
      assert.equal(Number((await pool.query("SELECT count(*) FROM annotation_replies WHERE parent_annotation_id=$1 AND author_id=$2", [pack.id, host.id])).rows[0].count), 0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  }
  const publicAnnotation = await repository.createAnnotation(host, { ...base, visibility: "public", organizationId: undefined, collaboration: undefined });
  const publicReply = (await repository.createReply(publicAnnotation.id, reader, { body: "Historical public reply", publishAsAnnotation: false, tags: [], targets: [] })).reply;
  await repository.updateReply(publicReply.id, reader, { body: "Current public reply", expectedRevision: 1 });
  assert.equal((await repository.communitySourceRevision(host, "intuecho.reply", publicReply.id, 1)).body, "Historical public reply");
  return { actualWriteLockBarrier: true, editDuringCommitRejected: true, withdrawalDuringCommitRejected: true, nullablePublicReplyHistory: true };
}
