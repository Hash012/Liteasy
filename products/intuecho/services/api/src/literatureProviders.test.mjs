import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function textResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return body;
    }
  };
}

function bibtexResponse(body, { ok = true, status = 200 } = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok,
    status,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async text() {
      throw new Error("PMLR audit hashing must use the original response bytes");
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

function pmlrBibliography({ duplicate = false, entryVolume = 235, slug = "abad-rocamora24a" } = {}) {
  const entry = `@InProceedings{pmlr-v235-${slug},
    title = {Revisiting Character-level Adversarial Attacks for Language Models},
    author = {Abad Rocamora, Elias and Wu, Yongtao},
    booktitle = {Proceedings of the 41st International Conference on Machine Learning},
    year = {2024},
    volume = {${entryVolume}},
    series = {Proceedings of Machine Learning Research},
    publisher = {PMLR},
    url = {https://proceedings.mlr.press/v235/${slug}.html}
  }`;
  return `@Proceedings{ICML2024,
    title = {Proceedings of the 41st International Conference on Machine Learning},
    publisher = {PMLR},
    volume = {235}
  }\n${entry}${duplicate ? `\n${entry}` : ""}`;
}

test("declares identity provider capabilities and exposes confirmation re-fetch", () => {
  const providers = createLiteratureProviders({
    openAlexApiKey: "server-only-openalex",
    semanticScholarApiKey: "server-only-semantic-scholar"
  }, {
    fetchImpl: async () => jsonResponse({})
  });

  for (const adapter of providers) {
    assert.deepEqual(adapter.capabilities, ["resolveIdentity", "search", "refetchForConfirmation"]);
    assert.ok(Object.isFrozen(adapter.capabilities));
    assert.equal(typeof adapter.refetchForConfirmation, "function");
  }
});

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

test("projects Crossref version relations as source evidence", async () => {
  const providers = createLiteratureProviders({
    crossrefEndpoint: "https://catalog.example.test/works"
  }, {
    fetchImpl: async () => jsonResponse({
      message: crossrefWork({
        relation: {
          "has-preprint": [{ "id-type": "doi", id: "10.1000/preprint" }]
        }
      })
    })
  });

  const [candidate] = await provider(providers, "crossref").search({
    purpose: "forum_compose",
    query: "10.1000/verified"
  });

  assert.deepEqual(candidate.relations, [{
    direction: "to_current",
    evidence: { sourceField: "relation.has-preprint" },
    relationType: "is_preprint_of",
    targetIdentifier: { kind: "doi", value: "10.1000/preprint" }
  }]);
});

test("projects an exact arXiv identifier lookup into a public candidate", async () => {
  const providers = createLiteratureProviders({
    arxivEndpoint: "https://catalog.example.test/arxiv/query"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.searchParams.get("id_list"), "2401.01234v2");
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
            <arxiv:doi>10.1000/published-version</arxiv:doi>
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
    candidateKey: "arxiv:arxiv_id:2401.01234v2",
    provider: "arxiv",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234v2" }],
      title: "Preprint Work",
      year: 2024
    },
    relations: [{
      direction: "from_current",
      evidence: { sourceField: "id.version:v2" },
      relationType: "version_of",
      targetIdentifier: { kind: "arxiv_id", value: "2401.01234v1" }
    }, {
      direction: "from_current",
      evidence: { sourceField: "arxiv:doi" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "doi", value: "10.1000/published-version" }
    }],
    recordUrl: "https://arxiv.org/abs/2401.01234v2"
  }]);
});

test("projects OpenAlex search and exact re-fetch records with canonical identifiers", async () => {
  const openAlexWork = {
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
    display_name: "OpenAlex Work",
    doi: "https://doi.org/10.1000/OpenAlex.",
    id: "https://openalex.org/W123",
    primary_location: { landing_page_url: "http://untrusted.example/record" },
    publication_year: 2024,
    type: "article"
  };
  const providers = createLiteratureProviders({
    openAlexApiKey: "server-only-key",
    openAlexEndpoint: "https://catalog.example.test/openalex/works"
  }, {
    fetchImpl: async (requestUrl, options) => {
      const url = new URL(requestUrl);
      assert.equal(url.searchParams.get("api_key"), "server-only-key");
      assert.equal(options.headers.authorization, undefined);
      if (url.pathname.endsWith("/W123")) return jsonResponse(openAlexWork);
      assert.equal(url.searchParams.get("filter"), "doi:10.1000/openalex");
      assert.equal(url.searchParams.get("per-page"), "10");
      return jsonResponse({ results: [openAlexWork] });
    }
  });
  const openAlex = provider(providers, "openalex");

  const searched = await openAlex.search({ purpose: "forum_compose", query: "10.1000/openalex" });
  const refetched = await openAlex.fetchCandidate("openalex:openalex_id:W123");

  assert.deepEqual(searched, [{
    candidateKey: "openalex:openalex_id:W123",
    provider: "openalex",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "article",
      identifiers: [
        { kind: "openalex_id", source: "public_registry", value: "W123" },
        { kind: "doi", source: "public_registry", value: "10.1000/openalex" }
      ],
      title: "OpenAlex Work",
      year: 2024
    },
    recordUrl: "https://openalex.org/W123"
  }]);
  assert.deepEqual(refetched, searched[0]);
});

