import { createHash, randomUUID } from "node:crypto";
import { withAccountWriteTransaction } from "../accountDeletionFence.mjs";
import { assertContextScope, currentContextPrincipal } from "./contextAuthorization.mjs";
import { apiVersion, ContextError, idempotencyWindowSeconds } from "./contextError.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function hash(value) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function receipt(row) {
  return { schemaVersion: apiVersion, operationId: row.operation_id, entryId: row.entry_id,
    revision: Number(row.revision), scopeKey: row.scope_key, action: row.action,
    committedAt: row.committed_at.toISOString(), expiresAt: row.expires_at.toISOString() };
}
function entry(row) {
  return { ...row.content, schemaVersion: "liteasy.context-entry/v1", id: row.entry_id,
    revision: Number(row.revision), owner: row.subject_id, actor: row.actor,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function readCursor(value, fingerprint) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed.f !== fingerprint || !Array.isArray(parsed.at) || parsed.at.length !== 2 ||
      !/^\d{4}-.*Z$/.test(parsed.at[0]) || !Number.isFinite(Date.parse(parsed.at[0])) ||
      !/^[a-f0-9-]{36}$/.test(parsed.at[1])) throw new Error();
    return parsed.at;
  } catch { throw new ContextError("context_cursor_invalid"); }
}

