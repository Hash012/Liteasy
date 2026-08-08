/** One page of extracted text. Declared here because attribution is the module that needs it. */
export type PdfPageText = {
  page: number;
  text: string;
};

/**
 * Attributes citations to the anchor they sit next to, which is what turns a paper-level
 * citation graph into an anchor-level one.
 *
 * The measured problem this solves: using the whole paper's citation neighbourhood scored
 * 40% relevant against an anchor, while plain topic search scored 68%. A paper's reference
 * list contains everything it ever cites — for the anchor "self-attention", that includes
 * the Penn Treebank corpus. Only the references near the anchor speak about the anchor.
 *
 * This module is deliberately local and deterministic: it reads numeric citations (`[12]`,
 * `[3, 4]`, `[5-7]`) and ordinary author-year citations (`Smith, 2020`) straight from the
 * extracted text layer, with no parsing service involved. Footnote-based humanities styles still
 * need a real reference parser and remain an explicit degradation boundary.
 */

/**
 * The only thing attribution needs to know about an anchor: where its text sits. Kept
 * structural on purpose so this works against whatever carries the position — today the
 * discovery heuristic, tomorrow an evidence span on a graph node.
 */
export type AnchorTextPosition = {
  id: string;
  page: number;
  sourceEnd: number;
  sourceStart: number;
};

export type CitationMarker = {
  /** Exclusive end offset within the page text. */
  end: number;
  /** Every reference number the marker resolves to, ranges expanded. */
  numbers: number[];
  page: number;
  start: number;
};

export type ReferenceEntry = {
  /** Human citation label for styles that do not have a printed reference number. */
  label?: string;
  number: number;
  text: string;
};

export type AnchorLocalReference = {
  /** Why this number was attributed here — shown before the reader clicks through. */
  evidence: string;
  label?: string;
  number: number;
  /** The bibliography entry as printed. Empty when the reference list could not be parsed.
   *  Kept whole rather than split into title/authors/year: matching it against a candidate
   *  works far better where the real titles are known, which is the retrieval side. */
  text: string;
};

export type AnchorLocalReferences = {
  anchorId: string;
  /** Sorted by reference number. One object per number keeps each entry with its own
   *  evidence — two parallel arrays sorted differently silently mismatched them. */
  references: AnchorLocalReference[];
};

export type ReferenceSectionStart = {
  offset: number;
  page: number;
};

/** Bibliographies that number past this are vanishingly rare, while bracketed years like
 *  `[2020]` are common. Capping keeps years out of the reference numbers. */
const maximumReferenceNumber = 999;

/**
 * How far past the anchor's own sentence to look when that sentence cites nothing.
 *
 * Measured on «Attention Is All You Need» (40 references, 63 in-text markers): same-sentence
 * attribution reaches only 1 of 25 "self-attention" mentions and 0 of 11 "BLEU" mentions —
 * precise but too sparse to be useful. Widening is not free, though: at ±600 characters the
 * "local" subset grows to 22 of the paper's 40 references, which is just paper-level
 * behaviour again. ±120 lifts recall about fivefold while the subset stays at 7 of 40.
 */
export const defaultFallbackWindow = 120;

const referenceHeadingPattern =
  /^\s*(?:references?|bibliography|works\s+cited|参\s*考\s*文\s*献|引用文献)\s*:?\s*$/iu;

function expandRange(from: number, to: number) {
  if (to < from || to - from > 64) {
    return [from];
  }
  const numbers: number[] = [];
  for (let value = from; value <= to; value += 1) {
    numbers.push(value);
  }
  return numbers;
}

function parseMarkerNumbers(body: string) {
  const numbers: number[] = [];
  for (const part of body.split(/\s*,\s*/u)) {
    const range = part.match(/^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/u);
    if (range) {
      numbers.push(...expandRange(Number(range[1]), Number(range[2])));
      continue;
    }
    const single = part.match(/^(\d{1,3})$/u);
    if (single) {
      numbers.push(Number(single[1]));
    }
  }
  return [...new Set(numbers)].filter(
    (value) => value >= 1 && value <= maximumReferenceNumber
  ).sort((left, right) => left - right);
}

/**
 * Where the bibliography begins. Everything after it is the reference list itself, whose
 * own `[12]` numbering must not be mistaken for in-text citations.
 */
