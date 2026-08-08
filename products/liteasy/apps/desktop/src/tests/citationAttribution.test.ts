import type {
  AnchorLocalReferences,
  AnchorTextPosition,
  PdfPageText
} from "../app/features/pdf/citationAttribution";
import {
  anchorBibliographicCoupling,
  attributeReferencesToAnchor,
  buildAnchorLocalReferenceIndex,
  findReferenceSectionStart,
  parseAuthorYearCitationMarkers,
  parseAuthorYearReferences,
  parseNumberedReferences,
  parseNumericCitationMarkers
} from "../app/features/pdf/citationAttribution";

function numbersOf(attributed: AnchorLocalReferences) {
  return attributed.references.map((reference) => reference.number);
}

function anchorAt(input: {
  id: string;
  page: number;
  text: string;
  pageText: string;
}): AnchorTextPosition {
  const start = input.pageText.indexOf(input.text);
  if (start < 0) {
    throw new Error(`anchor text not present on page: ${input.text}`);
  }
  return {
    id: input.id,
    page: input.page,
    sourceEnd: start + input.text.length,
    sourceStart: start
  };
}

const bodyPage = [
  "We rely on self-attention [1, 2] to relate positions within a sequence.",
  "For evaluation we report BLEU [7] on the WMT benchmark.",
  "Earlier recurrent models [3-5] processed tokens strictly in order."
].join("\n");

const referencePage = [
  "References",
  "[1] Bahdanau et al. Neural Machine Translation by Jointly Learning to Align and Translate.",
  "[2] Luong et al. Effective Approaches to Attention-based Neural Machine Translation.",
  "[3] Graves. Generating Sequences With Recurrent Neural Networks.",
  "[7] Papineni et al. BLEU: a Method for Automatic Evaluation of Machine Translation."
].join("\n");

const pages: PdfPageText[] = [
  { page: 1, text: bodyPage },
  { page: 2, text: referencePage }
];

test("expands every numeric citation style found in the body", () => {
  const markers = parseNumericCitationMarkers(pages);

  expect(markers.map((marker) => marker.numbers)).toEqual([
    [1, 2],
    [7],
    [3, 4, 5]
  ]);
  expect(markers.every((marker) => marker.page === 1)).toBe(true);
});

test("ignores the bibliography's own numbering", () => {
  const start = findReferenceSectionStart(pages);

  expect(start).toEqual({ offset: 0, page: 2 });
  // Four bracketed numbers live in the reference list and must not become in-text markers.
  expect(parseNumericCitationMarkers(pages).every((marker) => marker.page === 1)).toBe(true);
});

test("keeps bracketed years out of the reference numbers", () => {
  const markers = parseNumericCitationMarkers([
    { page: 1, text: "An earlier survey [2020] and a real citation [4]." }
  ], null);

  expect(markers.map((marker) => marker.numbers)).toEqual([[4]]);
});

test("reads the bibliography as a numbered list", () => {
  const references = parseNumberedReferences(pages);

  expect(references.map((entry) => entry.number)).toEqual([1, 2, 3, 7]);
  expect(references[3].text).toContain("BLEU: a Method for Automatic Evaluation");
});

test("also reads a bibliography numbered without brackets", () => {
  const references = parseNumberedReferences([
    { page: 1, text: "参考文献\n1. 张三. 自注意力机制综述.\n2. 李四. 机器翻译评价.\n" }
  ]);

  expect(references).toEqual([
    { number: 1, text: "张三. 自注意力机制综述." },
    { number: 2, text: "李四. 机器翻译评价." }
  ]);
});

test("reads ordinary author-year references and ignores their bibliography occurrences", () => {
  const authorYearPages: PdfPageText[] = [
    {
      page: 1,
      text: "Self-attention follows Smith (2020). BLEU follows earlier evaluation (Jones & Lee, 2019)."
    },
    {
      page: 2,
      text: [
        "References",
        "Smith, J. (2020). Attention without recurrence.",
        "Jones, A., & Lee, B. (2019). Reliable machine translation evaluation."
      ].join("\n")
    }
  ];
  const references = parseAuthorYearReferences(authorYearPages);
  const markers = parseAuthorYearCitationMarkers(authorYearPages, references);

  expect(references.map((entry) => entry.label)).toEqual(["Smith, 2020", "Jones, 2019"]);
  expect(markers).toHaveLength(2);
  expect(markers.every((marker) => marker.page === 1)).toBe(true);
});

