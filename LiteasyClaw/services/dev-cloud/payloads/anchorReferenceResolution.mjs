/**
 * Turns an anchor's local reference subset — bibliography numbers plus the entry as printed —
 * into paper identifiers the retrieval stack can use.
 *
 * The measured reason this exists: the whole paper's citation neighbourhood scored 40% relevant
 * against an anchor while plain topic search scored 68%. A reference list contains everything
 * the paper ever cites; only the references sitting next to an anchor speak about that anchor.
 * Attribution (client side, `pdf/citationAttribution.ts`) produces the subset; this resolves it.
 *
 * Matching is deliberately a **closed-set** problem rather than an open title search. The paper
 * being read already declares its own `referenced_works`, and `[7]` in its body is necessarily
 * one of them. Searching the open web for each entry would be N fuzzy queries with no ground
 * truth; matching inside a known set of ~40 candidates is one batch fetch and is checkable.
 */
import { normalizeText, normalizeTitle, sourceIdFromWork } from "./scholarlyText.mjs";

/** Below this a match is a guess, and a wrong identifier is worse than an unresolved one. */
const minimumMatchScore = 0.6;
/** Short titles ("Attention", "Deep Learning") appear inside unrelated entries by accident. */
const minimumUnaidedTitleLength = 12;
const minimumUnaidedTitleTokens = 3;

/**
 * Anchor-level bibliographic coupling: how much a candidate's reference list overlaps the
 * anchor's local subset rather than the whole paper's. Jaccard, so a candidate citing hundreds
 * of works cannot look close to every anchor.
 *
 * The written definition lives with attribution, in
 * `desktop/src/app/features/pdf/citationAttribution.ts` (`anchorBibliographicCoupling`); the
 * test here reuses that test's fixtures so the two cannot drift apart unnoticed.
 */
export function anchorCoupling(anchorWorkIds, candidateWorkIds) {
  const anchorSet = new Set((anchorWorkIds ?? []).filter(Boolean));
  const candidateSet = new Set((candidateWorkIds ?? []).filter(Boolean));
  if (anchorSet.size === 0 || candidateSet.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const key of anchorSet) {
    if (candidateSet.has(key)) {
      shared += 1;
    }
  }
  return shared === 0 ? 0 : shared / (anchorSet.size + candidateSet.size - shared);
}

function firstAuthorFamilyName(work) {
  const authorships = Array.isArray(work?.authorships) ? work.authorships : [];
  const displayName = normalizeTitle(authorships[0]?.author?.display_name);
  const parts = displayName.split(" ").filter(Boolean);
  const family = parts[parts.length - 1] ?? "";
  return family.length >= 3 ? family : "";
}

function titleOverlap(titleTokens, entryTokens) {
  if (titleTokens.length === 0) {
    return 0;
  }
  const present = titleTokens.filter((token) => entryTokens.has(token)).length;
  return present / titleTokens.length;
}

/**
 * How strongly one bibliography entry looks like one candidate work.
 *
 * The title carrying is the necessary signal — year and author alone cannot tell two papers
 * by the same group in the same year apart. Year and author only break ties.
 */
function matchScore(entryText, entryTokens, work) {
  const title = normalizeTitle(work?.display_name ?? work?.title);
  const titleTokens = title.split(" ").filter(Boolean);
  if (titleTokens.length === 0) {
    return 0;
  }

  const year = Number.isInteger(work?.publication_year) ? String(work.publication_year) : "";
  const yearMatches = Boolean(year) && entryTokens.has(year);
  const family = firstAuthorFamilyName(work);
  const authorMatches = Boolean(family) && entryTokens.has(family);

  const substringHit = entryText.includes(title);
  const longEnoughAlone =
    title.length >= minimumUnaidedTitleLength && titleTokens.length >= minimumUnaidedTitleTokens;

  let base = 0;
  if (substringHit && longEnoughAlone) {
    // The title is printed verbatim inside the entry. Nothing beats that.
    base = 1;
  } else if (substringHit && (yearMatches || authorMatches)) {
    // A short title is only trustworthy when something else in the entry agrees.
    base = 0.75;
  } else {
    // Line breaks, ligatures and dropped subtitles keep whole-string matching from firing on
    // otherwise obvious entries, so fall back to how much of the title is present at all.
    const overlap = titleOverlap(titleTokens, entryTokens);
    if (overlap < 0.8 || titleTokens.length < minimumUnaidedTitleTokens) {
      return 0;
    }
    base = 0.7 * overlap;
  }

  return Math.min(1, base + (yearMatches ? 0.1 : 0) + (authorMatches ? 0.08 : 0));
}

/**
 * Assigns bibliography entries to works, one to one.
 *
 * Pure and deterministic: no network, no clock, ties broken by reference number then work id.
 * Greedy over the best-scoring pairs is enough here — the candidate set is one paper's
 * reference list, and a genuine title match is far above every competing one.
 *
 * @param entries `[{ number, text }]` from the anchor's local subset.
 * @param works OpenAlex works — the target paper's own `referenced_works`, already fetched.
 * @returns `{ matched, unmatched }`, where `unmatched` is every number no work could be found
 *   for. That count is worth surfacing: it is how much of the subset never reaches retrieval.
 */
export function matchReferenceEntriesToWorks(entries, works) {
  const candidates = (Array.isArray(works) ? works : [])
    .map((work) => ({ work, workId: sourceIdFromWork(work) }))
    .filter((candidate) => candidate.workId);
  const numbered = (Array.isArray(entries) ? entries : [])
    .filter((entry) => Number.isInteger(entry?.number) && normalizeText(entry?.text));

  const pairs = [];
  for (const entry of numbered) {
    const entryText = normalizeTitle(entry.text);
    const entryTokens = new Set(entryText.split(" ").filter(Boolean));
    for (const candidate of candidates) {
      const score = matchScore(entryText, entryTokens, candidate.work);
      if (score >= minimumMatchScore) {
        pairs.push({
          number: entry.number,
          score,
          title: normalizeText(candidate.work?.display_name ?? candidate.work?.title),
          workId: candidate.workId
        });
      }
    }
  }
  pairs.sort((left, right) =>
    right.score - left.score ||
    left.number - right.number ||
    left.workId.localeCompare(right.workId));

  const takenNumbers = new Set();
  const takenWorkIds = new Set();
  const matched = [];
  for (const pair of pairs) {
    if (takenNumbers.has(pair.number) || takenWorkIds.has(pair.workId)) {
      continue;
    }
    takenNumbers.add(pair.number);
    takenWorkIds.add(pair.workId);
    matched.push(pair);
  }
  matched.sort((left, right) => left.number - right.number);

  return {
    matched,
    unmatched: numbered
      .map((entry) => entry.number)
      .filter((number) => !takenNumbers.has(number))
      .sort((left, right) => left - right)
  };
}
