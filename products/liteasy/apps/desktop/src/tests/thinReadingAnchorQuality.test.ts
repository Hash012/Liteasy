import { rankThinReadingAnchors } from "../app/features/thin-reading/thinReadingAnchorQuality";
import type {
  ThinReadingAnchor,
  ThinReadingGenerationAudit,
  ThinReadingSummarySentence
} from "../app/features/thin-reading/thinReading.types";

function sentence(input: Partial<ThinReadingSummarySentence> & Pick<ThinReadingSummarySentence, "id">): ThinReadingSummarySentence {
  return {
    evidenceIds: ["evidence-1"],
    externalKnowledge: [],
    status: "grounded",
    text: `Summary ${input.id}`,
    ...input
  };
}

function anchor(input: Partial<ThinReadingAnchor> & Pick<ThinReadingAnchor, "id" | "summarySentenceId">): ThinReadingAnchor {
  return {
    end: 6,
    evidenceIds: ["evidence-1"],
    externalSourceIds: [],
    importance: 0.8,
    kind: "concept",
    searchQuery: input.id,
    start: 0,
    text: input.id,
    ...input
  };
}

function audit(input: Partial<ThinReadingGenerationAudit> = {}): ThinReadingGenerationAudit {
  return {
    model: { id: "reader", provider: "test" },
    qualityGate: { attempts: 1, repaired: false, repairReasons: [] },
    version: "liteasy.thin-reading-agent/v2",
    ...input
  };
}

test("citation evidence raises quality without excluding uncited core concepts", () => {
  const summarySentences = [
    sentence({ evidenceIds: ["evidence-method"], id: "s1", text: "Method sentence." }),
    sentence({ evidenceIds: ["evidence-core"], id: "s2", text: "Core sentence." })
  ];
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({ evidenceIds: ["evidence-method"], id: "method", importance: 0.8, kind: "method", summarySentenceId: "s1" }),
      anchor({ evidenceIds: ["evidence-core"], id: "uncited-core", importance: 1, kind: "contribution", summarySentenceId: "s2" })
    ],
    audit: audit(),
    referencesByAnchorId: new Map([["method", [{ number: 3, text: "A cited method" }]]]),
    summarySentences
  });

  expect(ranked.map((item) => item.id)).toEqual(["method", "uncited-core"]);
  expect(ranked[0]!.quality!.citationProvenance).toBe(1);
  expect(ranked[1]!.quality!.score).toBeGreaterThan(0.35);
  expect(ranked[0]!.quality!.score - ranked[1]!.quality!.score).toBeCloseTo(0.13, 8);
  expect(ranked[0]!.quality!.reason).toBe("核心方法 · 1 条证据 · 原文有引用");
});

test("combines approved score components and caps repeated evidence attention", () => {
  const calls = Array.from({ length: 12 }, () => ({
    evidenceIds: ["evidence-hot"],
    kind: "read" as const
  }));
  const summarySentences = [
    sentence({ evidenceIds: ["evidence-hot"], id: "s1" }),
    sentence({ evidenceIds: ["evidence-cold"], id: "s2" })
  ];
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({ evidenceIds: ["evidence-hot"], id: "hot", importance: 1, summarySentenceId: "s1" }),
      anchor({ evidenceIds: ["evidence-cold"], id: "cold", importance: 1, summarySentenceId: "s2" })
    ],
    audit: audit({ evidenceToolCalls: calls }),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked.find((item) => item.id === "hot")?.quality).toMatchObject({
    evidenceAttention: 1,
    evidenceCoverage: 0.25,
    score: 0.6125
  });
  expect(ranked.find((item) => item.id === "cold")?.quality).toMatchObject({
    evidenceAttention: 0,
    evidenceCoverage: 0.25,
    score: 0.4125
  });
});