test("attributes author-year citations to the nearby anchor with readable evidence", () => {
  const pageText = [
    "Self-attention follows Smith (2020).",
    "BLEU follows the evaluation of Jones and Lee (2019)."
  ].join("\n");
  const authorYearPages: PdfPageText[] = [
    { page: 1, text: pageText },
    {
      page: 2,
      text: [
        "References",
        "Smith, J. (2020). Attention without recurrence.",
        "Jones, A., & Lee, B. (2019). Reliable machine translation evaluation."
      ].join("\n")
    }
  ];
  const index = buildAnchorLocalReferenceIndex({
    anchors: [
      anchorAt({ id: "a-self", page: 1, pageText, text: "Self-attention" }),
      anchorAt({ id: "a-bleu", page: 1, pageText, text: "BLEU" })
    ],
    pages: authorYearPages
  });

  expect(index[0].references).toHaveLength(1);
  expect(index[0].references[0].evidence).toContain("Smith, 2020");
  expect(index[0].references[0].text).toContain("Attention without recurrence");
  expect(index[1].references).toHaveLength(1);
  expect(index[1].references[0].evidence).toContain("Jones, 2019");
});

test("attributes only the citations sitting next to the anchor", () => {
  const markers = parseNumericCitationMarkers(pages);
  const references = parseNumberedReferences(pages);

  const selfAttention = attributeReferencesToAnchor(
    anchorAt({ id: "a-self-attention", page: 1, pageText: bodyPage, text: "self-attention" }),
    markers,
    { pageText: bodyPage, references }
  );
  const bleu = attributeReferencesToAnchor(
    anchorAt({ id: "a-bleu", page: 1, pageText: bodyPage, text: "BLEU" }),
    markers,
    { pageText: bodyPage, references }
  );

  // This is the whole point: the two anchors get different reference subsets, where the
  // paper-level bibliography would have handed both of them all four.
  expect(numbersOf(selfAttention)).toEqual([1, 2]);
  expect(numbersOf(bleu)).toEqual([7]);
});

test("names the evidence so it can be shown before clicking through", () => {
  const attributed = attributeReferencesToAnchor(
    anchorAt({ id: "a-bleu", page: 1, pageText: bodyPage, text: "BLEU" }),
    parseNumericCitationMarkers(pages),
    { pageText: bodyPage, references: parseNumberedReferences(pages) }
  );

  expect(attributed.references).toHaveLength(1);
  expect(attributed.references[0].evidence).toContain("本文参考文献 [7]");
  expect(attributed.references[0].evidence).toContain("第 1 页");
  expect(attributed.references[0].evidence).toContain("Papineni");
  // The entry is carried whole, because resolving it to a paper happens where the real
  // candidate titles are known.
  expect(attributed.references[0].text).toContain("Papineni et al. BLEU");
});

test("every reference keeps its own evidence, whatever order the markers appeared in", () => {
  // The markers here run [7] then [1], so the numeric sort reorders them. Two parallel
  // arrays would hand [1] the sentence naming [7].
  const pageText = "We report BLEU [7] and rely on self-attention [1] throughout.";
  const attributed = attributeReferencesToAnchor(
    anchorAt({ id: "a", page: 1, pageText, text: "BLEU [7] and rely on self-attention" }),
    parseNumericCitationMarkers([{ page: 1, text: pageText }], null),
    { pageText, references: parseNumberedReferences(pages) }
  );

  expect(numbersOf(attributed)).toEqual([1, 7]);
  for (const reference of attributed.references) {
    expect(reference.evidence).toContain(`本文参考文献 [${reference.number}]`);
  }
  expect(attributed.references[0].text).toContain("Bahdanau");
  expect(attributed.references[1].text).toContain("Papineni");
});

