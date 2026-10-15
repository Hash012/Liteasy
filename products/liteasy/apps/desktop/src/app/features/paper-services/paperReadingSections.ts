import { pdfDescriptiveMetadata } from "./bibliographicMetadata";

export type PaperReadingSections = { abstract?: string; introduction?: string; introductionTruncated?: boolean };
const introHeading = /^(?:(?:\d+|[IVX]+)[.\s:：-]*)?(?:introduction|引言|绪论|绪言)$/i;
const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** Parse inert source documents; never insert publisher HTML into the application. */
export function parsePaperReadingSections(document: Document): PaperReadingSections {
  document.querySelectorAll("script, style, nav, footer, aside, ref-list, back, .ltx_bibliography, .ltx_note").forEach(node => node.remove());
  const abstract = clean(document.querySelector("abstract, .ltx_abstract, blockquote.abstract, section.abstract")?.textContent)
    .replace(/^Abstract\s*[:：]?\s*/i, "");
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,title,head")];
  let introduction = "";
  for (const heading of headings) {
    if (!introHeading.test(clean(heading.textContent))) continue;
    const section = heading.closest("sec, section, div.ltx_section, div[type='introduction']");
    if (section) {
      const copy = section.cloneNode(true) as Element;
      copy.querySelector("h1,h2,h3,h4,title,head")?.remove();
      introduction = clean(copy.textContent);
    } else {
      const parts: string[] = [];
      for (let node = heading.nextElementSibling; node && !/^(H[1-4]|TITLE|HEAD)$/.test(node.tagName.toUpperCase()); node = node.nextElementSibling) parts.push(node.textContent ?? "");
      introduction = clean(parts.join(" "));
    }
    if (introduction.length >= 80) break;
  }
  return { ...(abstract.length >= 40 ? { abstract } : {}), ...(introduction.length >= 80 ? { introduction } : {}) };
}

/** Only an explicit heading is evidence of an introduction, not the first PDF page. */
export function parsePdfReadingSections(text: string): PaperReadingSections {
  const start = /(?:^|\n)\s*(?:(?:1|I)[.\s]+)?(?:Introduction|引言|绪论|绪言)\s*\n/i.exec(text);
  if (!start) return pdfDescriptiveMetadata(text);
  const remaining = text.slice(start.index + start[0].length);
  const end = /\n\s*(?:(?:[2-9]|II|III|IV|V)[.)]?\s+[^\n]{2,100}|(?:Related Work|Background|Methods?|Materials and Methods|Results|References|相关工作|背景|方法|实验|参考文献))\s*\n/i.exec(remaining);
  const introduction = clean(remaining.slice(0, end?.index));
  return { ...pdfDescriptiveMetadata(text), ...(introduction.length >= 80 ? { introduction, introductionTruncated: !end } : {}) };
}
