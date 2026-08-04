import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorCoupling,
  matchReferenceEntriesToWorks
} from "./anchorReferenceResolution.mjs";

/** An OpenAlex work, trimmed to the fields matching actually reads. */
function work({ family, id, title, year }) {
  return {
    ...(family ? { authorships: [{ author: { display_name: `Given ${family}` } }] } : {}),
    display_name: title,
    id: `https://openalex.org/${id}`,
    ...(year ? { publication_year: year } : {})
  };
}

const bahdanau = work({
  family: "Bahdanau",
  id: "W2000",
  title: "Neural Machine Translation by Jointly Learning to Align and Translate",
  year: 2015
});
const papineni = work({
  family: "Papineni",
  id: "W2001",
  title: "BLEU: a Method for Automatic Evaluation of Machine Translation",
  year: 2002
});

test("matches an entry whose printed text carries the candidate's title", () => {
  const resolved = matchReferenceEntriesToWorks([{
    number: 2,
    text: "Bahdanau, D., Cho, K., Bengio, Y. Neural Machine Translation by Jointly " +
      "Learning to Align and Translate. ICLR, 2015."
  }], [bahdanau, papineni]);

  assert.deepEqual(resolved.matched.map((entry) => [entry.number, entry.workId]), [[2, "W2000"]]);
  assert.deepEqual(resolved.unmatched, []);
});

test("reports the numbers no candidate could be found for", () => {
  // The reference genuinely is not among the target's own referenced_works — OpenAlex does
  // not index everything. Silently dropping it would hide how much of the subset never
  // reaches retrieval.
  const resolved = matchReferenceEntriesToWorks([
    { number: 2, text: "Bahdanau et al. Neural Machine Translation by Jointly Learning to Align and Translate." },
    { number: 31, text: "Sennrich et al. Neural Machine Translation of Rare Words with Subword Units." }
  ], [bahdanau]);

  assert.deepEqual(resolved.matched.map((entry) => entry.number), [2]);
  assert.deepEqual(resolved.unmatched, [31]);
});

test("assigns one work to one entry, giving it to the stronger match", () => {
  // Both entries mention the same work; only the one printing the title in full should take
  // it, or a bibliography's running text would resolve several numbers to one paper.
  const resolved = matchReferenceEntriesToWorks([
    {
      number: 7,
      text: "Papineni, K. et al. BLEU: a Method for Automatic Evaluation of Machine " +
        "Translation. ACL, 2002."
    },
    {
      number: 8,
      text: "See also the method for automatic evaluation of machine translation discussed above."
    }
  ], [papineni]);

  assert.deepEqual(resolved.matched.map((entry) => [entry.number, entry.workId]), [[7, "W2001"]]);
  assert.deepEqual(resolved.unmatched, [8]);
});

test("a short title only counts when the year or author agrees", () => {
  const deepLearning = work({ family: "LeCun", id: "W2002", title: "Deep Learning", year: 2015 });

  const corroborated = matchReferenceEntriesToWorks(
    [{ number: 4, text: "LeCun, Y., Bengio, Y., Hinton, G. Deep Learning. Nature, 2015." }],
    [deepLearning]
  );
  assert.deepEqual(corroborated.matched.map((entry) => entry.workId), ["W2002"]);

  // "Deep Learning" turns up inside entries that are not that paper. With nothing else in
  // the entry agreeing, an identifier here would simply be wrong.
  const bare = matchReferenceEntriesToWorks(
    [{ number: 5, text: "A broad survey of deep learning approaches to vision." }],
    [deepLearning]
  );
  assert.deepEqual(bare.matched, []);
  assert.deepEqual(bare.unmatched, [5]);
});

test("survives the text layer breaking a word across lines", () => {
  // This is the actual failure mode: pdf.js yields "Trans- lation" as "trans lation", so the
  // title is no longer a substring even though the entry is obviously the same paper.
  const resolved = matchReferenceEntriesToWorks([{
    number: 2,
    text: "Bahdanau, D. Neural Machine Trans lation by Jointly Learning to Align and " +
      "Translate. ICLR, 2015."
  }], [bahdanau]);

  assert.deepEqual(resolved.matched.map((entry) => entry.workId), ["W2000"]);
});

test("breaks ties deterministically so the same paper always resolves the same way", () => {
  const duplicateTitle = "Sequence to Sequence Learning with Neural Networks";
  const candidates = [
    work({ id: "W3002", title: duplicateTitle, year: 2014 }),
    work({ id: "W3001", title: duplicateTitle, year: 2014 })
  ];
  const entries = [{ number: 9, text: `Sutskever et al. ${duplicateTitle}. NIPS, 2014.` }];

  const first = matchReferenceEntriesToWorks(entries, candidates);
  const second = matchReferenceEntriesToWorks(entries, [...candidates].reverse());

  assert.deepEqual(first.matched.map((entry) => entry.workId), ["W3001"]);
  assert.deepEqual(second.matched, first.matched);
});

test("ignores entries and candidates with nothing to match on", () => {
  assert.deepEqual(matchReferenceEntriesToWorks([], [bahdanau]), { matched: [], unmatched: [] });
  assert.deepEqual(
    matchReferenceEntriesToWorks([{ number: 1, text: "   " }], [bahdanau]),
    { matched: [], unmatched: [] }
  );
  // A work with no usable OpenAlex id cannot be pointed at, so it is not a candidate.
  assert.deepEqual(
    matchReferenceEntriesToWorks(
      [{ number: 1, text: "Bahdanau et al. Neural Machine Translation by Jointly Learning to Align and Translate." }],
      [{ display_name: "Neural Machine Translation by Jointly Learning to Align and Translate", id: "" }]
    ),
    { matched: [], unmatched: [1] }
  );
});

test("scores coupling against the anchor's subset, normalised by both sizes", () => {
  // These are the fixtures from desktop/src/tests/citationAttribution.test.ts, where the
  // anchor-level definition lives. Keeping them identical is what stops the two copies of
  // this formula from drifting apart unnoticed.
  assert.equal(anchorCoupling(["a", "b"], ["a", "b"]), 1);
  assert.ok(Math.abs(anchorCoupling(["a", "b"], ["b", "c"]) - 1 / 3) < 1e-9);
  assert.equal(anchorCoupling(["a"], ["b"]), 0);
  const huge = Array.from({ length: 200 }, (_unused, index) => `ref-${index}`);
  assert.ok(anchorCoupling(["ref-1", "ref-2"], huge) < 0.02);
  assert.equal(anchorCoupling([], ["a"]), 0);
  assert.equal(anchorCoupling(undefined, ["a"]), 0);
});
