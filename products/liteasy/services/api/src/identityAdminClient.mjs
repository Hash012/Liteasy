import { AccountLifecycleError } from "./accountLifecycleError.mjs";

const productAudiences = Object.freeze(["intuecho-web", "liteasy-admin", "liteasy-desktop"]);

async function responseJson(response, code) {
  if (!response.ok) throw new AccountLifecycleError(code, 503);
  try {
    return await response.json();
  } catch {
    throw new AccountLifecycleError("identity_management_invalid_response", 503);
  }
}

function optionalText(value, maximum) {
  return value === null || value === undefined
    ? null
    : typeof value === "string" && value.length <= maximum
      ? value
      : undefined;
}

function account(value) {
  const createdAt = new Date(value?.createdAt);
  const email = optionalText(value?.email, 320);
  const firstName = optionalText(value?.firstName, 300);
  const lastName = optionalText(value?.lastName, 300);
  if (
    !value || typeof value !== "object" ||
    typeof value.subjectId !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value.subjectId) ||
    typeof value.username !== "string" || value.username.length > 300 ||
    !new Set(["person", "service"]).has(value.accountType) ||
    typeof value.enabled !== "boolean" || typeof value.emailVerified !== "boolean" ||
    email === undefined || firstName === undefined || lastName === undefined ||
    !Number.isFinite(createdAt.getTime())
  ) {
    throw new AccountLifecycleError("identity_management_invalid_response", 503);
  }
  return Object.freeze({
    accountType: value.accountType,
    createdAt: createdAt.toISOString(), email, emailVerified: value.emailVerified,
    enabled: value.enabled, firstName, lastName,
    subjectId: value.subjectId, username: value.username
  });
}

export class IdentityAdminClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async #accessToken() {
    const credentials = Buffer.from(
      `${this.config.managementClientId}:${this.config.managementClientSecret}`,
      "utf8"
    ).toString("base64");
    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "accounts:write sessions:revoke"
        }),
        headers: {
          authorization: `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new AccountLifecycleError("identity_management_unavailable", 503);
    }
    const body = await responseJson(response, "identity_management_unavailable");
    if (
      typeof body.access_token !== "string" || !body.access_token ||
      String(body.token_type).toLowerCase() !== "bearer"
    ) {
      throw new AccountLifecycleError("identity_management_invalid_response", 503);
    }
    return body.access_token;
  }

  async setAccountStatus(input) {
    const accessToken = await this.#accessToken();
    let response;
    try {
      response = await this.fetchImpl(
        `${this.config.managementUrl}/v1/accounts/${encodeURIComponent(input.subjectId)}/status`,
        {
          body: JSON.stringify({ reason: input.reason, status: input.status }),
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            "x-idempotency-key": input.idempotencyKey,
            "x-trace-id": input.traceId
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000)
        }
      );
    } catch {
      throw new AccountLifecycleError("identity_management_unavailable", 503);
    }
    const body = await responseJson(response, "identity_management_unavailable");
    const updatedAt = new Date(body.updatedAt);
    if (
      body.subjectId !== input.subjectId || body.status !== input.status ||
      !Number.isFinite(updatedAt.getTime())
    ) {
      throw new AccountLifecycleError("identity_management_invalid_response", 503);
    }
    if (input.status !== "active") {
      const revoked = Array.isArray(body.revokedAudiences)
        ? [...new Set(body.revokedAudiences)].sort()
        : [];
      if (
        body.allSessionsRevoked !== true ||
        JSON.stringify(revoked) !== JSON.stringify([...productAudiences].sort())
      ) {
        throw new AccountLifecycleError("identity_session_revocation_unconfirmed", 503);
      }
    }
    return Object.freeze({
      allSessionsRevoked: body.allSessionsRevoked === true,
      revokedAudiences: input.status === "active" ? [] : [...productAudiences],
      status: body.status,
      subjectId: body.subjectId,
      updatedAt: updatedAt.toISOString()
    });
  }

  async listAccounts(input) {
    const accessToken = await this.#accessToken();
    const query = new URLSearchParams({ first: String(input.first), max: String(input.max) });
    if (input.search) query.set("search", input.search);
    let response;
    try {
      response = await this.fetchImpl(`${this.config.managementUrl}/v1/accounts?${query}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        method: "GET",
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new AccountLifecycleError("identity_management_unavailable", 503);
    }
    const body = await responseJson(response, "identity_management_unavailable");
    if (
      !Array.isArray(body.accounts) ||
      body.first !== input.first || body.max !== input.max || body.search !== input.search ||
      !Number.isSafeInteger(body.total) || body.total < 0
    ) {
      throw new AccountLifecycleError("identity_management_invalid_response", 503);
    }
    return Object.freeze({
      accounts: body.accounts.map(account),
      first: body.first,
      max: body.max,
      search: body.search,
      total: body.total
    });
  }
}
