export class OrganizationAuthorizationError extends Error {
  constructor(code = "organization_authorization_unavailable", status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new OrganizationAuthorizationError(code);
  return value;
}

export class OrganizationAuthorizationClient {
  constructor(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cachedToken = null;
  }

  async #accessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > this.now()) {
      return this.cachedToken.value;
    }
    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        body: new URLSearchParams({
          audience: this.config.audience,
          grant_type: "client_credentials",
          scope: this.config.scope
        }),
        headers: {
          authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, "utf8").toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new OrganizationAuthorizationError();
    }
    if (!response.ok) throw new OrganizationAuthorizationError();
    const body = await response.json().catch(() => null);
    const accessToken = requiredString(body?.access_token, "organization_service_token_invalid");
    const expiresIn = Number(body?.expires_in);
    if (String(body?.token_type).toLowerCase() !== "bearer" || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
      throw new OrganizationAuthorizationError("organization_service_token_invalid");
    }
    this.cachedToken = { expiresAt: this.now() + expiresIn * 1000, value: accessToken };
    return accessToken;
  }

  async #request(path, body, { retry = true } = {}) {
    const token = await this.#accessToken();
    let response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new OrganizationAuthorizationError();
    }
    if (response.status === 401 && retry) {
      this.cachedToken = null;
      return this.#request(path, body, { retry: false });
    }
    if (new Set([403, 404, 409]).has(response.status)) return null;
    if (!response.ok) throw new OrganizationAuthorizationError();
    return response.json().catch(() => {
      throw new OrganizationAuthorizationError("organization_authorization_response_invalid");
    });
  }

  async authorizeAccess({ organizationId, userId }) {
    const result = await this.#request("/v1/internal/intuecho/organizations/access", {
      organizationId,
      userSubject: userId
    });
    if (!result) return { allowed: false, role: null };
    if (typeof result.allowed !== "boolean" || !new Set([null, "owner", "admin", "member"]).has(result.role ?? null)) {
      throw new OrganizationAuthorizationError("organization_authorization_response_invalid");
    }
    return { allowed: result.allowed, role: result.allowed ? result.role : null };
  }

  async listMemberships(userId) {
    const result = await this.#request("/v1/internal/intuecho/organizations/memberships", {
      userSubject: userId
    });
    if (!result || !Array.isArray(result.organizations)) {
      throw new OrganizationAuthorizationError("organization_authorization_response_invalid");
    }
    return result.organizations.map((organization) => {
      if (
        typeof organization.organizationId !== "string" ||
        typeof organization.name !== "string" ||
        !new Set(["owner", "admin", "member"]).has(organization.myRole)
      ) {
        throw new OrganizationAuthorizationError("organization_authorization_response_invalid");
      }
      return {
        name: organization.name,
        organizationId: organization.organizationId,
        role: organization.myRole
      };
    });
  }

  async authorizeVisibility(input) {
    return (await this.authorizeAccess(input)).allowed;
  }

  async authorizeInvitation({ idempotencyKey, invitedUserId, inviterId, organizationId, role }) {
    const result = await this.#request("/v1/internal/intuecho/organizations/invitations", {
      actorSubject: inviterId,
      idempotencyKey,
      organizationId,
      role,
      targetSubject: invitedUserId
    });
    const invitation = result?.invitation;
    if (!invitation) return null;
    if (
      typeof invitation.invitationId !== "string" ||
      typeof invitation.invitationToken !== "string" ||
      invitation.organizationId !== organizationId ||
      invitation.targetSubject !== invitedUserId ||
      invitation.role !== role
    ) {
      throw new OrganizationAuthorizationError("organization_authorization_response_invalid");
    }
    return invitation;
  }
}
