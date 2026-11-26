import { createHash, randomBytes, randomUUID } from "node:crypto";
import { apiVersion, ContextError } from "./contextError.mjs";
import { validateContext, validateUuid } from "./contextValidation.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
function view(row) {
  return { id: row.grant_id, name: row.name, readScopes: row.read_scopes, writeScopes: row.write_scopes,
    createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null, lastUsedAt: row.last_used_at?.toISOString() ?? null };
}

export class ContextGrantRepository {
  constructor(entries) { this.entries = entries; }
  async authenticate(header) {
    const secret = typeof header === "string" ? /^Bearer (lcg_[A-Za-z0-9_-]{43})$/i.exec(header)?.[1] : null;
    if (!secret) throw new ContextError("context_grant_invalid", 401);
    const row = (await this.entries.pool.query("SELECT grant_id,subject_id FROM context_grants WHERE secret_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [digest(secret)])).rows[0];
    if (!row) throw new ContextError("context_grant_invalid", 401);
    return { subject: row.subject_id, actor: `grant:${row.grant_id}`, grantId: row.grant_id };
  }
  async create(identity, input) {
    validateContext("grantInput", input);
    if (!input.name.trim() || input.readScopes.length + input.writeScopes.length === 0 ||
      Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 366 * 86400_000) {
      throw new ContextError("context_grant_input_invalid");
    }
    return this.entries.transaction(identity, async (client, principal) => {
      if (principal.grantId) throw new ContextError("context_grant_management_forbidden", 403);
      const count = await client.query("SELECT count(*)::int AS count FROM context_grants WHERE subject_id=$1 AND revoked_at IS NULL AND expires_at>now()", [principal.subject]);
      if (count.rows[0].count >= 100) throw new ContextError("context_grant_limit", 409);
      const secret = `lcg_${randomBytes(32).toString("base64url")}`;
      const row = (await client.query(`
        INSERT INTO context_grants(grant_id,subject_id,name,secret_hash,read_scopes,write_scopes,expires_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *
      `, [randomUUID(), principal.subject, input.name, digest(secret), JSON.stringify(input.readScopes), JSON.stringify(input.writeScopes), input.expiresAt])).rows[0];
      return { schemaVersion: apiVersion, grant: view(row), secret };
    });
  }
  async list(identity) {
    return this.entries.transaction(identity, async (client, principal) => {
      if (principal.grantId) throw new ContextError("context_grant_management_forbidden", 403);
      const rows = (await client.query("SELECT * FROM context_grants WHERE subject_id=$1 ORDER BY (revoked_at IS NULL AND expires_at>now()) DESC,created_at DESC LIMIT 100", [principal.subject])).rows;
      return { schemaVersion: apiVersion, grants: rows.map(view) };
    });
  }
  async revoke(identity, id) {
    validateUuid(id);
    return this.entries.transaction(identity, async (client, principal) => {
      if (principal.grantId) throw new ContextError("context_grant_management_forbidden", 403);
      const result = await client.query("UPDATE context_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id=$1 AND subject_id=$2", [id, principal.subject]);
      if (!result.rowCount) throw new ContextError("context_not_found", 404);
      return { schemaVersion: apiVersion, revoked: true };
    });
  }
}
