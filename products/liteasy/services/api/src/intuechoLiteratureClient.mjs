import { normalizeLiteratureMetadata } from "./literatureMetadata.mjs";

export class IntuechoLiteratureClientError extends Error {
  constructor(code = "intuecho_literature_unavailable", status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class IntuechoLiteratureClient {
  constructor(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cachedToken = null;
  }

  async #accessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > this.now()) return this.cachedToken.value;
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
      throw new IntuechoLiteratureClientError();
    }
    if (!response.ok) throw new IntuechoLiteratureClientError();
    const body = await response.json().catch(() => null);
    const expiresIn = Number(body?.expires_in);
    if (typeof body?.access_token !== "string" || !body.access_token ||
      String(body?.token_type).toLowerCase() !== "bearer" ||
      !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
      throw new IntuechoLiteratureClientError("intuecho_literature_service_token_invalid");
    }
    this.cachedToken = { expiresAt: this.now() + expiresIn * 1000, value: body.access_token };
    return body.access_token;
  }

  async #request(path, { body, method = "POST", retry = true } = {}) {
    const token = await this.#accessToken();
    let response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        method,
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new IntuechoLiteratureClientError();
    }
    if (response.status === 401 && retry) {
      this.cachedToken = null;
      return this.#request(path, { body, method, retry: false });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const upstreamCode = typeof payload?.code === "string"
        ? payload.code
        : typeof payload?.error === "string" ? payload.error : undefined;
      throw new IntuechoLiteratureClientError(upstreamCode, response.status);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new IntuechoLiteratureClientError("intuecho_literature_response_invalid");
    }
    return payload;
  }

  async confirm(input) {
    const body = await this.#request("/v1/internal/literature:confirm", { body: input });
    try {
      return { literature: normalizeLiteratureMetadata(body.literature) };
    } catch {
      throw new IntuechoLiteratureClientError("intuecho_literature_response_invalid");
    }
  }

  relations(literatureId) {
    return this.#request(
      `/v1/internal/literature/${encodeURIComponent(literatureId)}/relations`,
      { method: "GET" }
    );
  }

  resolve(input) {
    return this.#request("/v1/internal/literature:resolve", { body: input });
  }

  async verifyProjection(reference) {
    let body;
    try {
      body = await this.#request("/v1/internal/literature:verify", { body: reference });
    } catch (error) {
      if (error instanceof IntuechoLiteratureClientError && new Set([404, 409]).has(error.status)) {
        throw new IntuechoLiteratureClientError("literature_projection_not_confirmed", 409);
      }
      throw error;
    }
    let literature;
    try {
      literature = normalizeLiteratureMetadata(body?.literature);
    } catch {
      throw new IntuechoLiteratureClientError("intuecho_literature_response_invalid");
    }
    if (literature.literatureId !== reference.literatureId || literature.revision !== reference.revision) {
      throw new IntuechoLiteratureClientError("intuecho_literature_response_invalid");
    }
    return literature;
  }
}
