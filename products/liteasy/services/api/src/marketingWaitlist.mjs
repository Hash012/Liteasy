import { createHash, randomUUID } from "node:crypto";
import OSS from "ali-oss";

export class MarketingWaitlistError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function loadMarketingWaitlistConfig(env) {
  const origin = env.LITEASY_WAITLIST_ORIGIN?.trim();
  if (!origin) return undefined;
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin) {
    throw new Error("cloud_config_invalid: LITEASY_WAITLIST_ORIGIN must be an HTTPS origin");
  }
  const installerKey = env.LITEASY_WAITLIST_INSTALLER_KEY?.trim() || undefined;
  if (installerKey && (!installerKey.startsWith("installers/") || !installerKey.endsWith(".exe") ||
      installerKey.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\x00-\x1f\x7f]/.test(installerKey))) {
    throw new Error("cloud_config_invalid: installer key must be an installers/*.exe object key");
  }
  const expiresSeconds = Number(env.LITEASY_WAITLIST_DOWNLOAD_TTL_SECONDS ?? 600);
  if (!Number.isInteger(expiresSeconds) || expiresSeconds < 60 || expiresSeconds > 3600) {
    throw new Error("cloud_config_invalid: waitlist download TTL must be 60..3600 seconds");
  }
  const acceleration = env.LITEASY_WAITLIST_TRANSFER_ACCELERATION?.trim() || "false";
  if (!["true", "false"].includes(acceleration)) {
    throw new Error("cloud_config_invalid: LITEASY_WAITLIST_TRANSFER_ACCELERATION must be true or false");
  }
  return Object.freeze({ origin, installerKey, expiresSeconds, transferAcceleration: acceleration === "true" });
}

const roles = new Set(["本科生", "研究生", "青年研究者", "研究团队成员", "其他学习者"]);

function application(body) {
  const invalid = () => new MarketingWaitlistError("waitlist_input_invalid", 400, "请检查邮箱和申请信息。");
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["email", "role", "field", "problem"].includes(key))) throw invalid();
  const limits = { email: 254, role: 32, field: 200, problem: 2000 };
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = body[key] ?? "";
    if (typeof value !== "string" || value.length > limit || value.includes("\0")) throw invalid();
    result[key] = value.trim();
  }
  result.email = result.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) || !roles.has(result.role)) throw invalid();
  return result;
}

export function createOssInstallerSigner(s3, credentials, { Client = OSS, transferAcceleration = false } = {}) {
  if (s3.provider !== "aliyun-oss") throw new Error("waitlist_requires_aliyun_oss");
  return async (key, expiresSeconds) => {
    const auth = await credentials();
    const client = new Client({
      accessKeyId: auth.accessKeyId,
      accessKeySecret: auth.secretAccessKey,
      stsToken: auth.sessionToken,
      bucket: s3.bucket,
      region: `oss-${s3.region}`,
      ...(transferAcceleration ? { endpoint: "https://oss-accelerate.aliyuncs.com" } : {}),
      secure: true,
      authorizationV4: true,
      timeout: 15_000
    });
    // Check the configured object before returning a link; never sign a client-supplied key.
    await client.head(key);
    return client.signatureUrlV4("GET", expiresSeconds, {
      queries: {
        "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(key.split("/").at(-1))}`
      }
    }, key);
  };
}

export class MarketingWaitlistService {
  constructor(pool, config, signInstaller) {
    this.pool = pool;
    this.config = config;
    this.signInstaller = signInstaller;
  }

  async submit(body, { origin, clientIp }) {
    if (origin !== this.config.origin) {
      throw new MarketingWaitlistError("origin_forbidden", 403, "请从官方网站提交申请。");
    }
    const input = application(body);
    const clientHash = createHash("sha256").update(clientIp).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Persisted limits survive restarts and serialize concurrent public submissions.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('marketing-waitlist-submit'))");
      const counts = await client.query(`
        SELECT count(*) FILTER (WHERE client_hash = $1 OR email = $2)::int AS personal,
          count(*) FILTER (WHERE created_at > now() - interval '1 minute')::int AS global
        FROM marketing_waitlist_applications WHERE created_at > now() - interval '10 minutes'
      `, [clientHash, input.email]);
      if (counts.rows[0].personal >= 5 || counts.rows[0].global >= 100) {
        throw new MarketingWaitlistError("waitlist_rate_limited", 429, "提交过于频繁，请稍后重试。");
      }
      await client.query(`
        INSERT INTO marketing_waitlist_applications(id, email, role, research_field, problem, client_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [randomUUID(), input.email, input.role, input.field, input.problem, clientHash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!this.config.installerKey) {
      return { ok: true, message: "体验申请已记录，安装包暂未开放下载。" };
    }
    try {
      const downloadUrl = await this.signInstaller(this.config.installerKey, this.config.expiresSeconds);
      return { ok: true, downloadUrl, expiresIn: this.config.expiresSeconds };
    } catch {
      throw new MarketingWaitlistError("waitlist_download_unavailable", 503,
        "申请已记录，但安装包暂时无法下载，请稍后重新提交。");
    }
  }
}