test("projects Semantic Scholar search and exact re-fetch records with canonical identifiers", async () => {
  const semanticPaperId = "a".repeat(40);
  const semanticWork = {
    authors: [{ name: "Grace Hopper" }],
    externalIds: { ArXiv: "arXiv:2401.01234v2", DOI: "https://doi.org/10.1000/Semantic." },
    paperId: semanticPaperId,
    title: "Semantic Work",
    url: "http://untrusted.example/record",
    venue: "Journal",
    year: 2025
  };
  const providers = createLiteratureProviders({
    semanticScholarApiKey: "server-only-key",
    semanticScholarEndpoint: "https://catalog.example.test/semantic/paper"
  }, {
    fetchImpl: async (requestUrl, options) => {
      const url = new URL(requestUrl);
      assert.equal(options.headers["x-api-key"], "server-only-key");
      if (url.pathname.endsWith(`/${semanticPaperId}`)) return jsonResponse(semanticWork);
      assert.equal(url.pathname, "/semantic/paper/search");
      assert.equal(url.searchParams.get("query"), "DOI:10.1000/semantic");
      assert.equal(url.searchParams.get("limit"), "10");
      return jsonResponse({ data: [semanticWork] });
    }
  });
  const semanticScholar = provider(providers, "semantic_scholar");

  const searched = await semanticScholar.search({ purpose: "forum_compose", query: "10.1000/semantic" });
  const refetched = await semanticScholar.fetchCandidate(`semantic_scholar:semantic_scholar_id:${semanticPaperId}`);

  assert.deepEqual(searched, [{
    candidateKey: `semantic_scholar:semantic_scholar_id:${semanticPaperId}`,
    provider: "semantic_scholar",
    record: {
      authors: ["Grace Hopper"],
      documentType: "publication",
      identifiers: [
        { kind: "semantic_scholar_id", source: "public_registry", value: semanticPaperId },
        { kind: "doi", source: "public_registry", value: "10.1000/semantic" }
      ],
      title: "Semantic Work",
      year: 2025
    },
    relations: [{
      direction: "to_current",
      evidence: { sourceField: "externalIds.ArXiv" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "arxiv_id", value: "2401.01234v2" }
    }],
    recordUrl: `https://www.semanticscholar.org/paper/${semanticPaperId}`
  }]);
  assert.deepEqual(refetched, searched[0]);
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
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return new Promise(() => {});
      }
    }),
    timeoutMs: 20
  });
  const deadline = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error("body read exceeded provider timeout")), 250);
  });

  await assert.rejects(
    () => Promise.race([
      provider(providers, "crossref").search({ purpose: "forum_compose", query: "slow response body" }),
      deadline
    ]),
    (error) => error?.code === "LITERATURE_PROVIDER_UNAVAILABLE"
  );
});

test("projects accepted OpenReview records for ICLR and NeurIPS with stable source ids", async () => {
  const providers = createLiteratureProviders({
    openReviewEndpoint: "https://api2.openreview.test/notes",
    openReviewSearchEndpoint: "https://api2.openreview.test/notes/search"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.pathname, "/notes");
      assert.equal(url.searchParams.get("id"), "OR-NeurIPS-2026");
      return jsonResponse({
        notes: [{
          cdate: Date.UTC(2026, 8, 1),
          content: {
            authors: { value: ["Ada Lovelace", "Grace Hopper"] },
            doi: { value: "10.5555/neurips.2026.1" },
            title: { value: "Source Confirmed AI" },
            venue: { value: "NeurIPS 2026 poster" }
          },
          id: "OR-NeurIPS-2026"
        }]
      });
    }
  });

  const result = await provider(providers, "openreview").fetchCandidate(
    "openreview:openreview_id:OR-NeurIPS-2026"
  );

  assert.deepEqual(result, {
    candidateKey: "openreview:openreview_id:OR-NeurIPS-2026",
    provider: "openreview",
    record: {
      authors: ["Ada Lovelace", "Grace Hopper"],
      documentType: "conference-paper",
      identifiers: [
        { kind: "openreview_id", source: "public_registry", value: "OR-NeurIPS-2026" },
        { kind: "doi", source: "public_registry", value: "10.5555/neurips.2026.1" }
      ],
      title: "Source Confirmed AI",
      year: 2026
    },
    recordUrl: "https://openreview.net/forum?id=OR-NeurIPS-2026"
  });
});

