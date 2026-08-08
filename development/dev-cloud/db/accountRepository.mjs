import { randomUUID } from "node:crypto";

function mapAccount(row) {
  if (!row) {
    return null;
  }

  return {
    list() {
      return database.prepare(`
        SELECT id, email, display_name, membership_tier, status,
          must_change_password, created_at, updated_at, last_login_at
        FROM users ORDER BY created_at DESC, id
      `).all().map(mapAccount);
    },

    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    lastLoginAt: row.last_login_at,
    membershipTier: row.membership_tier,
    mustChangePassword: row.must_change_password === 1,
    status: row.status,
    updatedAt: row.updated_at
  };
}

export function createAccountRepository(database) {
  const insertUser = database.prepare(`
    INSERT INTO users (
      id, email, display_name, membership_tier, status, created_at, updated_at
    ) VALUES (
      @id, @email, @displayName, @membershipTier, 'active', @createdAt, @createdAt
    )
  `);
  const insertCredential = database.prepare(`
    INSERT INTO password_credentials (
      user_id, password_hash, algorithm, updated_at
    ) VALUES (
      @userId, @passwordHash, 'argon2id', @updatedAt
    )
  `);
  const findAccount = database.prepare(`
    SELECT
      id, email, display_name, membership_tier, status, must_change_password,
      created_at, updated_at, last_login_at
    FROM users
    WHERE email = ?
  `);
  const findAccountById = database.prepare(`
    SELECT
      id, email, display_name, membership_tier, status, must_change_password,
      created_at, updated_at, last_login_at
    FROM users
    WHERE id = ?
  `);
  const findCredential = database.prepare(`
    SELECT
      users.id,
      users.email,
      users.display_name,
      users.membership_tier,
      users.status,
      users.must_change_password,
      users.created_at,
      users.updated_at,
      users.last_login_at,
      password_credentials.password_hash
    FROM users
    INNER JOIN password_credentials
      ON password_credentials.user_id = users.id
    WHERE users.email = ?
  `);
  const markLogin = database.prepare(`
    UPDATE users
    SET last_login_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const createAccountTransaction = database.transaction(
    ({ displayName, email, membershipTier, passwordHash }) => {
      const now = new Date().toISOString();
      const id = randomUUID();
      insertUser.run({
        createdAt: now,
        displayName,
        email,
        id,
        membershipTier
      });
      insertCredential.run({
        passwordHash,
        updatedAt: now,
        userId: id
      });
      return mapAccount(findAccount.get(email));
    }
  );
  const setStatusTransaction = database.transaction((userId, status) => {
    const current = findAccountById.get(userId);
    if (!current) return null;
    if (current.status === "deleted" && status !== "deleted") {
      const error = new Error("deleted_account_status_is_final");
      error.code = "deleted_account_status_is_final";
      throw error;
    }
    const timestamp = new Date().toISOString();
    if (status === "deleted") {
      database.prepare(`
        UPDATE users SET status = 'deleted',
          email = ?, display_name = 'Deleted user', last_login_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(`deleted+${userId}@deleted.invalid`, timestamp, userId);
      database.prepare("DELETE FROM password_credentials WHERE user_id = ?").run(userId);
    } else {
      database.prepare(
        "UPDATE users SET status = ?, updated_at = ? WHERE id = ?"
      ).run(status, timestamp, userId);
    }
    if (status !== "active") {
      database.prepare(`
        UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ?
      `).run(timestamp, userId);
    }
    return mapAccount(findAccountById.get(userId));
  });

  return {
    create({ displayName, email, membershipTier = "pro", passwordHash }) {
      return createAccountTransaction({
        displayName,
        email,
        membershipTier,
        passwordHash
      });
    },

    findCredentialByEmail(email) {
      const row = findCredential.get(email);
      if (!row) {
        return null;
      }

      return {
        account: mapAccount(row),
        passwordHash: row.password_hash
      };
    },

    findPublicByEmail(email) {
      return mapAccount(findAccount.get(email));
    },

    findPublicById(userId) {
      return mapAccount(findAccountById.get(userId));
    },

    replaceBootstrapPassword(userId, passwordHash) {
      const timestamp = new Date().toISOString();
      database.transaction(() => {
        database.prepare(`
          UPDATE password_credentials
          SET password_hash = ?, algorithm = 'argon2id', updated_at = ?
          WHERE user_id = ?
        `).run(passwordHash, timestamp, userId);
        database.prepare(`
          UPDATE users SET must_change_password = 0, updated_at = ? WHERE id = ?
        `).run(timestamp, userId);
        database.prepare(`
          UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
          WHERE user_id = ?
        `).run(timestamp, userId);
      })();
      return mapAccount(findAccountById.get(userId));
    },

    setStatus(userId, status) {
      if (!["active", "disabled", "deleted"].includes(status)) {
        const error = new Error("invalid_account_status");
        error.code = "invalid_account_status";
        throw error;
      }
      return setStatusTransaction(userId, status);
    },

    markSuccessfulLogin(userId) {
      const now = new Date().toISOString();
      markLogin.run(now, now, userId);
    }
  };
}
