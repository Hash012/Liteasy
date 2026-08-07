import { createDatabase } from "../db/database.mjs";
import { createAccountRepository } from "../db/accountRepository.mjs";
import { createPlatformAdminRepository } from "../db/platformAdminRepository.mjs";
import { hashPassword } from "../auth/passwords.mjs";
import { createMfaService } from "../auth/mfa.mjs";
import { assertDevCloudDeploymentBoundary } from "../deploymentBoundary.mjs";

const email = process.env.LITEASY_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.LITEASY_ADMIN_PASSWORD;
const displayName = process.env.LITEASY_ADMIN_DISPLAY_NAME?.trim() || "Liteasy Administrator";
const environment = process.env.LITEASY_ADMIN_ENVIRONMENT ?? "development";
const developerDiagnostics = process.env.LITEASY_ADMIN_DEVELOPER_DIAGNOSTICS === "true";

if (!["development", "test"].includes(environment)) {
  throw new Error("LITEASY_ADMIN_ENVIRONMENT must be development or test for dev-cloud.");
}
assertDevCloudDeploymentBoundary({ requestedEnvironment: environment });
if (!email || !password || password.length < 12) {
  throw new Error("Set LITEASY_ADMIN_EMAIL and a LITEASY_ADMIN_PASSWORD of at least 12 characters.");
}
if (!process.env.LITEASY_MFA_MASTER_KEY || process.env.LITEASY_MFA_MASTER_KEY.length < 32) {
  throw new Error("Set LITEASY_MFA_MASTER_KEY to a deployment secret of at least 32 characters.");
}

const database = createDatabase();
try {
  const accounts = createAccountRepository(database);
  let account = accounts.findPublicByEmail(email);
  const passwordHash = await hashPassword(password);
  if (!account) {
    account = accounts.create({ displayName, email, passwordHash });
  } else {
    database.prepare(`
      UPDATE password_credentials SET password_hash = ?, algorithm = 'argon2id', updated_at = ?
      WHERE user_id = ?
    `).run(passwordHash, new Date().toISOString(), account.id);
  }
  const ownerKey = `user:${account.id}`;
  const admin = createPlatformAdminRepository(database, { environment });
  admin.grantRole(ownerKey, "platform_admin", "bootstrap");
  if (developerDiagnostics) {
    admin.grantRole(ownerKey, "developer_diagnostics", "bootstrap");
  }
  const enrollment = createMfaService(database).enroll(account.id);
  console.log(JSON.stringify({
    audience: "liteasy-admin",
    developerDiagnostics,
    email,
    environment,
    mfaSecret: enrollment.secret,
    otpauthUrl: enrollment.otpauthUrl,
    userId: account.id
  }, null, 2));
} finally {
  database.close();
}
