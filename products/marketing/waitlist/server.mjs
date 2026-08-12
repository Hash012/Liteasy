import { createHash, createHmac, createPublicKey, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const DEFAULT_ROLES = new Set(["本科生", "研究生", "青年研究者", "研究团队成员", "其他学习者"]);
const BODY_LIMIT_BYTES = 16 * 1024;
const INSTALLER_LIMIT_BYTES = 300 * 1024 * 1024;
const githubOidcCache = { expiresAt: 0, keys: [] };

function getConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? process.env.WAITLIST_DATA_DIR ?? "/var/lib/liteasy/waitlist";
  const originSetting = overrides.allowedOrigins ?? process.env.WAITLIST_ALLOWED_ORIGINS ?? "";
  const allowedOrigins = Array.isArray(originSetting)
    ? originSetting
    : String(originSetting).split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    host: overrides.host ?? process.env.WAITLIST_HOST ?? process.env.HOST ?? "127.0.0.1",
    port: Number(overrides.port ?? process.env.WAITLIST_PORT ?? process.env.PORT ?? 8787),
    socketPath: overrides.socketPath ?? process.env.WAITLIST_SOCKET_PATH ?? "",
    dataFile: overrides.dataFile ?? resolve(dataDir, "waitlist-submissions.jsonl"),
    allowedOrigins,
    maxPerHour: Number(overrides.maxPerHour ?? process.env.WAITLIST_MAX_PER_HOUR ?? 5),
    notifyWebhookUrl: overrides.notifyWebhookUrl ?? process.env.WAITLIST_NOTIFY_WEBHOOK_URL ?? "",
    notifyTimeoutMs: Number(overrides.notifyTimeoutMs ?? process.env.WAITLIST_NOTIFY_TIMEOUT_MS ?? 3000),
    applicationApiUrl: overrides.applicationApiUrl ?? process.env.WAITLIST_APPLICATION_API_URL ?? "",
    applicationApiSecret: overrides.applicationApiSecret ?? process.env.WAITLIST_APPLICATION_API_SECRET ?? "",
    applicationApiTimeoutMs: Number(overrides.applicationApiTimeoutMs ?? process.env.WAITLIST_APPLICATION_API_TIMEOUT_MS ?? 5000),
    applicationWriter: overrides.applicationWriter,
    installerPath: overrides.installerPath ?? process.env.WAITLIST_INSTALLER_PATH ?? "",
    installerName: overrides.installerName ?? process.env.WAITLIST_INSTALLER_NAME ?? "Liteasy-windows-x64-setup.exe",
    downloadSecret: overrides.downloadSecret ?? process.env.WAITLIST_DOWNLOAD_SECRET ?? "",
    downloadTtlSeconds: Number(overrides.downloadTtlSeconds ?? process.env.WAITLIST_DOWNLOAD_TTL_SECONDS ?? 600),
    releaseAudience: overrides.releaseAudience ?? process.env.WAITLIST_RELEASE_AUDIENCE ?? "liteasy-staging-installer-upload",
    releaseRepository: overrides.releaseRepository ?? process.env.WAITLIST_RELEASE_REPOSITORY ?? "Hash012/Liteasy",
    releaseVersion: overrides.releaseVersion ?? process.env.WAITLIST_RELEASE_VERSION ?? "0.1.0",
    releaseWorkflow: overrides.releaseWorkflow ?? process.env.WAITLIST_RELEASE_WORKFLOW ?? ".github/workflows/windows-installer.yml",
    releaseTokenVerifier: overrides.releaseTokenVerifier
  };
}