test("searches accepted ICLR records through the OpenReview API", async () => {
  const providers = createLiteratureProviders({
    openReviewSearchEndpoint: "https://api2.openreview.test/notes/search"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.pathname, "/notes/search");
      assert.equal(url.searchParams.get("term"), "representation learning");
      return jsonResponse({ notes: [{
        content: {
          authors: { value: ["A. Researcher"] },
          title: { value: "Representation Learning" },
          venue: { value: "ICLR 2026 oral" },
          year: { value: 2026 }
        },
        id: "OR-ICLR-2026"
      }] });
    }
  });

  const [result] = await provider(providers, "openreview").search({
    purpose: "forum_compose",
    query: "representation learning"
  });

  assert.equal(result.candidateKey, "openreview:openreview_id:OR-ICLR-2026");
  assert.equal(result.record.title, "Representation Learning");
  assert.equal(result.recordUrl, "https://openreview.net/forum?id=OR-ICLR-2026");
});

test("rejects withdrawn OpenReview notes from the literature candidate set", async () => {
  const providers = createLiteratureProviders({}, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      if (url.hostname === "api2.openreview.net") {
        return jsonResponse({ notes: [{
          content: {
            authors: { value: ["A. Author"] },
            title: { value: "Withdrawn Work" },
            venue: { value: "Withdrawn Submission" }
          },
          id: "withdrawn-note"
        }] });
      }
      return jsonResponse({ result: { hits: { hit: [] } } });
    }
  });

  assert.equal(await provider(providers, "openreview").fetchCandidate(
    "openreview:openreview_id:withdrawn-note"
  ), null);
});

test("rejects a non-unique OpenReview note id lookup", async () => {
  const published = {
    content: {
      authors: { value: ["A. Author"] },
      title: { value: "Published Work" },
      venue: { value: "ICLR 2026 Conference Paper" },
      year: { value: 2026 }
    },
    id: "duplicate-note"
  };
  const providers = createLiteratureProviders({}, {
    fetchImpl: async () => jsonResponse({ notes: [published, { ...published }] })
  });

  assert.equal(await provider(providers, "openreview").fetchCandidate(
    "openreview:openreview_id:duplicate-note"
  ), null);
});

test("projects DBLP records for ICML and AAAI while preserving the stable record key", async () => {
  const providers = createLiteratureProviders({
    dblpRecordEndpoint: "https://dblp.test/rec",
    dblpSearchEndpoint: "https://dblp.test/search/publ/api"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.pathname, "/rec/conf/icml/LovelaceH26.xml");
      return textResponse(`<?xml version="1.0"?>
        <dblp><inproceedings key="conf/icml/LovelaceH26">
          <author>Ada Lovelace</author><author>Grace Hopper</author>
          <title>Reliable Machine Learning.</title><year>2026</year>
          <booktitle>ICML</booktitle><ee>https://doi.org/10.5555/icml.2026.1</ee>
        </inproceedings></dblp>`);
    }
  });

  const result = await provider(providers, "dblp").fetchCandidate(
    "dblp:dblp_key:conf/icml/LovelaceH26"
  );

  assert.deepEqual(result, {
    candidateKey: "dblp:dblp_key:conf/icml/LovelaceH26",
    provider: "dblp",
    record: {
      authors: ["Ada Lovelace", "Grace Hopper"],
      documentType: "conference-paper",
      identifiers: [
        { kind: "dblp_key", source: "public_registry", value: "conf/icml/LovelaceH26" },
        { kind: "doi", source: "public_registry", value: "10.5555/icml.2026.1" }
      ],
      title: "Reliable Machine Learning.",
      year: 2026
    },
    recordUrl: "https://dblp.org/rec/conf/icml/LovelaceH26"
  });
});

