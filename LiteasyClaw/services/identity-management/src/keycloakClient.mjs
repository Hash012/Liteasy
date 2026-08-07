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
