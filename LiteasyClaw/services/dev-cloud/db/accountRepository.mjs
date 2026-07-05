import { randomUUID } from "node:crypto";

function mapAccount(row) {
  if (!row) {
    return null;
  }

  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    lastLoginAt: row.last_login_at,
    membershipTier: row.membership_tier,
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
      id, email, display_name, membership_tier, status,
      created_at, updated_at, last_login_at
    FROM users
    WHERE email = ?
  `);
  const findCredential = database.prepare(`
    SELECT
      users.id,
      users.email,
      users.display_name,
      users.membership_tier,
      users.status,
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

    markSuccessfulLogin(userId) {
      const now = new Date().toISOString();
      markLogin.run(now, now, userId);
    }
  };
}