test("normalizes search, read, view, and review attention across page evidence", () => {
  const summarySentences = [
    sentence({ evidenceIds: ["evidence-hot"], id: "s1" }),
    sentence({ evidenceIds: ["evidence-warm"], id: "s2" })
  ];
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({ evidenceIds: ["evidence-hot"], id: "hot", summarySentenceId: "s1" }),
      anchor({ evidenceIds: ["evidence-warm"], id: "warm", summarySentenceId: "s2" })
    ],
    audit: audit({
      evidenceReview: {
        propositionVerdicts: [{ proposition: "Supported", sentenceId: "s1", verdict: "supported" }],
        reason: "All reviewed propositions are supported.",
        unsupportedSentenceIds: [],
        verdict: "pass"
      },
      evidenceToolCalls: [
        { evidenceIds: ["evidence-hot", "evidence-warm"], kind: "search", query: "method" },
        { evidenceIds: ["evidence-hot", "evidence-warm"], kind: "read" },
        { evidenceIds: ["evidence-hot"], kind: "view", pages: [2] }
      ]
    }),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked.find((item) => item.id === "hot")?.quality?.evidenceAttention).toBe(1);
  expect(ranked.find((item) => item.id === "warm")?.quality?.evidenceAttention).toBe(0.5);
});

test("excludes external source IDs from evidence attention and gives reviewed zero-evidence sentences no attention", () => {
  const summarySentences = [
    sentence({ evidenceIds: ["evidence-local"], externalKnowledge: ["openalex:W1"], id: "s1" }),
    sentence({ evidenceIds: [], externalKnowledge: ["openalex:W2"], id: "s2", status: "weak" })
  ];
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({
        evidenceIds: ["evidence-local"],
        externalSourceIds: ["openalex:W1"],
        id: "local",
        summarySentenceId: "s1"
      }),
      anchor({ evidenceIds: [], externalSourceIds: ["openalex:W2"], id: "external", summarySentenceId: "s2" })
    ],
    audit: audit({
      evidenceReview: {
        propositionVerdicts: [{ proposition: "External", sentenceId: "s2", verdict: "supported" }],
        reason: "The external sentence was reviewed.",
        unsupportedSentenceIds: [],
        verdict: "pass"
      },
      evidenceToolCalls: [
        { evidenceIds: ["evidence-local"], kind: "read" },
        { evidenceIds: ["evidence-local"], kind: "view", pages: [1] }
      ]
    }),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked.find((item) => item.id === "local")?.quality?.evidenceAttention).toBe(1);
  expect(ranked.find((item) => item.id === "external")?.quality?.evidenceAttention).toBe(0);
});

test("keeps at most two anchors per sentence, eight per page, and returns stable document order", () => {
  const summarySentences = Array.from({ length: 5 }, (_, index) => sentence({
    evidenceIds: [`evidence-${index + 1}`],
    id: `s${index + 1}`,
    text: `Sentence ${index + 1}.`
  }));
  const anchors = [
    anchor({ id: "s1-low", importance: 0.2, start: 0, summarySentenceId: "s1" }),
    anchor({ id: "s1-high", importance: 1, start: 8, summarySentenceId: "s1" }),
    anchor({ id: "s1-mid", importance: 0.8, start: 4, summarySentenceId: "s1" }),
    ...Array.from({ length: 6 }, (_, index) => anchor({
      evidenceIds: [`evidence-${Math.floor(index / 2) + 2}`],
      id: `later-${index}`,
      importance: 0.9 - index * 0.01,
      start: index % 2,
      summarySentenceId: `s${Math.floor(index / 2) + 2}`
    }))
  ];
  const input = {
    anchors,
    audit: audit(),
    referencesByAnchorId: new Map(),
    summarySentences
  };

  const first = rankThinReadingAnchors(input);
  const second = rankThinReadingAnchors(input);

  expect(first).toEqual(second);
  expect(first).toHaveLength(8);
  expect(first.filter((item) => item.summarySentenceId === "s1").map((item) => item.id)).toEqual([
    "s1-mid",
    "s1-high"
  ]);
  expect(first.some((item) => item.id === "s1-low")).toBe(false);
  expect(first.map((item) => summarySentences.findIndex((sentenceItem) => (
    sentenceItem.id === item.summarySentenceId
  )))).toEqual([...first].map((item) => summarySentences.findIndex((sentenceItem) => (
    sentenceItem.id === item.summarySentenceId
  ))).sort((left, right) => left - right));
});

