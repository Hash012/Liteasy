const revokedAudiences = Object.freeze(["intuecho-web", "liteasy-admin", "liteasy-desktop"]);

export class IdentityManagementError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function json(response, code) {
  if (!response.ok) throw new IdentityManagementError(code);
  try {
    return await response.json();
  } catch {
    throw new IdentityManagementError(code);
  }
}

function optionalText(value, maximum, code) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new IdentityManagementError(code);
  }
  return value;
}

function account(user) {
  const createdAt = new Date(user?.createdTimestamp);
  if (
    !user || typeof user !== "object" ||
    typeof user.id !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(user.id) ||
    typeof user.username !== "string" || user.username.length < 1 || user.username.length > 300 ||
    typeof user.enabled !== "boolean" ||
    typeof user.emailVerified !== "boolean" ||
    !Number.isSafeInteger(user.createdTimestamp) || user.createdTimestamp < 0 ||
    !Number.isFinite(createdAt.getTime())
  ) {
    throw new IdentityManagementError("keycloak_admin_invalid_response");
  }
  return Object.freeze({
    accountType: typeof user.serviceAccountClientId === "string" || user.username.startsWith("service-account-")
      ? "service"
      : "person",
    createdAt: createdAt.toISOString(),
    email: optionalText(user.email, 320, "keycloak_admin_invalid_response"),
    emailVerified: user.emailVerified,
    enabled: user.enabled,
    firstName: optionalText(user.firstName, 300, "keycloak_admin_invalid_response"),
    lastName: optionalText(user.lastName, 300, "keycloak_admin_invalid_response"),
    subjectId: user.id,
    username: user.username
  });
}

export class KeycloakClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async #adminToken() {
    const authorization = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8"
    ).toString("base64");
    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        headers: {
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new IdentityManagementError("keycloak_admin_unavailable");
    }
    const body = await json(response, "keycloak_admin_unavailable");
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new IdentityManagementError("keycloak_admin_invalid_response");
    }
    return body.access_token;
  }

  async #request(path, { body, expected = [200, 204], method = "GET", token } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        method,
        signal: AbortSignal.timeout(8_000)
      });
    } catch {
      throw new IdentityManagementError("keycloak_admin_unavailable");
    }
    if (!expected.includes(response.status)) {
      throw new IdentityManagementError("keycloak_admin_operation_failed");
    }
    return response;
  }

  async verifyReadiness() {
    const token = await this.#adminToken();
    await this.#request("", { token });
    return { adminApi: true };
  }

  async listAccounts({ first, max, search }) {
    const token = await this.#adminToken();
    const listQuery = new URLSearchParams({
      briefRepresentation: "true",
      first: String(first),
      max: String(max)
    });
    const countQuery = new URLSearchParams();
    if (search) {
      listQuery.set("search", search);
      countQuery.set("search", search);
    }
    const [listResponse, countResponse] = await Promise.all([
      this.#request(`/users?${listQuery}`, { token }),
      this.#request(`/users/count${countQuery.size ? `?${countQuery}` : ""}`, { token })
    ]);
    const [users, total] = await Promise.all([
      json(listResponse, "keycloak_admin_invalid_response"),
      json(countResponse, "keycloak_admin_invalid_response")
    ]);
    if (!Array.isArray(users) || !Number.isSafeInteger(total) || total < 0) {
      throw new IdentityManagementError("keycloak_admin_invalid_response");
    }
    return Object.freeze({
      accounts: users.map(account),
      first,
      max,
      search,
      total
    });
  }

  async setStatus(subjectId, status) {
    const token = await this.#adminToken();
    const path = `/users/${encodeURIComponent(subjectId)}`;
    const existing = await this.#request(path, { expected: [200, 404], token });
    if (status === "deleted") {
      if (existing.status !== 404) {
        await this.#request(`${path}/logout`, { method: "POST", token });
        await this.#request(path, { method: "DELETE", token });
      }
      const confirmation = await this.#request(path, { expected: [404], token });
      if (confirmation.status !== 404) throw new IdentityManagementError("keycloak_delete_unconfirmed");
      return {
        allSessionsRevoked: true,
        revokedAudiences,
        status,
        subjectId,
        updatedAt: new Date().toISOString()
      };
    }
    if (existing.status === 404) throw new IdentityManagementError("identity_subject_not_found", 404);
    await this.#request(path, { body: { enabled: status === "active" }, method: "PUT", token });
    if (status === "disabled") {
      await this.#request(`${path}/logout`, { method: "POST", token });
    }
    const confirmation = await this.#request(path, { token });
    const user = await json(confirmation, "keycloak_admin_invalid_response");
    if (user.id !== subjectId || user.enabled !== (status === "active")) {
      throw new IdentityManagementError("keycloak_status_unconfirmed");
    }
    return {
      allSessionsRevoked: status === "disabled",
      revokedAudiences: status === "disabled" ? revokedAudiences : [],
      status,
      subjectId,
      updatedAt: new Date().toISOString()
    };
  }
}