test("a tighter window narrows the subset instead of pulling in the next sentence", () => {
  const markers = parseNumericCitationMarkers(pages);
  const anchor = anchorAt({ id: "a-recurrent", page: 1, pageText: bodyPage, text: "recurrent models" });

  expect(numbersOf(attributeReferencesToAnchor(anchor, markers, { window: 4 })))
    .toEqual([3, 4, 5]);
  // Widened far enough, the neighbouring sentences' citations leak in — which is exactly
  // the paper-level behaviour the window exists to prevent.
  expect(numbersOf(attributeReferencesToAnchor(anchor, markers, { window: 400 })))
    .toEqual([1, 2, 3, 4, 5, 7]);
});

test("ignores citations on other pages", () => {
  const markers = parseNumericCitationMarkers([
    { page: 1, text: "Self-attention [1] appears here." },
    { page: 3, text: "An unrelated mention [9] on another page." }
  ], null);
  const anchor = anchorAt({
    id: "a",
    page: 1,
    pageText: "Self-attention [1] appears here.",
    text: "Self-attention"
  });

  expect(numbersOf(attributeReferencesToAnchor(anchor, markers, {
    pageText: "Self-attention [1] appears here."
  }))).toEqual([1]);
});

test("builds one subset per anchor in a single pass", () => {
  const index = buildAnchorLocalReferenceIndex({
    anchors: [
      anchorAt({ id: "a-self-attention", page: 1, pageText: bodyPage, text: "self-attention" }),
      anchorAt({ id: "a-bleu", page: 1, pageText: bodyPage, text: "BLEU" })
    ],
    pages
  });

  expect(index.map((entry) => [entry.anchorId, numbersOf(entry)])).toEqual([
    ["a-self-attention", [1, 2]],
    ["a-bleu", [7]]
  ]);
});

test("an anchor with no nearby citation gets an empty subset rather than the whole paper", () => {
  const pageText = "This paragraph states a claim with no citation at all.";
  const attributed = attributeReferencesToAnchor(
    anchorAt({ id: "a-claim", page: 1, pageText, text: "a claim" }),
    parseNumericCitationMarkers([{ page: 1, text: pageText }], null),
    { pageText }
  );

  expect(attributed.references).toEqual([]);
});

test("scores coupling against the anchor's subset, normalised by both sizes", () => {
  // Identical subsets couple perfectly.
  expect(anchorBibliographicCoupling(["a", "b"], ["a", "b"])).toBe(1);
  // One shared out of three distinct.
  expect(anchorBibliographicCoupling(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
  expect(anchorBibliographicCoupling(["a"], ["b"])).toBe(0);
  // A candidate citing everything must not look close to every anchor.
  const huge = Array.from({ length: 200 }, (_unused, index) => `ref-${index}`);
  expect(anchorBibliographicCoupling(["ref-1", "ref-2"], huge)).toBeLessThan(0.02);
  expect(anchorBibliographicCoupling([], ["a"])).toBe(0);
});

test("falls back past the sentence only when the anchor's own sentence cites nothing", () => {
  const pageText = [
    "Self-attention [1, 2] relates positions within a sequence.",
    "We report BLEU on the WMT benchmark.",
    "Earlier recurrent models [3] processed tokens in order."
  ].join("\n");
  const markers = parseNumericCitationMarkers([{ page: 1, text: pageText }], null);

  // Its own sentence cites [1,2], so the neighbours stay out.
  expect(numbersOf(attributeReferencesToAnchor(
    anchorAt({ id: "a-self", page: 1, pageText, text: "Self-attention" }),
    markers,
    { pageText }
  ))).toEqual([1, 2]);

  // BLEU's sentence cites nothing, so the bounded fallback reaches the neighbours.
  expect(numbersOf(attributeReferencesToAnchor(
    anchorAt({ id: "a-bleu", page: 1, pageText, text: "BLEU" }),
    markers,
    { pageText }
  ))).toEqual([1, 2, 3]);

  // A narrow fallback keeps even that empty rather than guessing.
  expect(numbersOf(attributeReferencesToAnchor(
    anchorAt({ id: "a-bleu", page: 1, pageText, text: "BLEU" }),
    markers,
    { fallbackWindow: 2, pageText }
  ))).toEqual([]);
});
