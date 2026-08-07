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
}
