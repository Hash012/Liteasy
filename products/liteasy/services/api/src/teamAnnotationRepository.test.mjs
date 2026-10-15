import assert from "node:assert/strict";
import test from "node:test";
import { PostgresTeamAnnotationRepository } from "./teamAnnotationRepository.mjs";

const memberScope = {
  actorId: "member_1",
  role: "member",
  scopeId: "organization_1",
  scopeType: "organization"
};

test("lists only annotations joined to an active document in the authorized organization", async () => {
  const calls = [];
  const repository = new PostgresTeamAnnotationRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        annotation_id: "annotation_1",
        body: { page: 2, text: "Shared note" },
        created_at: new Date("2026-08-06T00:00:00.000Z"),
        document_id: "document_1",
        organization_id: "organization_1",
        revision: 1,
        updated_at: new Date("2026-08-06T00:00:00.000Z"),
        uploaded_by: "member_1"
      }] };
    }
  });

  const result = await repository.list(memberScope, { documentId: "document_1" });
  assert.equal(result.annotations[0].annotationId, "annotation_1");
  assert.deepEqual(calls[0].values, ["organization_1", "document_1"]);
  assert.match(calls[0].sql, /entry\.scope_type = 'organization'/);
  assert.match(calls[0].sql, /entry\.scope_id = \$1/);
});

test("rejects invalid ids and oversized annotation bodies before persistence", async () => {
  const repository = new PostgresTeamAnnotationRepository({});
  await assert.rejects(() => repository.create(memberScope, {
    body: { text: "note" },
    documentId: "../another-scope",
    idempotencyKey: "annotation-create-0001"
  }), /library_document_invalid/);
  await assert.rejects(() => repository.create(memberScope, {
    body: { text: "x".repeat(70 * 1024) },
    documentId: "document_1",
    idempotencyKey: "annotation-create-0002"
  }), /annotation_body_too_large/);
});

test("does not let a member update another author's annotation", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM idempotency_records")) return { rows: [] };
      if (sql.includes("FROM team_annotations")) {
        return { rows: [{ annotation_id: "annotation_1", uploaded_by: "member_2" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresTeamAnnotationRepository({ async connect() { return client; } });
  await assert.rejects(() => repository.update(memberScope, {
    annotationId: "annotation_1",
    body: {
      clientAnnotationId: "local_1",
      excerpt: "Evidence",
      kind: "note",
      page: 1,
      rects: [],
      text: "replacement",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    expectedRevision: 1,
    idempotencyKey: "annotation-update-0001",
    traceId: "trace_1"
  }), /annotation_author_required/);
  assert.equal(queries.some((sql) => sql === "ROLLBACK"), true);
  assert.equal(queries.some((sql) => /UPDATE team_annotations/.test(sql)), false);
});

for (const color of ["orange", "purple", "cyan", "gray"]) test(`accepts ${color} highlights before the organization transaction`, async () => {
  const entered = new Error("transaction reached");
  const repository = new PostgresTeamAnnotationRepository({ async connect() { throw entered; } });
  await assert.rejects(repository.create(memberScope, {
    documentId: "document_1", idempotencyKey: `color-${color}-0001`,
    body: { clientAnnotationId: `local-${color}`, kind: "highlight", color, excerpt: "Evidence", page: 1,
      text: "高亮", rects: [{ left: 0.1, top: 0.1, width: 0.2, height: 0.03 }], updatedAt: "2026-10-15T00:00:00.000Z" }
  }), (error) => error === entered);
});