export function findReferenceSectionStart(
  pages: readonly PdfPageText[]
): ReferenceSectionStart | null {
  for (const page of [...pages].sort((left, right) => left.page - right.page)) {
    let offset = 0;
    for (const line of page.text.split(/\r?\n/u)) {
      if (referenceHeadingPattern.test(line)) {
        return { offset, page: page.page };
      }
      offset += line.length + 1;
    }
  }
  return null;
}

function isAfterReferenceStart(
  position: { offset: number; page: number },
  start: ReferenceSectionStart | null
) {
  if (!start) {
    return false;
  }
  return position.page > start.page ||
    (position.page === start.page && position.offset >= start.offset);
}

export function parseNumericCitationMarkers(
  pages: readonly PdfPageText[],
  referenceSectionStart: ReferenceSectionStart | null = findReferenceSectionStart(pages)
): CitationMarker[] {
  const markers: CitationMarker[] = [];
  for (const page of pages) {
    const pattern = /\[([\d\s,–—-]{1,40})\]/gu;
    let match = pattern.exec(page.text);
    while (match) {
      const numbers = parseMarkerNumbers(match[1]);
      const start = match.index;
      if (
        numbers.length > 0 &&
        !isAfterReferenceStart({ offset: start, page: page.page }, referenceSectionStart)
      ) {
        markers.push({ end: start + match[0].length, numbers, page: page.page, start });
      }
      match = pattern.exec(page.text);
    }
  }
  return markers;
}

/**
 * The bibliography as a numbered list. Entries are what makes an attribution readable —
 * "本文参考文献 [12]" is only useful if [12] can be named.
 */
