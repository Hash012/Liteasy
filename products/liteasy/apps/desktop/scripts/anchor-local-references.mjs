/**
 * Turns a real PDF into anchor-level local reference subsets.
 *
 * Two modes.
 *
 *   node scripts/anchor-local-references.mjs <pdf> "锚点短语" ["另一个短语" ...]
 *
 * Prints what the dimension reduction produces, for reading by eye. Compare it against the
 * paper-level citation neighbourhood, which hands every anchor the whole bibliography.
 *
 *   node scripts/anchor-local-references.mjs --apply scripts/retrieval-gate-anchors.json
 *
 * Fills `anchorReferences` into every gate anchor that declares `anchorPdf` + `anchorPhrase`,
 * so the sample fixture is generated from a real document rather than hand-written. PDFs are
 * read from `scripts/gate-pdfs/` and are deliberately not committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatePdfDirectory = path.join(scriptDir, "gate-pdfs");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const {
  attributeReferencesToAnchor,
  findReferenceSectionStart,
  parseNumberedReferences,
  parseNumericCitationMarkers
} = await import("../src/app/features/pdf/citationAttribution.ts");

async function extractPages(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const document = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : " "))
      .join("");
    pages.push({ page: number, text });
  }
  return pages;
}

async function readDocument(pdfPath) {
  const pages = await extractPages(pdfPath);
  const sectionStart = findReferenceSectionStart(pages);
  return {
    markers: parseNumericCitationMarkers(pages, sectionStart),
    pages,
    references: parseNumberedReferences(pages, sectionStart),
    sectionStart
  };
}

/**
 * Every reference cited next to any occurrence of the phrase, merged. One mention rarely
 * carries the whole subset, and the anchor is the concept rather than a single sentence.
 */
function localReferencesForPhrase(document, phrase) {
  const lowered = phrase.toLowerCase();
  const merged = new Map();
  let occurrences = 0;
  let withCitation = 0;

  for (const page of document.pages) {
    const haystack = page.text.toLowerCase();
    let index = haystack.indexOf(lowered);
    while (index >= 0) {
      occurrences += 1;
      const attributed = attributeReferencesToAnchor(
        {
          confidence: 1,
          id: phrase,
          kind: "concept",
          page: page.page,
          sourceEnd: index + phrase.length,
          sourceStart: index,
          sourceText: phrase
        },
        document.markers,
        { pageText: page.text, references: document.references }
      );
      if (attributed.references.length > 0) {
        withCitation += 1;
        for (const reference of attributed.references) {
          if (!merged.has(reference.number)) {
            merged.set(reference.number, reference);
          }
        }
      }
      index = haystack.indexOf(lowered, index + 1);
    }
  }

  return {
    occurrences,
    references: [...merged.values()].sort((left, right) => left.number - right.number),
    withCitation
  };
}

async function runReport(pdfPath, phrases) {
  const document = await readDocument(pdfPath);
  process.stdout.write(
    `${pdfPath}\n页数 ${document.pages.length}　正文引用标记 ${document.markers.length} 处　` +
      `参考文献 ${document.references.length} 条　参考文献区起始：` +
      `${document.sectionStart ? `第 ${document.sectionStart.page} 页` : "未找到"}\n\n`
  );

  for (const phrase of phrases) {
    const found = localReferencesForPhrase(document, phrase);
    process.stdout.write(
      `【${phrase}】 出现 ${found.occurrences} 次，其中 ${found.withCitation} 次所在句子带引用\n`
    );
    if (found.references.length === 0) {
      process.stdout.write("  局部参考集为空——这个锚点旁边没有引用。\n\n");
      continue;
    }
    for (const reference of found.references) {
      process.stdout.write(
        `  [${reference.number}] ${(reference.text || "(未解析出条目)").slice(0, 96)}\n`
      );
    }
    process.stdout.write("\n");
  }
}

async function runApply(anchorsPath) {
  const definition = JSON.parse(readFileSync(anchorsPath, "utf8"));
  const anchors = Array.isArray(definition?.anchors) ? definition.anchors : [];
  const documents = new Map();
  let filled = 0;

  for (const anchor of anchors) {
    if (!anchor?.anchorPdf || !anchor?.anchorPhrase) {
      continue;
    }
    const pdfPath = path.join(gatePdfDirectory, anchor.anchorPdf);
    if (!documents.has(anchor.anchorPdf)) {
      documents.set(anchor.anchorPdf, await readDocument(pdfPath));
    }
    const found = localReferencesForPhrase(documents.get(anchor.anchorPdf), anchor.anchorPhrase);
    // Only the number and the printed entry travel to retrieval. The evidence string is for
    // the reader in the app, not for matching.
    anchor.anchorReferences = found.references.map((reference) => ({
      number: reference.number,
      text: reference.text
    }));
    filled += 1;
    process.stdout.write(
      `${anchor.anchorId}：${anchor.anchorReferences.length} 条局部参考文献` +
        `（「${anchor.anchorPhrase}」出现 ${found.occurrences} 次，${found.withCitation} 次带引用）\n`
    );
  }

  if (filled === 0) {
    process.stderr.write(
      `${anchorsPath} 里没有任何锚点声明了 anchorPdf 与 anchorPhrase，没有可填的内容。\n`
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(anchorsPath, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  process.stdout.write(`\n已写回 ${anchorsPath}，填充 ${filled} 个锚点。\n`);
}

const [, , first, ...rest] = process.argv;
if (first === "--apply") {
  const anchorsPath = rest[0] || path.join(scriptDir, "retrieval-gate-anchors.json");
  await runApply(anchorsPath);
} else if (first && rest.length > 0) {
  await runReport(first, rest);
} else {
  process.stderr.write(
    '用法：node scripts/anchor-local-references.mjs <pdf> "锚点短语" [...]\n' +
      "　　　node scripts/anchor-local-references.mjs --apply [anchors.json]\n"
  );
  process.exit(1);
}
