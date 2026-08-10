import assert from "node:assert/strict";
import test from "node:test";
import {
  IntuechoLiteratureClient,
  IntuechoLiteratureClientError
} from "./intuechoLiteratureClient.mjs";

const config = {
  apiUrl: "https://intuecho.internal",
  audience: "intuecho-internal",
  clientId: "liteasy-literature-projection",
  clientSecret: "literature-service-secret",
  scope: "literature.verify",
  tokenUrl: "https://identity.internal/oauth2/token"
};

const literature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/liteasy" }],
  literatureId: "lit_01J00000000000000000000000",
  provenance: {
    confirmedAt: "2026-08-09T00:00:00.000Z",
    mode: "public_registry",
    provider: "crossref"
  },
  revision: 3,
  status: "confirmed",
  title: "Cloud Literature Metadata",
  year: 2026
};

function response(status, body) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status
  };
}

test("obtains a dedicated service token and verifies an exact projection revision", async () => {
  const requests = [];
  const client = new IntuechoLiteratureClient(config, {
    fetchImpl: async (url, init) => {
      requests.push({ init, url });
      return url === config.tokenUrl
        ? response(200, { access_token: "service-token", expires_in: 300, token_type: "Bearer" })
        : response(200, { literature });
    },
    now: () => Date.parse("2026-08-10T00:00:00.000Z")
  });

  await assert.doesNotReject(() => client.verifyProjection({ literatureId: literature.literatureId, revision: 3 }));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].init.headers.authorization, "Bearer service-token");
  assert.deepEqual(JSON.parse(requests[1].init.body), { literatureId: literature.literatureId, revision: 3 });
});

test("refreshes the service token once after an unauthorized verification", async () => {
  let tokenRequests = 0;
  let verificationRequests = 0;
  const client = new IntuechoLiteratureClient(config, {
    fetchImpl: async (url) => {
      if (url === config.tokenUrl) {
        tokenRequests += 1;
        return response(200, { access_token: `service-token-${tokenRequests}`, expires_in: 300, token_type: "Bearer" });
      }
      verificationRequests += 1;
      return verificationRequests === 1 ? response(401, {}) : response(200, { literature });
    }
  });

  await client.verifyProjection({ literatureId: literature.literatureId, revision: 3 });
  assert.equal(tokenRequests, 2);
  assert.equal(verificationRequests, 2);
});

test("rejects stale revisions and invalid authoritative snapshots", async () => {
  for (const verificationResponse of [
    response(409, { error: "LITERATURE_REVISION_CONFLICT" }),
    response(200, { literature: { ...literature, revision: 4 } }),
    response(200, { literature: { ...literature, status: "legacy_unverified" } })
  ]) {
    const client = new IntuechoLiteratureClient(config, {
      fetchImpl: async (url) => url === config.tokenUrl
        ? response(200, { access_token: "service-token", expires_in: 300, token_type: "Bearer" })
        : verificationResponse
    });
    await assert.rejects(
      () => client.verifyProjection({ literatureId: literature.literatureId, revision: 3 }),
      (error) => error instanceof IntuechoLiteratureClientError && new Set([
        "literature_projection_not_confirmed",
        "intuecho_literature_response_invalid"
      ]).has(error.code)
    );
  }
});