test("does not let negligible type diversity displace materially stronger anchors", () => {
  const summarySentences = Array.from({ length: 9 }, (_, index) => sentence({ id: `s${index + 1}` }));
  const ranked = rankThinReadingAnchors({
    anchors: [
      ...Array.from({ length: 8 }, (_, index) => anchor({
        id: `strong-${index}`,
        importance: 1 - index * 0.01,
        kind: "concept",
        summarySentenceId: `s${index + 1}`
      })),
      anchor({ id: "negligible-limitation", importance: 0.05, kind: "limitation", summarySentenceId: "s9" })
    ],
    audit: audit(),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked).toHaveLength(8);
  expect(ranked.some((item) => item.id === "negligible-limitation")).toBe(false);
});

test("uses the next eligible diverse candidate when the strongest one is sentence-blocked", () => {
  const summarySentences = Array.from({ length: 8 }, (_, index) => sentence({ id: `s${index + 1}` }));
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({ id: "s1-high", importance: 1, kind: "concept", start: 0, summarySentenceId: "s1" }),
      anchor({ id: "s1-next", importance: 0.99, kind: "concept", start: 8, summarySentenceId: "s1" }),
      anchor({ id: "blocked-limitation", importance: 0.8, kind: "limitation", start: 16, summarySentenceId: "s1" }),
      anchor({ id: "eligible-limitation", importance: 0.72, kind: "limitation", summarySentenceId: "s2" }),
      ...Array.from({ length: 7 }, (_, index) => anchor({
        id: `other-${index}`,
        importance: 0.84 - index * 0.01,
        kind: "concept",
        summarySentenceId: `s${index + 2}`
      }))
    ],
    audit: audit(),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked.filter((item) => item.summarySentenceId === "s1").map((item) => item.id)).toEqual([
    "s1-high",
    "s1-next"
  ]);
  expect(ranked.some((item) => item.id === "blocked-limitation")).toBe(false);
  expect(ranked.some((item) => item.id === "eligible-limitation")).toBe(true);
});

test("keeps only the strongest candidate for a duplicate anchor ID", () => {
  const summarySentences = [sentence({ id: "s1" }), sentence({ id: "s2" })];
  const ranked = rankThinReadingAnchors({
    anchors: [
      anchor({ id: "duplicate", importance: 0.2, summarySentenceId: "s1" }),
      anchor({ id: "duplicate", importance: 0.9, summarySentenceId: "s2" })
    ],
    audit: audit(),
    referencesByAnchorId: new Map(),
    summarySentences
  });

  expect(ranked).toHaveLength(1);
  expect(ranked[0]).toMatchObject({ id: "duplicate", importance: 0.9, summarySentenceId: "s2" });
});

test("uses the first document occurrence when persisted sentence IDs are duplicated", () => {
  const ranked = rankThinReadingAnchors({
    anchors: [anchor({ evidenceIds: [], id: "anchor", summarySentenceId: "duplicate-sentence" })],
    audit: audit(),
    referencesByAnchorId: new Map(),
    summarySentences: [
      sentence({ evidenceIds: ["evidence-first"], id: "duplicate-sentence", status: "grounded" }),
      sentence({ evidenceIds: [], id: "duplicate-sentence", status: "unsupported" })
    ]
  });

  expect(ranked[0]?.quality?.evidenceCoverage).toBe(0.25);
  expect(ranked[0]?.quality?.reason).toContain("1 条证据");
});
