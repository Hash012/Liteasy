import { randomUUID } from "node:crypto";

function mapSession(row) {
  if (!row) {
    return null;
  }

  return {
    account: {
      displayName: row.display_name,
      email: row.email,
      id: row.user_id,
      membershipTier: row.membership_tier,
      status: row.user_status
    },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    lastSeenAt: row.last_seen_at,
    audience: row.audience,
    mfaVerifiedAt: row.mfa_verified_at,
    revokedAt: row.revoked_at
  };
}

export function createAuthSessionRepository(database) {
  const insertSession = database.prepare(`
    INSERT INTO auth_sessions (
      id, user_id, token_hash, created_at, expires_at, last_seen_at, client_label,
      audience, mfa_verified_at
    ) VALUES (
      @id, @userId, @tokenHash, @createdAt, @expiresAt, @createdAt, @clientLabel,
      @audience, @mfaVerifiedAt
    )
  `);
  const findSession = database.prepare(`
    SELECT
      auth_sessions.id,
      auth_sessions.user_id,
      auth_sessions.created_at,
      auth_sessions.expires_at,
      auth_sessions.last_seen_at,
      auth_sessions.revoked_at,
      auth_sessions.audience,
      auth_sessions.mfa_verified_at,
      users.email,
      users.display_name,
      users.membership_tier,
      users.status AS user_status
    FROM auth_sessions
    INNER JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_hash = ?
  `);
  const touchSession = database.prepare(`
    UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?
  `);
  const revokeSession = database.prepare(`
    UPDATE auth_sessions
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE token_hash = ?
  `);
  const revokeUserSessions = database.prepare(`
    UPDATE auth_sessions
    SET revoked_at = COALESCE(revoked_at, ?)
    WHERE user_id = ?
  `);
  const deleteExpiredSessions = database.prepare(`
    DELETE FROM auth_sessions
    WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)
  `);

  return {
    create({
      audience = "liteasy-desktop",
      clientLabel = null,
      expiresAt,
      mfaVerifiedAt = null,
      tokenHash,
      userId
    }) {
      const createdAt = new Date().toISOString();
      const id = randomUUID();
      insertSession.run({
        audience,
        clientLabel,
        createdAt,
        expiresAt,
        id,
        mfaVerifiedAt,
        tokenHash,
        userId
      });
      return {
        audience,
        createdAt,
        expiresAt,
        id,
        mfaVerifiedAt
      };
    },

    findByTokenHash(tokenHash) {
      return mapSession(findSession.get(tokenHash));
    },

    purgeExpired(now = new Date().toISOString()) {
      const revokedRetentionThreshold = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      return deleteExpiredSessions.run(now, revokedRetentionThreshold).changes;
    },

    revokeByTokenHash(tokenHash) {
      return revokeSession.run(new Date().toISOString(), tokenHash).changes > 0;
    },

    revokeAllForUser(userId) {
      return revokeUserSessions.run(new Date().toISOString(), userId).changes;
    },

    touch(sessionId) {
      touchSession.run(new Date().toISOString(), sessionId);
    }
  };
}
