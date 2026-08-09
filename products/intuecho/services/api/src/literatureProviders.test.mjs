import assert from "node:assert/strict";
import test from "node:test";
import { createLiteratureProviders } from "./literatureProviders.mjs";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    }
  };
}

function crossrefWork(overrides = {}) {
  return {
    DOI: "10.1000/verified",
    URL: "https://doi.org/10.1000/verified",
    author: [{ family: "Lovelace", given: "Ada" }],
    published: { "date-parts": [[1843]] },
    title: ["Verified Work"],
    type: "journal-article",
    ...overrides
  };
}

function provider(namedProviders, name) {
  const selected = namedProviders.find((item) => item.name === name);
  assert.ok(selected, `${name} provider is configured`);
  return selected;
}

test("projects an exact Crossref DOI lookup into a normalized public candidate", async () => {
  const providers = createLiteratureProviders({
    crossrefEndpoint: "https://catalog.example.test/works"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(decodeURIComponent(url.pathname), "/works/10.1000/verified");
      return jsonResponse({ message: crossrefWork() });
    }
  });

  const candidates = await provider(providers, "crossref").search({
    purpose: "forum_compose",
    query: "https://doi.org/10.1000/Verified."
  });

  assert.deepEqual(candidates, [{
    candidateKey: "crossref:doi:10.1000/verified",
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "journal-article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/verified" }],
      title: "Verified Work",
      year: 1843
    },
    recordUrl: "https://doi.org/10.1000/verified"
  }]);
});

test("requires an injected transport instead of defaulting to the global network fetch", () => {
  assert.throws(
    () => createLiteratureProviders({ crossrefEndpoint: "https://catalog.example.test/works" }),
    /fetchImpl is required/
  );
});

test("bounds Crossref title search to ten projected candidates", async () => {
  const providers = createLiteratureProviders({
    crossrefEndpoint: "https://catalog.example.test/works"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.searchParams.get("query.bibliographic"), "bounded title");
      assert.equal(url.searchParams.get("rows"), "10");
      return jsonResponse({
        message: {
          items: Array.from({ length: 11 }, (_, index) => crossrefWork({
            DOI: `10.1000/bounded-${index}`,
            title: [`Bounded ${index}`]
          }))
        }
      });
    }
  });

  const candidates = await provider(providers, "crossref").search({
    purpose: "forum_compose",
    query: "bounded title"
  });

  assert.equal(candidates.length, 10);
  assert.equal(candidates[9].record.title, "Bounded 9");
});

test("projects an exact arXiv identifier lookup into a public candidate", async () => {
  const providers = createLiteratureProviders({
    arxivEndpoint: "https://catalog.example.test/arxiv/query"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.searchParams.get("id_list"), "2401.01234");
      assert.equal(url.searchParams.get("max_results"), "1");
      return {
        ok: true,
        status: 200,
        async text() {
          return `<?xml version="1.0"?><feed><entry>
            <id>http://arxiv.org/abs/2401.01234v2</id>
            <title>Preprint Work</title>
            <published>2024-01-10T00:00:00Z</published>
            <author><name>Ada Lovelace</name></author>
          </entry></feed>`;
        }
      };
    }
  });

  const candidates = await provider(providers, "arxiv").search({
    hints: { identifiers: [{ kind: "arxiv_id", value: "arXiv:2401.01234v2" }] },
    purpose: "forum_compose"
  });

  assert.deepEqual(candidates, [{
    candidateKey: "arxiv:arxiv_id:2401.01234",
    provider: "arxiv",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }],
      title: "Preprint Work",
      year: 2024
    },
    recordUrl: "https://arxiv.org/abs/2401.01234"
  }]);
});

test("aborts an unresponsive provider request after three seconds", async () => {
  const providers = createLiteratureProviders({
    crossrefEndpoint: "https://catalog.example.test/works"
  }, {
    fetchImpl: async (_requestUrl, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
    })
  });

  await assert.rejects(
    () => provider(providers, "crossref").search({ purpose: "forum_compose", query: "slow request" }),
    (error) => error?.code === "LITERATURE_PROVIDER_UNAVAILABLE"
  );
});

test("keeps the abort deadline active while parsing a provider response body", async () => {
  const providers = createLiteratureProviders({
    crossrefEndpoint: "https://catalog.example.test/works"
  }, {
    fetchImpl: async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      async json() {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("body read aborted")), { once: true });
        });
      }
    })
  });
  const deadline = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("body read exceeded provider timeout")), 3_250);
  });

  await assert.rejects(
    () => Promise.race([
      provider(providers, "crossref").search({ purpose: "forum_compose", query: "slow response body" }),
      deadline
    ]),
    (error) => error?.code === "LITERATURE_PROVIDER_UNAVAILABLE"
  );
});
