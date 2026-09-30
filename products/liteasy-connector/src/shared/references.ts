import type { ReferenceItem } from "./types";

export function webUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function identity(item: ReferenceItem): string {
  const doi = String(item.DOI || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) return `doi:${doi}`;
  const url = new URL(item.url);
  url.hash = "";
  return `url:${url.href}`;
}

export function normalizeItem(raw: ReferenceItem, sourceUrl: string): ReferenceItem {
  const url = webUrl(raw.url) || webUrl(sourceUrl);
  if (!url || !raw || typeof raw.title !== "string" || !raw.title.trim()) throw new Error("文献缺少有效标题或网页地址。");
  // Preserve translator-specific bibliography fields without DOM nodes or executable values.
  const item = JSON.parse(JSON.stringify(raw)) as ReferenceItem;
  return {
    ...item,
    title: raw.title.trim().slice(0, 4000),
    itemType: typeof raw.itemType === "string" ? raw.itemType : "webpage",
    url,
    creators: Array.isArray(item.creators) ? item.creators : [],
    attachments: (Array.isArray(item.attachments) ? item.attachments : []).filter(a => webUrl(a.url)).slice(0, 30)
  };
}

export function fileName(value: string): string {
  return value.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "").slice(0, 90) || "reference";
}

const author = (c: ReferenceItem["creators"][number]) => c.name || [c.lastName, c.firstName].filter(Boolean).join(", ");
const tex = (value: unknown) => String(value ?? "").replace(/[\\{}%&#_$~^]/g, m => ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[m] || `\\${m}`).replace(/[\r\n]+/g, " ");

export function bibtex(items: ReferenceItem[]): string {
  return items.map((item, i) => {
    const year = String(item.date || "").match(/\d{4}/)?.[0] || "";
    const type = item.itemType === "journalArticle" ? "article" : item.itemType === "book" ? "book" : item.itemType === "conferencePaper" ? "inproceedings" : "misc";
    const fields = {
      title: item.title, author: item.creators.map(author).join(" and "), year,
      journal: item.publicationTitle, volume: item.volume, number: item.issue,
      pages: item.pages, doi: item.DOI, isbn: item.ISBN, url: item.url, abstract: item.abstractNote
    };
    return `@${type}{liteasy${i + 1},\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${tex(v)}}`).join(",\n")}\n}`;
  }).join("\n\n") + "\n";
}

export function ris(items: ReferenceItem[]): string {
  const line = (key: string, value: unknown) => value ? `${key}  - ${String(value).replace(/[\r\n]+/g, " ")}\n` : "";
  return items.map(item => line("TY", item.itemType === "journalArticle" ? "JOUR" : item.itemType === "book" ? "BOOK" : "GEN")
    + line("TI", item.title) + item.creators.map(c => line("AU", author(c))).join("")
    + line("PY", item.date) + line("JO", item.publicationTitle) + line("VL", item.volume)
    + line("IS", item.issue) + line("SP", item.pages) + line("DO", item.DOI)
    + line("SN", item.ISBN || item.ISSN) + line("UR", item.url) + line("AB", item.abstractNote) + "ER  - \n").join("\n");
}
