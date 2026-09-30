import { test } from "node:test";
import assert from "node:assert/strict";
import { bibtex, fileName, identity, normalizeItem, ris, webUrl } from "../src/shared/references";
import type { ReferenceItem } from "../src/shared/types";

const article: ReferenceItem = { itemType: "journalArticle", title: "Learning & research {notes}",
  url: "https://example.org/paper?q=one#section", DOI: "https://doi.org/10.1234/ABC", creators: [{ firstName: "Ada", lastName: "Lovelace" }], date: "2024-06-01", publicationTitle: "Research" };

test("DOI identity deduplicates publisher and repository copies", () => {
  assert.equal(identity(article), "doi:10.1234/abc");
  assert.equal(identity({ ...article, DOI: " DOI: 10.1234/abc " }), identity(article));
  assert.equal(identity({ ...article, DOI: "", url: "https://example.org/paper?q=two#x" }), "url:https://example.org/paper?q=two");
});
test("normalize translator output preserves bibliography and rejects executable URLs", () => {
  assert.equal(normalizeItem(article, article.url).publicationTitle, "Research");
  const item = normalizeItem({ ...article, url: "javascript:alert(1)", attachments: [{ url: "javascript:alert(1)" }, { url: "https://example.org/a.pdf" }] }, "https://example.org/paper");
  assert.equal(item.url, "https://example.org/paper");
  assert.equal(item.attachments?.length, 1);
  assert.equal(webUrl("https://user:password@example.org/"), "");
  assert.equal(webUrl("file:///etc/passwd"), "");
});
test("BibTeX and RIS preserve authors, dates, DOI and escape field delimiters", () => {
  assert.match(bibtex([article]), /author = \{Lovelace, Ada\}/);
  assert.ok(bibtex([article]).includes("Learning \\& research \\{notes\\}"));
  assert.match(bibtex([article]), /year = \{2024\}/);
  assert.match(ris([article]), /TY  - JOUR\nTI  - Learning/);
  assert.match(ris([article]), /AU  - Lovelace, Ada/);
  assert.ok(!ris([{ ...article, title: "title\nER  - \nTY  - BOOK" }]).includes("\nTY  - BOOK"));
  assert.equal(fileName("../bad/name?.html"), ".._bad_name_.html");
});
