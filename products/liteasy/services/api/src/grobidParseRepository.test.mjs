import assert from "node:assert/strict";
import test from "node:test";
import { PostgresGrobidParseRepository } from "./grobidParseRepository.mjs";

test("stores TEI and audits only bounded parsing metadata", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ params, sql });
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql.trim())) return { rows: [] };
      if (sql.includes("INSERT INTO grobid_parse_cache")) return { rows: [{
        content_fingerprint: params[0], parser_version: params[1], tei_xml: params[2]
      }] };
      if (sql.includes("INSERT INTO audit_events")) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release() {}
  };
  const repository = new PostgresGrobidParseRepository({ async connect() { return client; } });
  const input = {
    contentFingerprint: "a".repeat(64),
    parserVersion: 1,
    subjectId: "user-1",
    tei: "<TEI><text /></TEI>",
    traceId: "trace-1"
  };

  await repository.save(input);
  const audit = calls.find((call) => call.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit.params.includes(input.tei), false);
  assert.equal(JSON.stringify(audit.params).includes("%PDF"), false);
  assert.deepEqual(JSON.parse(audit.params[5]), { parserVersion: 1, reused: false });
});
