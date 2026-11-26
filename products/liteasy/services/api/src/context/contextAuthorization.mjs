import { ContextError } from "./contextError.mjs";

export function assertContextScope(principal, scopeKey, action) {
  const scopes = principal[action === "read" ? "readScopes" : "writeScopes"];
  if (!scopes.includes("*") && !scopes.includes(scopeKey)) throw new ContextError("context_scope_forbidden", 403);
}

export async function currentContextPrincipal(client, identity) {
  const status = await client.query(`
    SELECT 1 FROM account_status_projections WHERE subject_id=$1 AND status <> 'active'
    UNION ALL
    SELECT 1 FROM account_lifecycle_operations WHERE subject_id=$1 AND requested_status <> 'active' AND state='running'
    LIMIT 1
  `, [identity.subject]);
  if (status.rows.length) throw new ContextError("context_grant_invalid", 401);
  if (!identity.grantId) return { ...identity, readScopes: ["*"], writeScopes: ["*"] };
  const result = await client.query(`
    SELECT * FROM context_grants WHERE grant_id=$1 AND subject_id=$2
      AND revoked_at IS NULL AND expires_at > now() FOR SHARE
  `, [identity.grantId, identity.subject]);
  if (!result.rows[0]) throw new ContextError("context_grant_invalid", 401);
  const row = result.rows[0];
  await client.query("UPDATE context_grants SET last_used_at=now() WHERE grant_id=$1", [identity.grantId]);
  return { subject: identity.subject, actor: `grant:${row.grant_id}`, grantId: row.grant_id,
    readScopes: row.read_scopes, writeScopes: row.write_scopes, expiresAt: row.expires_at.toISOString() };
}
