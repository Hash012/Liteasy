import { randomUUID } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";

function fingerprint(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("grobid_fingerprint_invalid");
  }
  return value;
}

function parserVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("grobid_parser_version_invalid");
  return value;
}

function tei(value) {
  if (typeof value !== "string" || !value.includes("<TEI") || Buffer.byteLength(value) > 24 * 1024 * 1024) {
    throw new Error("grobid_tei_invalid");
  }
  return value;
}

function projection(row) {
  return row ? {
    contentFingerprint: row.content_fingerprint,
    parserVersion: Number(row.parser_version),
    tei: row.tei_xml
  } : undefined;
}

async function appendAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type,
      resource_id, scope_type, scope_id, trace_id, detail
    ) VALUES ($1, $2, 'liteasy-desktop', $3, 'grobid_parse_cache', $4,
      'user', $2, $5, $6::jsonb)
  `, [
    `audit_${randomUUID()}`,
    input.subjectId,
    input.reused ? "reuse_pdf_structure" : "parse_pdf_structure",
    input.contentFingerprint,
    input.traceId,
    JSON.stringify({ parserVersion: input.parserVersion, reused: input.reused })
  ]);
}

export class PostgresGrobidParseRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get(contentFingerprint) {
    const result = await this.pool.query(`
      SELECT content_fingerprint, parser_version, tei_xml
        FROM grobid_parse_cache
       WHERE content_fingerprint = $1
    `, [fingerprint(contentFingerprint)]);
    return projection(result.rows[0]);
  }

  async recordReuse(input) {
    return withPostgresTransaction(this.pool, async (client) => {
      await appendAudit(client, { ...input, reused: true });
    });
  }

  async save(input) {
    const contentFingerprint = fingerprint(input.contentFingerprint);
    const version = parserVersion(input.parserVersion);
    const teiXml = tei(input.tei);
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        INSERT INTO grobid_parse_cache(
          content_fingerprint, parser_version, tei_xml
        ) VALUES ($1, $2, $3)
        ON CONFLICT (content_fingerprint) DO UPDATE SET
          parser_version = excluded.parser_version,
          tei_xml = excluded.tei_xml,
          updated_at = now()
        RETURNING content_fingerprint, parser_version, tei_xml
      `, [contentFingerprint, version, teiXml]);
      await appendAudit(client, {
        contentFingerprint,
        parserVersion: version,
        reused: false,
        subjectId: input.subjectId,
        traceId: input.traceId
      });
      return projection(result.rows[0]);
    });
  }
}
