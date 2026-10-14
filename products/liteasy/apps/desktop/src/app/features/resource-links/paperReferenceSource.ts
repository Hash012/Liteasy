export type PaperReferenceSource = {
  paperId: string;
  documentHash?: string;
  pages: Array<{ page: number; text: string; start: number; end: number }>;
};
/** Offsets describe the displayed, cached extraction only; they are not PDF text-layer coordinates. */
export function paperReferenceText(input: { paperId: string; documentHash?: string; notice: string; pages: Array<{ page: number; text: string }> }) {
  let text = `${input.notice}\n\n`;
  const pages = input.pages.map((entry, index) => {
    if (index) text += "\n\n";
    text += `第 ${entry.page} 页\n`;
    const start = text.length, body = entry.text.replace(/\r\n?/g, "\n");
    text += body;
    return { page: entry.page, text: body, start, end: text.length };
  });
  return { text, source: { paperId: input.paperId, documentHash: input.documentHash, pages } satisfies PaperReferenceSource };
}
