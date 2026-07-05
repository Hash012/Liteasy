import {
  hashPassword,
  performDummyPasswordVerification,
  verifyPassword
} from "./passwords.mjs";
import {
  createSessionToken,
  hashSessionToken,
  isSecureSessionToken
} from "./sessionTokens.mjs";

export class AuthError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function buildPublicSession(account, session, sessionToken) {
  return {
    email: account.email,
    expiresAt: session.expiresAt,
    membershipTier: account.membershipTier,
    name: account.displayName,
    sessionId: sessionToken,
    userId: account.id
  };
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeDisplayName(value, email) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return email.split("@")[0] || "Liteasy User";
}

function validateEmail(email) {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function validateDisplayName(displayName) {
  return displayName.length >= 1 && displayName.length <= 80;
}

function validatePassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128
  );
}

export function createAuthService({
  accountRepository,
  sessionDurationMs = 7 * 24 * 60 * 60 * 1000,
  sessionRepository
}) {
  async function issueSession(account, clientLabel) {
    sessionRepository.purgeExpired();
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
    const session = sessionRepository.create({
      clientLabel,
      expiresAt,
      tokenHash: hashSessionToken(token),
      userId: account.id
    });
    return buildPublicSession(account, session, token);
  }

  return {
    async register({ clientLabel, displayName: rawDisplayName, email: rawEmail, password }) {
      const email = normalizeEmail(rawEmail);
      const displayName = normalizeDisplayName(rawDisplayName, email);

      if (!validateEmail(email) || !validateDisplayName(displayName) || !validatePassword(password)) {
        throw new AuthError(
          "invalid_account_registration",
          "请填写有效邮箱和 1–80 字符昵称，并使用 12–128 位密码或密码短语。",
          400
        );
      }

      if (accountRepository.findPublicByEmail(email)) {
        throw new AuthError(
          "account_exists",
          "该邮箱已经注册，请直接登录。",
          409
        );
      }

      const passwordHash = await hashPassword(password);

      try {
        const account = accountRepository.create({
          displayName,
          email,
          passwordHash
        });
        return issueSession(account, clientLabel);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new AuthError(
            "account_exists",
            "该邮箱已经注册，请直接登录。",
            409
          );
        }
        throw error;
      }
    },

    async login({ clientLabel, email: rawEmail, password }) {
      const email = normalizeEmail(rawEmail);
      if (!validateEmail(email) || typeof password !== "string" || password.length > 128) {
        throw new AuthError(
          "invalid_credentials",
          "邮箱或密码不正确。",
          401
        );
      }

      const credential = accountRepository.findCredentialByEmail(email);
      if (!credential) {
        await performDummyPasswordVerification(password);
        throw new AuthError(
          "invalid_credentials",
          "邮箱或密码不正确。",
          401
        );
      }

      const passwordMatches = await verifyPassword(credential.passwordHash, password);
      if (!passwordMatches || credential.account.status !== "active") {
        throw new AuthError(
          "invalid_credentials",
          "邮箱或密码不正确。",
          401
        );
      }

      accountRepository.markSuccessfulLogin(credential.account.id);
      return issueSession(credential.account, clientLabel);
    },

    logout(sessionToken) {
      if (!isSecureSessionToken(sessionToken)) {
        return false;
      }
      return sessionRepository.revokeByTokenHash(hashSessionToken(sessionToken));
    },

    validateSession(sessionToken) {
      if (!isSecureSessionToken(sessionToken)) {
        throw new AuthError("invalid_session", "登录会话无效或已过期。", 401);
      }

      const session = sessionRepository.findByTokenHash(hashSessionToken(sessionToken));
      const isExpired = !session || Date.parse(session.expiresAt) <= Date.now();
      if (
        !session ||
        isExpired ||
        session.revokedAt !== null ||
        session.account.status !== "active"
      ) {
        throw new AuthError("invalid_session", "登录会话无效或已过期。", 401);
      }

      sessionRepository.touch(session.id);
      return buildPublicSession(session.account, session, sessionToken);
    }
  };
}
