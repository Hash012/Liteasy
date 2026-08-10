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

  async verifyProjection(reference, { retry = true } = {}) {
    const token = await this.#accessToken();
    let response;
    try {
      response = await this.fetchImpl(`${this.config.apiUrl}/v1/internal/literature:verify`, {
        body: JSON.stringify(reference),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new IntuechoLiteratureClientError();
    }
    if (response.status === 401 && retry) {
      this.cachedToken = null;
      return this.verifyProjection(reference, { retry: false });
    }
    if (new Set([404, 409]).has(response.status)) {
      throw new IntuechoLiteratureClientError("literature_projection_not_confirmed", 409);
    }
    if (!response.ok) throw new IntuechoLiteratureClientError();
    const body = await response.json().catch(() => null);
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