export function parseNumberedReferences(
  pages: readonly PdfPageText[],
  referenceSectionStart: ReferenceSectionStart | null = findReferenceSectionStart(pages)
): ReferenceEntry[] {
  if (!referenceSectionStart) {
    return [];
  }
  const tail = pages
    .filter((page) => page.page >= referenceSectionStart.page)
    .sort((left, right) => left.page - right.page)
    .map((page) => (
      page.page === referenceSectionStart.page
        ? page.text.slice(referenceSectionStart.offset)
        : page.text
    ))
    .join("\n");

  const entries = new Map<number, string>();
  // Entries start either "[12] …" or "12. …" at the beginning of a line.
  const pattern = /(?:^|\n)\s*(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+/gu;
  const matches = [...tail.matchAll(pattern)];
  matches.forEach((match, index) => {
    const number = Number(match[1] ?? match[2]);
    if (!Number.isInteger(number) || number < 1 || number > maximumReferenceNumber) {
      return;
    }
    const from = (match.index ?? 0) + match[0].length;
    const to = index + 1 < matches.length ? matches[index + 1].index ?? tail.length : tail.length;
    const text = tail.slice(from, to).replace(/\s+/gu, " ").trim();
    if (text && !entries.has(number)) {
      entries.set(number, text);
    }
  });
  return [...entries.entries()]
    .map(([number, text]) => ({ number, text }))
    .sort((left, right) => left.number - right.number);
}

const authorYearReferenceNumberBase = 100_000;

function authorYearKey(surname: string, year: string) {
  return `${surname.toLocaleLowerCase()}|${year.toLocaleLowerCase()}`;
}

function firstCitationSurname(value: string) {
  return value.trim().match(/^([\p{L}][\p{L}'’\-]{0,48})/u)?.[1] ?? "";
}

function authorYearParts(value: string) {
  const yearMatch = value.match(/\b((?:19|20)\d{2}[a-z]?)\b/iu);
  if (!yearMatch || yearMatch.index === undefined) return null;
  const surname = firstCitationSurname(value.slice(0, yearMatch.index));
  return surname ? { key: authorYearKey(surname, yearMatch[1]), surname, year: yearMatch[1] } : null;
}

function referenceSectionText(
  pages: readonly PdfPageText[],
  referenceSectionStart: ReferenceSectionStart
) {
  return pages
    .filter((page) => page.page >= referenceSectionStart.page)
    .sort((left, right) => left.page - right.page)
    .map((page) => (
      page.page === referenceSectionStart.page
        ? page.text.slice(referenceSectionStart.offset).split(/\r?\n/u).slice(1).join("\n")
        : page.text
    ))
    .join("\n");
}

/** Reads common unnumbered bibliography entries such as `Smith, J. (2020). …`. */
export function parseAuthorYearReferences(
  pages: readonly PdfPageText[],
  referenceSectionStart: ReferenceSectionStart | null = findReferenceSectionStart(pages)
): ReferenceEntry[] {
  if (!referenceSectionStart) return [];
  const lines = referenceSectionText(pages, referenceSectionStart)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const entries: Array<{ key: string; label: string; text: string }> = [];
  let current: { key: string; label: string; text: string } | null = null;
  for (const line of lines) {
    const parts = authorYearParts(line);
    if (parts) {
      if (current) entries.push(current);
      current = {
        key: parts.key,
        label: `${parts.surname}, ${parts.year}`,
        text: line
      };
    } else if (current) {
      current.text = `${current.text} ${line}`;
    }
  }
  if (current) entries.push(current);

  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (seen.has(entry.key)) return [];
    seen.add(entry.key);
    return [{
      label: entry.label,
      number: authorYearReferenceNumberBase + index,
      text: entry.text
    }];
  });
}

/** Locates parenthetical and narrative author-year citations outside the bibliography. */
export function parseAuthorYearCitationMarkers(
  pages: readonly PdfPageText[],
  references: readonly ReferenceEntry[],
  referenceSectionStart: ReferenceSectionStart | null = findReferenceSectionStart(pages)
): CitationMarker[] {
  const numberByKey = new Map(references.flatMap((reference) => {
    const parts = authorYearParts(reference.label ?? reference.text);
    return parts ? [[parts.key, reference.number] as const] : [];
  }));
  if (numberByKey.size === 0) return [];

  const markers: CitationMarker[] = [];
  const addMarker = (page: number, start: number, end: number, keys: readonly string[]) => {
    if (isAfterReferenceStart({ offset: start, page }, referenceSectionStart)) return;
    const numbers = [...new Set(keys.map((key) => numberByKey.get(key)).filter(
      (number): number is number => number !== undefined
    ))];
    if (numbers.length > 0) markers.push({ end, numbers, page, start });
  };

  for (const page of pages) {
    for (const match of page.text.matchAll(/\(([^()]{2,220})\)/gu)) {
      const keys = match[1].split(/\s*;\s*/u).flatMap((part) => {
        const parts = authorYearParts(part);
        return parts ? [parts.key] : [];
      });
      addMarker(page.page, match.index ?? 0, (match.index ?? 0) + match[0].length, keys);
    }
    for (const match of page.text.matchAll(
      /([\p{L}][\p{L}'’\-]{0,48})(?:\s+et\s+al\.|\s+(?:and|&|和)\s+[\p{L}][\p{L}'’\-]{0,48})?\s*\(((?:19|20)\d{2}[a-z]?)\)/giu
    )) {
      addMarker(
        page.page,
        match.index ?? 0,
        (match.index ?? 0) + match[0].length,
        [authorYearKey(match[1], match[2])]
      );
    }
  }
  return markers.sort((left, right) => left.page - right.page || left.start - right.start);
}

export type TextSpan = {
  end: number;
  start: number;
};

/**
 * Sentence spans, which are the natural unit for citation attribution: a marker belongs to
 * the sentence that placed it. A fixed character window cannot work — on a short page every
 * marker falls inside it, which collapses straight back to paper-level behaviour.
 *
 * Over-splitting on abbreviations like "et al." is acceptable here; it only ever makes a
 * subset tighter, and a tight subset is the point.
 */
export function splitSentenceSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const isCjkStop = character === "。" || character === "！" || character === "？";
    const isLatinStop = (character === "." || character === "!" || character === "?") &&
      (index + 1 >= text.length || /\s/u.test(text[index + 1]));
    if (character === "\n" || isCjkStop || isLatinStop) {
      if (index + 1 > start) {
        spans.push({ end: index + 1, start });
      }
      start = index + 1;
    }
  }
  if (start < text.length) {
    spans.push({ end: text.length, start });
  }
  return spans;
}

function sentenceContaining(spans: readonly TextSpan[], anchor: AnchorTextPosition) {
  return spans.find((span) => anchor.sourceStart < span.end && anchor.sourceEnd > span.start) ??
    null;
}

