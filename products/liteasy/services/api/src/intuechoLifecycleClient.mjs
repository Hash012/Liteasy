import { AccountLifecycleError } from "./accountLifecycleError.mjs";

export class IntuechoLifecycleClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async deleteAccount(input) {
    let response;
    try {
      response = await this.fetchImpl(
        `${this.config.adminApiUrl}/v1/admin/accounts/${encodeURIComponent(input.subjectId)}/delete`,
        {
          body: JSON.stringify({
            idempotencyKey: input.idempotencyKey,
            reason: input.reason
          }),
          headers: {
            authorization: `Bearer ${input.adminAccessToken}`,
            "content-type": "application/json"
          },
          method: "POST",
          signal: AbortSignal.timeout(15_000)
        }
      );
    } catch {
      throw new AccountLifecycleError("intuecho_lifecycle_unavailable", 503);
    }
    if (!response.ok) throw new AccountLifecycleError("intuecho_lifecycle_unavailable", 503);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new AccountLifecycleError("intuecho_lifecycle_invalid_response", 503);
    }
    const completedAt = new Date(body.completedAt);
    if (
      body.subjectId !== input.subjectId || body.operationId !== input.idempotencyKey ||
      !body.result || typeof body.result !== "object" || !Number.isFinite(completedAt.getTime())
    ) {
      throw new AccountLifecycleError("intuecho_lifecycle_invalid_response", 503);
    }
    return Object.freeze({
      completedAt: completedAt.toISOString(),
      operationId: body.operationId,
      result: body.result,
      subjectId: body.subjectId
    });
  }
}
