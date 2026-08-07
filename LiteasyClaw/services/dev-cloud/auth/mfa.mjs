import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let encoded = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    encoded += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return encoded;
}

function derivedSecret(masterKey, userId, salt) {
  return createHmac("sha256", masterKey).update(`${userId}:${salt}`).digest();
}

function totp(secret, timestampMs) {
  const counter = BigInt(Math.floor(timestampMs / 30_000));
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(bytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function createMfaService(database, options = {}) {
  const masterKey = options.masterKey ?? process.env.LITEASY_MFA_MASTER_KEY;
  const now = () => options.now?.() ?? new Date();
  const setting = database.prepare("SELECT * FROM user_mfa_settings WHERE user_id = ?");

  function requireMasterKey() {
    if (typeof masterKey !== "string" || masterKey.length < 32) {
      const error = new Error("mfa_service_unavailable");
      error.code = "mfa_service_unavailable";
      throw error;
    }
    return masterKey;
  }

  return {
    enroll(userId, issuer = "Liteasy") {
      const key = requireMasterKey();
      const salt = randomBytes(24).toString("base64url");
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO user_mfa_settings (user_id, secret_salt, enabled, enrolled_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          secret_salt = excluded.secret_salt,
          enabled = 1,
          enrolled_at = excluded.enrolled_at,
          updated_at = excluded.updated_at
      `).run(userId, salt, timestamp, timestamp);
      const secret = base32(derivedSecret(key, userId, salt));
      return {
        otpauthUrl: `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(userId)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
        secret
      };
    },

    isEnabled(userId) {
      return setting.get(userId)?.enabled === 1;
    },

    verify(userId, codeInput) {
      const row = setting.get(userId);
      const code = typeof codeInput === "string" ? codeInput.trim() : "";
      if (!row || row.enabled !== 1 || !/^\d{6}$/.test(code)) return false;
      const secret = derivedSecret(requireMasterKey(), userId, row.secret_salt);
      const timestamp = now().getTime();
      return [-1, 0, 1].some((window) => {
        const expected = Buffer.from(totp(secret, timestamp + window * 30_000));
        const received = Buffer.from(code);
        return expected.length === received.length && timingSafeEqual(expected, received);
      });
    }
  };
}