function distanceToAnchor(marker: CitationMarker, anchor: AnchorTextPosition) {
  if (marker.end <= anchor.sourceStart) {
    return anchor.sourceStart - marker.end;
  }
  if (marker.start >= anchor.sourceEnd) {
    return marker.start - anchor.sourceEnd;
  }
  return 0;
}

/**
 * The reference numbers cited next to one anchor. This is the anchor's local reference
 * subset: overlap against it is an anchor-level closeness measure, unlike overlap against
 * the paper's whole bibliography.
 */
export function attributeReferencesToAnchor(
  anchor: AnchorTextPosition,
  markers: readonly CitationMarker[],
  options: {
    /** Character reach used only when the anchor's own sentence cites nothing. */
    fallbackWindow?: number;
    /** The anchor's page text, needed to find sentence boundaries. Without it, attribution
     *  falls back to a character window. */
    pageText?: string;
    references?: readonly ReferenceEntry[];
    /** Explicit character window, replacing sentence-based attribution entirely. */
    window?: number;
  } = {}
): AnchorLocalReferences {
  const referenceEntries = new Map(
    (options.references ?? []).map((entry) => [entry.number, entry])
  );
  const sentence = options.window === undefined && options.pageText
    ? sentenceContaining(splitSentenceSpans(options.pageText), anchor)
    : null;
  const onPage = markers.filter((marker) => marker.page === anchor.page);
  const inSentence = sentence
    ? onPage.filter((marker) => marker.start >= sentence.start && marker.start < sentence.end)
    : [];
  // Sentence first, because that is where attribution is most trustworthy. Only when the
  // anchor's own sentence cites nothing do we reach into the surrounding text, and only as
  // far as stays selective.
  const fallbackWindow = options.window ?? options.fallbackWindow ?? defaultFallbackWindow;
  const selected = sentence && inSentence.length > 0
    ? inSentence
    : onPage.filter((marker) => distanceToAnchor(marker, anchor) <= fallbackWindow);
  const references = new Map<number, AnchorLocalReference>();

  for (const marker of selected) {
    for (const number of marker.numbers) {
      if (references.has(number)) {
        continue;
      }
      const entry = referenceEntries.get(number);
      const text = entry?.text ?? "";
      const label = entry?.label ?? `[${number}]`;
      references.set(number, {
        evidence:
          `本文参考文献 ${label}，引用出现在第 ${marker.page} 页${text ? `：${text.slice(0, 80)}` : ""}`,
        label: entry?.label,
        number,
        text
      });
    }
  }

  return {
    anchorId: anchor.id,
    references: [...references.values()].sort((left, right) => left.number - right.number)
  };
}

export function buildAnchorLocalReferenceIndex(input: {
  anchors: readonly AnchorTextPosition[];
  fallbackWindow?: number;
  pages: readonly PdfPageText[];
  window?: number;
}): AnchorLocalReferences[] {
  const referenceSectionStart = findReferenceSectionStart(input.pages);
  const numberedReferences = parseNumberedReferences(input.pages, referenceSectionStart);
  const authorYearReferences = parseAuthorYearReferences(input.pages, referenceSectionStart);
  const references = [...numberedReferences, ...authorYearReferences];
  const markers = [
    ...parseNumericCitationMarkers(input.pages, referenceSectionStart),
    ...parseAuthorYearCitationMarkers(input.pages, authorYearReferences, referenceSectionStart)
  ];
  const textByPage = new Map(input.pages.map((page) => [page.page, page.text]));
  return input.anchors.map((anchor) =>
    attributeReferencesToAnchor(anchor, markers, {
      fallbackWindow: input.fallbackWindow,
      pageText: textByPage.get(anchor.page),
      references,
      window: input.window
    })
  );
}

/**
 * Anchor-level bibliographic coupling: how much a candidate's reference list overlaps the
 * anchor's local subset, rather than the whole paper's. Jaccard keeps a candidate with a
 * huge bibliography from looking close to everything.
 */
export function anchorBibliographicCoupling(
  anchorReferenceKeys: readonly string[],
  candidateReferenceKeys: readonly string[]
) {
  const anchorSet = new Set(anchorReferenceKeys.filter(Boolean));
  const candidateSet = new Set(candidateReferenceKeys.filter(Boolean));
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
