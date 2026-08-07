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
    audience: session.audience,
    email: account.email,
    expiresAt: session.expiresAt,
    membershipTier: account.membershipTier,
    mfaVerifiedAt: session.mfaVerifiedAt,
    name: account.displayName,
    sessionId: sessionToken,
    userId: account.id
  };
}

function normalizeAudience(value) {
  if (value === undefined || value === null || value === "") {
    return "liteasy-desktop";
  }
  return ["liteasy-desktop", "intuecho-web", "liteasy-admin"].includes(value)
    ? value
    : null;
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
  mfaService,
  sessionDurationMs = 7 * 24 * 60 * 60 * 1000,
  sessionRepository
}) {
  async function issueSession(account, clientLabel, audience, mfaVerifiedAt = null) {
    sessionRepository.purgeExpired();
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs).toISOString();
    const session = sessionRepository.create({
      audience,
      clientLabel,
      expiresAt,
      mfaVerifiedAt,
      tokenHash: hashSessionToken(token),
      userId: account.id
    });
    return buildPublicSession(account, session, token);
  }

  return {
    async register({ audience: rawAudience, clientLabel, displayName: rawDisplayName, email: rawEmail, password }) {
      const email = normalizeEmail(rawEmail);
      const displayName = normalizeDisplayName(rawDisplayName, email);
      const audience = normalizeAudience(rawAudience);

      if (!audience) {
        throw new AuthError("invalid_session_audience", "客户端受众无效。", 400);
      }

      if (audience === "liteasy-admin") {
        throw new AuthError(
          "admin_registration_forbidden",
          "管理员账号必须通过安全引导或管理员邀请创建。",
          403
        );
      }

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
        return issueSession(account, clientLabel, audience);
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

    async login({ audience: rawAudience, clientLabel, email: rawEmail, mfaCode, password }) {
      const email = normalizeEmail(rawEmail);
      const audience = normalizeAudience(rawAudience);
      if (!audience) {
        throw new AuthError("invalid_session_audience", "客户端受众无效。", 400);
      }
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

      if (audience === "liteasy-admin" && credential.account.mustChangePassword) {
        throw new AuthError(
          "password_change_required",
          "首次管理员登录前必须更换一次性引导密码。",
          403
        );
      }

      let mfaVerifiedAt = null;
      if (audience === "liteasy-admin") {
        if (!mfaService?.isEnabled(credential.account.id)) {
          throw new AuthError("mfa_enrollment_required", "管理员账号尚未启用 MFA。", 403);
        }
        if (!mfaService.verify(credential.account.id, mfaCode)) {
          throw new AuthError("invalid_mfa_code", "动态验证码无效。", 401);
        }
        mfaVerifiedAt = new Date().toISOString();
      }

      accountRepository.markSuccessfulLogin(credential.account.id);
      return issueSession(credential.account, clientLabel, audience, mfaVerifiedAt);
    },

    async changeBootstrapPassword({ email: rawEmail, mfaCode, newPassword, password }) {
      const email = normalizeEmail(rawEmail);
      if (
        !validateEmail(email) ||
        !validatePassword(newPassword) ||
        typeof password !== "string" ||
        password.length > 128 ||
        newPassword === password
      ) {
        throw new AuthError(
          "invalid_password_change",
          "请提供有效的一次性密码、动态验证码和新的 12–128 位密码。",
          400
        );
      }
      const credential = accountRepository.findCredentialByEmail(email);
      if (!credential || !await verifyPassword(credential.passwordHash, password)) {
        throw new AuthError("invalid_credentials", "邮箱或密码不正确。", 401);
      }
      if (
        credential.account.status !== "active" ||
        !credential.account.mustChangePassword
      ) {
        throw new AuthError("password_change_not_required", "该账号不需要引导密码更换。", 409);
      }
      if (!mfaService?.isEnabled(credential.account.id)) {
        throw new AuthError("mfa_enrollment_required", "管理员账号尚未启用 MFA。", 403);
      }
      if (!mfaService.verify(credential.account.id, mfaCode)) {
        throw new AuthError("invalid_mfa_code", "动态验证码无效。", 401);
      }
      const passwordHash = await hashPassword(newPassword);
      accountRepository.replaceBootstrapPassword(credential.account.id, passwordHash);
      return { changed: true };
    },

    logout(sessionToken) {
      if (!isSecureSessionToken(sessionToken)) {
        return false;
      }
      return sessionRepository.revokeByTokenHash(hashSessionToken(sessionToken));
    },

    validateSession(sessionToken, expectedAudience = "liteasy-desktop") {
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

      if (session.audience !== expectedAudience) {
        throw new AuthError("invalid_session_audience", "登录会话不适用于当前客户端。", 403);
      }

      sessionRepository.touch(session.id);
      return buildPublicSession(session.account, session, sessionToken);
    }
  };
}