test("searches AAAI records through the DBLP publication API", async () => {
  const providers = createLiteratureProviders({
    dblpSearchEndpoint: "https://dblp.test/search/publ/api"
  }, {
    fetchImpl: async (requestUrl) => {
      const url = new URL(requestUrl);
      assert.equal(url.pathname, "/search/publ/api");
      assert.equal(url.searchParams.get("q"), "planning agents");
      assert.equal(url.searchParams.get("format"), "json");
      return jsonResponse({ result: { hits: { hit: [{ info: {
        authors: { author: [{ text: "A. Researcher" }] },
        ee: "https://doi.org/10.1609/aaai.v40i1.1",
        key: "conf/aaai/Researcher26",
        title: "Planning Agents",
        venue: "AAAI",
        year: "2026"
      } }] } } });
    }
  });

  const [result] = await provider(providers, "dblp").search({
    purpose: "forum_compose",
    query: "planning agents"
  });

  assert.equal(result.candidateKey, "dblp:dblp_key:conf/aaai/Researcher26");
  assert.deepEqual(result.record.identifiers.map((identifier) => identifier.kind), ["dblp_key", "doi"]);
  assert.equal(result.recordUrl, "https://dblp.org/rec/conf/aaai/Researcher26");
});

test("refetches one exact ICML paper from the official PMLR volume bibliography", async () => {
  const bibliography = pmlrBibliography();
  const providers = createLiteratureProviders({
    pmlrEndpoint: "https://proceedings.mlr.test"
  }, {
    fetchImpl: async (requestUrl, init) => {
      assert.equal(requestUrl, "https://proceedings.mlr.test/v235/assets/bib/bibliography.bib");
      assert.equal(init.headers.accept, "application/x-bibtex, text/plain;q=0.9");
      return bibtexResponse(bibliography);
    }
  });

  const result = await provider(providers, "pmlr").refetchForConfirmation(
    "pmlr:pmlr_id:v235/abad-rocamora24a"
  );

  assert.deepEqual(result, {
    candidateKey: "pmlr:pmlr_id:v235/abad-rocamora24a",
    provider: "pmlr",
    record: {
      authors: ["Elias Abad Rocamora", "Yongtao Wu"],
      documentType: "conference-paper",
      identifiers: [{ kind: "pmlr_id", source: "public_registry", value: "v235/abad-rocamora24a" }],
      title: "Revisiting Character-level Adversarial Attacks for Language Models",
      year: 2024
    },
    recordUrl: "https://proceedings.mlr.press/v235/abad-rocamora24a.html",
    sourceEvidence: {
      artifactHash: `sha256:${createHash("sha256").update(bibliography).digest("hex")}`,
      artifactUrl: "https://proceedings.mlr.test/v235/assets/bib/bibliography.bib",
      entryKey: "pmlr-v235-abad-rocamora24a",
      sourceKind: "official_volume_bibtex",
      volume: 235
    }
  });
  assert.equal(Object.keys(result).includes("sourceArtifact"), false);
  assert.deepEqual(result.sourceArtifact.content, Buffer.from(bibliography));
  assert.equal(result.sourceArtifact.mediaType, "application/x-bibtex");
});

test("rejects non-unique and cross-volume PMLR entries", async () => {
  for (const bibliography of [
    pmlrBibliography({ duplicate: true }),
    pmlrBibliography({ entryVolume: 236 })
  ]) {
    const providers = createLiteratureProviders({ pmlrEndpoint: "https://proceedings.mlr.test" }, {
      fetchImpl: async () => bibtexResponse(bibliography)
    });
    assert.equal(await provider(providers, "pmlr").refetchForConfirmation(
      "pmlr:pmlr_id:v235/abad-rocamora24a"
    ), null);
  }
});

test("rejects an oversized PMLR volume before reading its response body", async () => {
  const providers = createLiteratureProviders({ pmlrEndpoint: "https://proceedings.mlr.test" }, {
    fetchImpl: async () => ({
      body: null,
      headers: { get: () => String(20 * 1024 * 1024 + 1) },
      ok: true,
      status: 200,
      async arrayBuffer() {
        throw new Error("oversized bodies must not be read");
      }
    })
  });

  await assert.rejects(
    () => provider(providers, "pmlr").refetchForConfirmation("pmlr:pmlr_id:v235/abad-rocamora24a"),
    /LITERATURE_PROVIDER_UNAVAILABLE/
  );
});

test("searches only the PMLR volume declared by a structured hint", async () => {
  const providers = createLiteratureProviders({ pmlrEndpoint: "https://proceedings.mlr.test" }, {
    fetchImpl: async (requestUrl) => {
      assert.equal(requestUrl, "https://proceedings.mlr.test/v235/assets/bib/bibliography.bib");
      return bibtexResponse(pmlrBibliography());
    }
  });

  const results = await provider(providers, "pmlr").search({
    hints: {
      pmlr: { source: "pmlr", volume: 235, year: 2024 },
      title: "Revisiting Character-level Adversarial Attacks for Language Models"
    },
    purpose: "liteasy_pdf_annotation"
  });

  assert.deepEqual(results.map((item) => item.candidateKey), [
    "pmlr:pmlr_id:v235/abad-rocamora24a"
  ]);
});