export class PostgresContextEntryRepository {
  constructor(pool) { this.pool = pool; }
  async transaction(identity, operation) {
    return withAccountWriteTransaction(this.pool, identity.subject, async (client) => {
      const principal = await currentContextPrincipal(client, identity);
      return operation(client, principal);
    });
  }
  async whoami(identity) {
    return this.transaction(identity, async (_client, principal) => ({
      schemaVersion: apiVersion, subject: principal.subject, actor: principal.actor,
      readScopes: principal.readScopes, writeScopes: principal.writeScopes,
      expiresAt: principal.expiresAt ?? null, idempotencyWindowSeconds
    }));
  }
  async write(identity, input) {
    return this.transaction(identity, async (client, principal) => {
      await client.query("DELETE FROM context_operations WHERE subject_id=$1 AND expires_at<=now()", [principal.subject]);
      const prior = (await client.query("SELECT * FROM context_operations WHERE subject_id=$1 AND operation_id=$2", [principal.subject, input.operationId])).rows[0];
      if (prior) {
        assertContextScope(principal, prior.scope_key, "write");
        if (prior.request_hash !== hash(input)) throw new ContextError("context_operation_conflict", 409);
        return receipt(prior);
      }
      const creating = input.action === "create";
      let current;
      if (!creating) {
        current = (await client.query("SELECT * FROM context_entries WHERE subject_id=$1 AND entry_id=$2 AND deleted_at IS NULL FOR UPDATE", [principal.subject, input.entryId])).rows[0];
        if (!current) throw new ContextError("context_not_found", 404);
      }
      const scopeKey = current?.scope_key ?? input.entry.scopeKey;
      assertContextScope(principal, scopeKey, "write");
      if (current && Number(current.revision) !== input.expectedRevision) throw new ContextError("context_revision_conflict", 409, Number(current.revision));
      if (input.entry && scopeKey !== input.entry.scopeKey) throw new ContextError("context_scope_immutable", 409);
      const id = current?.entry_id ?? randomUUID();
      const nextRevision = Number(current?.revision ?? 0) + 1;
      if (input.action === "delete") {
        await client.query("DELETE FROM context_revisions WHERE entry_id=$1", [id]);
        await client.query("UPDATE context_entries SET content=NULL,deleted_at=now(),updated_at=now(),revision=$2,actor=$3 WHERE entry_id=$1", [id, nextRevision, principal.actor]);
      } else {
        const content = JSON.stringify(input.entry);
        if (creating) {
          await client.query("INSERT INTO context_entries(entry_id,subject_id,scope_key,revision,content,actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [id, principal.subject, scopeKey, nextRevision, content, principal.actor]);
        } else {
          await client.query("UPDATE context_entries SET revision=$2,content=$3::jsonb,actor=$4,updated_at=now() WHERE entry_id=$1", [id, nextRevision, content, principal.actor]);
        }
        await client.query("INSERT INTO context_revisions(entry_id,revision,content,actor) VALUES ($1,$2,$3::jsonb,$4)", [id, nextRevision, content, principal.actor]);
      }
      const result = await client.query(`
        INSERT INTO context_operations(subject_id,operation_id,request_hash,entry_id,revision,scope_key,action,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now()+$8*interval '1 second') RETURNING *
      `, [principal.subject, input.operationId, hash(input), id, nextRevision, scopeKey, input.action, idempotencyWindowSeconds]);
      return receipt(result.rows[0]);
    });
  }
  async get(identity, id) {
    return this.transaction(identity, async (client, principal) => {
      const row = (await client.query("SELECT * FROM context_entries WHERE subject_id=$1 AND entry_id=$2 AND deleted_at IS NULL", [principal.subject, id])).rows[0];
      if (!row) throw new ContextError("context_not_found", 404);
      assertContextScope(principal, row.scope_key, "read");
      return { schemaVersion: apiVersion, entry: entry(row) };
    });
  }
  async operation(identity, id) {
    return this.transaction(identity, async (client, principal) => {
      const row = (await client.query("SELECT * FROM context_operations WHERE subject_id=$1 AND operation_id=$2 AND expires_at>now()", [principal.subject, id])).rows[0];
      if (!row) throw new ContextError("context_not_found", 404);
      assertContextScope(principal, row.scope_key, "write");
      return receipt(row);
    });
  }
  async list(identity, filters = {}) {
    return this.transaction(identity, async (client, principal) => {
      for (const scope of filters.scopes ?? []) assertContextScope(principal, scope, "read");
      const { cursor, limit = 50, ...criteria } = filters;
      const fingerprint = hash({ subject: principal.subject, allowed: principal.readScopes, ...criteria });
      const after = readCursor(cursor, fingerprint);
      const values = [principal.subject, principal.readScopes.includes("*") ? null : principal.readScopes, filters.status ?? "active"];
      const conditions = ["subject_id=$1", "deleted_at IS NULL", "($2::text[] IS NULL OR scope_key=ANY($2))", "content->>'status'=$3"];
      const add = (clause, value) => { values.push(value); conditions.push(clause.replaceAll("?", `$${values.length}`)); };
      if (filters.scopes?.length) add("scope_key=ANY(?::text[])", filters.scopes);
      if (filters.kinds?.length) add("content->>'kind'=ANY(?::text[])", filters.kinds);
      if (filters.tags?.length) add("(content->'tags') @> ?::jsonb", JSON.stringify(filters.tags));
      // NFKC + case folding and substring matching handle Chinese without an English-only FTS dictionary.
      for (const term of (filters.query ?? "").normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean)) {
        add("strpos(lower(normalize((content->>'title') || E'\\n' || (content->>'bodyMarkdown') || E'\\n' || (content->'tags')::text, NFKC)),?)>0", term);
      }
      if (after) {
        values.push(after[0], after[1]);
        conditions.push(`(updated_at,entry_id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
      }
      values.push(limit + 1);
      const rows = (await client.query(`SELECT *,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM context_entries WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC,entry_id DESC LIMIT $${values.length}`, values)).rows;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ f: fingerprint, at: [last.cursor_time, last.entry_id] })).toString("base64url") : null;
      return { schemaVersion: apiVersion, entries: page.map(entry), nextCursor };
    });
  }
  async history(identity, id, { limit = 50, cursor } = {}) {
    return this.transaction(identity, async (client, principal) => {
      const current = (await client.query("SELECT * FROM context_entries WHERE subject_id=$1 AND entry_id=$2 AND deleted_at IS NULL", [principal.subject, id])).rows[0];
      if (!current) throw new ContextError("context_not_found", 404);
      assertContextScope(principal, current.scope_key, "read");
      const before = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(before) || before < 1) throw new ContextError("context_cursor_invalid");
      const rows = (await client.query("SELECT * FROM context_revisions WHERE entry_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT $3", [id, before, limit + 1])).rows;
      const revisions = rows.slice(0, limit).map((row) => entry({ ...current, ...row, updated_at: row.committed_at }));
      return { schemaVersion: apiVersion, revisions, nextCursor: rows.length > limit ? String(revisions.at(-1).revision) : null };
    });
  }
}