function jsonResponse(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function getCorsHeaders(req, config) {
  const origin = req.headers.origin || "";
  if (!origin || config.allowedOrigins.length === 0) return {};
  if (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "vary": "Origin"
    };
  }
  return null;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function createRateLimiter(maxPerHour) {
  const hitsByIp = new Map();
  const windowMs = 60 * 60 * 1000;
  return function checkRateLimit(ip, now = Date.now()) {
    if (!Number.isFinite(maxPerHour) || maxPerHour <= 0) return true;
    const cutoff = now - windowMs;
    const hits = (hitsByIp.get(ip) || []).filter((timestamp) => timestamp > cutoff);
    if (hits.length >= maxPerHour) {
      hitsByIp.set(ip, hits);
      return false;
    }
    hits.push(now);
    hitsByIp.set(ip, hits);
    return true;
  };
}

function readBody(req, limitBytes = BODY_LIMIT_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        rejectBody(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function parseBody(rawBody, contentType) {
  if (contentType.includes("application/json")) return rawBody.trim() ? JSON.parse(rawBody) : {};
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(rawBody));
  throw Object.assign(new Error("Unsupported content type"), { statusCode: 415 });
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validateSubmission(payload) {
  const email = cleanString(payload.email, 254).toLowerCase();
  const role = cleanString(payload.role, 40);
  const field = cleanString(payload.field, 120);
  const problem = cleanString(payload.problem, 1000);
  const website = cleanString(payload.website, 200);
  if (website) return { ok: true, spam: true };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, statusCode: 400, message: "请填写有效邮箱。" };
  }
  if (!DEFAULT_ROLES.has(role)) return { ok: false, statusCode: 400, message: "请选择你的身份。" };
  return { ok: true, value: { email, role, field, problem } };
}

function signDownload(config, submissionId, expiresAt) {
  return createHmac("sha256", config.downloadSecret)
    .update(`${submissionId}.${expiresAt}`)
    .digest("base64url");
}

function createDownloadUrl(config, submissionId, now = Date.now()) {
  if (!config.installerPath || !config.downloadSecret) return "";
  const expiresAt = Math.floor(now / 1000) + config.downloadTtlSeconds;
  const signature = signDownload(config, submissionId, expiresAt);
  return `/downloads/liteasy-windows?id=${encodeURIComponent(submissionId)}&expires=${expiresAt}&signature=${encodeURIComponent(signature)}`;
}

function hasValidDownloadToken(config, url, now = Date.now()) {
  if (!config.installerPath || !config.downloadSecret) return false;
  const submissionId = cleanString(url.searchParams.get("id"), 64);
  const expiresAt = Number(url.searchParams.get("expires"));
  const supplied = url.searchParams.get("signature") || "";
  if (!submissionId || !Number.isInteger(expiresAt) || expiresAt < Math.floor(now / 1000)) return false;
  const expected = signDownload(config, submissionId, expiresAt);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

async function installerIsReady(config) {
  if (!config.installerPath || !config.downloadSecret) return false;
  try {
    const details = await stat(config.installerPath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function notifyDeveloper(config, submission) {
  if (!config.notifyWebhookUrl) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.notifyTimeoutMs);
  try {
    const response = await fetch(config.notifyWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "liteasy.waitlist.submitted", submission }),
      signal: controller.signal
    });
    if (!response.ok) console.error("waitlist notification failed", response.status);
  } catch (error) {
    console.error("waitlist notification failed", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function applicationApiRequest(config, path, body) {
  if (config.applicationWriter) return config.applicationWriter(path, body);
  if (!config.applicationApiUrl || !config.applicationApiSecret) {
    throw Object.assign(new Error("Application API is not configured"), { statusCode: 503 });
  }
  let response;
  try {
    response = await fetch(`${config.applicationApiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-liteasy-marketing-secret": config.applicationApiSecret
      },
      method: "POST",
      signal: AbortSignal.timeout(config.applicationApiTimeoutMs)
    });
  } catch (error) {
    throw Object.assign(new Error("Application API is unavailable", { cause: error }), { statusCode: 503 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Application API rejected the request: ${response.status}`), { statusCode: 503 });
  }
  return response.json();
}

async function serveInstaller(res, url, config) {
  if (!hasValidDownloadToken(config, url)) {
    jsonResponse(res, 403, { ok: false, error: "请先提交体验申请，再获取安装包。" });
    return;
  }
  if (!await installerIsReady(config)) {
    jsonResponse(res, 503, { ok: false, error: "安装包正在准备中，请稍后再试。" });
    return;
  }
  const details = await stat(config.installerPath);
  const applicationId = cleanString(url.searchParams.get("id"), 64);
  applicationApiRequest(config, "/v1/internal/marketing/installer-downloaded", { applicationId })
    .catch((error) => console.error("installer download tracking failed", error.message));
  const fileName = basename(config.installerName).replace(/["\\]/g, "-");
  res.writeHead(200, {
    "content-type": "application/vnd.microsoft.portable-executable",
    "content-disposition": `attachment; filename="${fileName}"`,
    "content-length": String(details.size),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff"
  });
  createReadStream(config.installerPath).pipe(res);
}

function base64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("Release identity token is invalid"), { statusCode: 401 });
  }
}

async function githubOidcKeys() {
  if (githubOidcCache.expiresAt > Date.now()) return githubOidcCache.keys;
  const discovery = await fetch("https://token.actions.githubusercontent.com/.well-known/openid-configuration", {
    signal: AbortSignal.timeout(5000)
  });
  if (!discovery.ok) throw Object.assign(new Error("GitHub identity service is unavailable"), { statusCode: 503 });
  const configuration = await discovery.json();
  const jwks = await fetch(configuration.jwks_uri, { signal: AbortSignal.timeout(5000) });
  if (!jwks.ok) throw Object.assign(new Error("GitHub identity keys are unavailable"), { statusCode: 503 });
  const body = await jwks.json();
  if (!Array.isArray(body.keys)) throw Object.assign(new Error("GitHub identity keys are invalid"), { statusCode: 503 });
  githubOidcCache.keys = body.keys;
  githubOidcCache.expiresAt = Date.now() + 10 * 60 * 1000;
  return githubOidcCache.keys;
}

async function verifyReleaseToken(token, config) {
  if (config.releaseTokenVerifier) return config.releaseTokenVerifier(token);
  const parts = String(token).split(".");
  if (parts.length !== 3) throw Object.assign(new Error("Release identity token is invalid"), { statusCode: 401 });
  const header = base64UrlJson(parts[0]);
  const claims = base64UrlJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw Object.assign(new Error("Release identity token is invalid"), { statusCode: 401 });
  }
  const key = (await githubOidcKeys()).find((item) => item.kid === header.kid && item.kty === "RSA");
  if (!key || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ format: "jwk", key }), Buffer.from(parts[2], "base64url"))) {
    throw Object.assign(new Error("Release identity token signature is invalid"), { statusCode: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const workflowRef = `${config.releaseRepository}/${config.releaseWorkflow}@`;
  if (
    claims.iss !== "https://token.actions.githubusercontent.com" ||
    !audiences.includes(config.releaseAudience) ||
    !Number.isFinite(claims.exp) || claims.exp <= now ||
    !Number.isFinite(claims.iat) || claims.iat > now + 30 || now - claims.iat > 10 * 60 ||
    claims.repository !== config.releaseRepository ||
    typeof claims.workflow_ref !== "string" || !claims.workflow_ref.startsWith(workflowRef) ||
    !new Set(["push", "workflow_dispatch"]).has(claims.event_name) ||
    typeof claims.sha !== "string" || !/^[a-f0-9]{40}$/.test(claims.sha)
  ) {
    throw Object.assign(new Error("Release identity is not authorized"), { statusCode: 403 });
  }
  return claims;
}

function releaseHeader(req, name, pattern) {
  const value = req.headers[name];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw Object.assign(new Error(`Release header ${name} is invalid`), { statusCode: 400 });
  }
  return value;
}

async function receiveInstaller(req, res, config) {
  const authorization = req.headers.authorization ?? "";
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throw Object.assign(new Error("Release identity is required"), { statusCode: 401 });
  }
  const claims = await verifyReleaseToken(authorization.slice(7), config);
  const version = releaseHeader(req, "x-liteasy-release-version", /^\d+\.\d+\.\d+$/);
  const gitSha = releaseHeader(req, "x-liteasy-release-sha", /^[a-f0-9]{40}$/);
  const expectedHash = releaseHeader(req, "x-liteasy-release-sha256", /^[a-f0-9]{64}$/);
  const fileName = releaseHeader(req, "x-liteasy-release-filename", /^[A-Za-z0-9._-]{1,120}\.exe$/);
  const contentLength = Number(req.headers["content-length"]);
  if (version !== config.releaseVersion || gitSha !== claims.sha || fileName !== config.installerName) {
    throw Object.assign(new Error("Release metadata does not match the configured installer"), { statusCode: 409 });
  }
  if (!Number.isSafeInteger(contentLength) || contentLength < 1024 || contentLength > INSTALLER_LIMIT_BYTES) {
    throw Object.assign(new Error("Release installer size is invalid"), { statusCode: 413 });
  }
  try {
    await stat(config.installerPath);
    throw Object.assign(new Error("This installer version has already been published"), { statusCode: 409 });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(config.installerPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${config.installerPath}.${randomUUID()}.upload`;
  const metadataPath = `${config.installerPath}.json`;
  const temporaryMetadataPath = `${metadataPath}.${randomUUID()}.upload`;
  const hash = createHash("sha256");
  let received = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > INSTALLER_LIMIT_BYTES) return callback(Object.assign(new Error("Release installer is too large"), { statusCode: 413 }));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(req, meter, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    if (received !== contentLength || hash.digest("hex") !== expectedHash) {
      throw Object.assign(new Error("Release installer checksum does not match"), { statusCode: 422 });
    }
    await writeFile(temporaryMetadataPath, JSON.stringify({
      fileName,
      gitSha,
      publishedAt: new Date().toISOString(),
      repository: config.releaseRepository,
      sha256: expectedHash,
      size: received,
      signed: false,
      version,
      workflowRef: claims.workflow_ref
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporaryMetadataPath, metadataPath);
    await rename(temporaryPath, config.installerPath);
    await chmod(config.installerPath, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    await rm(temporaryMetadataPath, { force: true });
    if (!await installerIsReady(config)) await rm(metadataPath, { force: true });
    throw error;
  }
  jsonResponse(res, 201, { ok: true, sha256: expectedHash, size: received, version });
}

export function createWaitlistServer(options = {}) {
  const config = getConfig(options);
  const checkRateLimit = createRateLimiter(config.maxPerHour);
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    if (url.pathname === "/healthz" && req.method === "GET") {
      jsonResponse(res, 200, { ok: true, installerReady: await installerIsReady(config) });
      return;
    }
    if (url.pathname === "/downloads/liteasy-windows" && req.method === "GET") {
      await serveInstaller(res, url, config);
      return;
    }
    if (url.pathname === "/api/releases/windows-installer" && req.method === "PUT") {
      try {
        await receiveInstaller(req, res, config);
      } catch (error) {
        const statusCode = error.statusCode || 500;
        if (statusCode >= 500) console.error("installer release failed", error);
        jsonResponse(res, statusCode, { ok: false, error: statusCode >= 500 ? "Installer release is unavailable" : error.message });
      }
      return;
    }
    if (url.pathname !== "/api/waitlist") {
      jsonResponse(res, 404, { ok: false, error: "Not found" });
      return;
    }
    const corsHeaders = getCorsHeaders(req, config);
    if (corsHeaders === null) {
      jsonResponse(res, 403, { ok: false, error: "Origin not allowed" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed" }, { allow: "POST, OPTIONS", ...corsHeaders });
      return;
    }
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { ok: false, error: "提交过于频繁，请稍后再试。" }, corsHeaders);
      return;
    }
    try {
      const payload = parseBody(await readBody(req), req.headers["content-type"] || "");
      const validation = validateSubmission(payload);
      if (!validation.ok) {
        jsonResponse(res, validation.statusCode, { ok: false, error: validation.message }, corsHeaders);
        return;
      }
      if (validation.spam) {
        jsonResponse(res, 200, { ok: true }, corsHeaders);
        return;
      }
      const submission = {
        id: randomUUID(),
        submittedAt: new Date().toISOString(),
        source: "marketing-site",
        ...validation.value,
        request: {
          ip,
          origin: req.headers.origin || "",
          referer: req.headers.referer || "",
          userAgent: req.headers["user-agent"] || ""
        }
      };
      await applicationApiRequest(config, "/v1/internal/marketing/applications", {
        applicationId: submission.id,
        email: submission.email,
        field: submission.field,
        problem: submission.problem,
        request: submission.request,
        role: submission.role,
        source: submission.source,
        submittedAt: submission.submittedAt
      });
      await mkdir(dirname(config.dataFile), { recursive: true });
      await appendFile(config.dataFile, JSON.stringify(submission) + "\n", "utf8");
      notifyDeveloper(config, submission);
      const ready = await installerIsReady(config);
      jsonResponse(res, 200, {
        ok: true,
        id: submission.id,
        downloadUrl: ready ? createDownloadUrl(config, submission.id) : undefined,
        message: ready
          ? "体验申请已提交，安装包即将开始下载。"
          : "体验申请已提交。安装包准备完成后，我们将通过邮件通知你。"
      }, corsHeaders);
    } catch (error) {
      const statusCode = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
      const message = statusCode >= 500 ? "提交暂时不可用，请稍后再试。" : error.message;
      if (statusCode >= 500) console.error("waitlist submission failed", error);
      jsonResponse(res, statusCode, { ok: false, error: message });
    }
  });
}

export async function startWaitlistServer(options = {}) {
  const config = getConfig(options);
  const server = createWaitlistServer(config);
  if (config.socketPath) {
    await mkdir(dirname(config.socketPath), { recursive: true });
    await rm(config.socketPath, { force: true });
    server.listen(config.socketPath, async () => {
      await chmod(config.socketPath, 0o660);
      console.log("Liteasy waitlist service listening on " + config.socketPath);
    });
  } else {
    server.listen(config.port, config.host, () => {
      console.log(`Liteasy waitlist service listening on http://${config.host}:${config.port}`);
    });
  }
  console.log("Submissions file: " + config.dataFile);
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await startWaitlistServer();
