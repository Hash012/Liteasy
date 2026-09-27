export type ReadingBlock = { key: string; text: string; element: HTMLElement; level: number; page?: string };
export type ReadingLocation = { key: string; offset: number; ratio: number; view: string };
export type ReadingBookmark = { id: string; label: string; location: ReadingLocation };
export type ReadingHistory = { positions: Record<string, ReadingLocation>; bookmarks: ReadingBookmark[] };

export function readReadingHistory(key: string): ReadingHistory {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    const positions: Record<string, ReadingLocation> = {};
    for (const [view, position] of Object.entries(value?.positions ?? {})) {
      if (validLocation(position) && position.view === view) Object.defineProperty(positions, view, { value: position, enumerable: true, writable: true, configurable: true });
    }
    const bookmarks = Array.isArray(value?.bookmarks) ? value.bookmarks.filter((item: ReadingBookmark) => (
      item && typeof item.id === "string" && typeof item.label === "string" && validLocation(item.location)
    )).slice(0, 200) : [];
    return { positions, bookmarks };
  } catch { return { positions: {}, bookmarks: [] }; }
}

function validLocation(value: unknown): value is ReadingLocation {
  const item = value as Partial<ReadingLocation> | null;
  return Boolean(item && typeof item.key === "string" && typeof item.view === "string" && Number.isFinite(item.offset)
    && item.offset! >= 0 && item.offset! <= 1 && Number.isFinite(item.ratio) && item.ratio! >= 0 && item.ratio! <= 1);
}

function textKey(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

/** Index one displayed language, never duplicate the source/translation comparison. */
export function indexReadingContent(root: HTMLElement) {
  const pane = root.querySelector<HTMLElement>('.paper-resource-tab__reading-pane[aria-label="原文"]')
    ?? root.querySelector<HTMLElement>(".paper-resource-tab__reading-pane");
  const container = pane ?? root;
  const scroller = pane ?? root.querySelector<HTMLElement>(".paper-resource-tab");
  const view = pane?.getAttribute("aria-label") ?? "原文";
  const seen = new Map<string, number>();
  const blocks: ReadingBlock[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(".mineru-markdown :is(h1, h2, h3, h4, h5, h6, p, li, pre, td, th, figcaption)")) {
    if (element.querySelector("p, li, pre") || element.closest(".katex-mathml")) continue;
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const hash = textKey(text);
    const occurrence = seen.get(hash) ?? 0;
    seen.set(hash, occurrence + 1);
    blocks.push({ key: `${hash}-${occurrence}`, text, element, level: /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : 0,
      page: element.closest<HTMLElement>("[data-reading-page]")?.dataset.readingPage });
  }
  return { blocks, scroller, view };
}

export function readingLocation(blocks: ReadingBlock[], scroller: HTMLElement, view: string): ReadingLocation {
  const top = scroller.getBoundingClientRect().top + 16;
  const block = blocks.find((item) => item.element.getBoundingClientRect().bottom > top) ?? blocks[blocks.length - 1];
  const rect = block?.element.getBoundingClientRect();
  return { key: block?.key ?? "", view,
    offset: rect ? Math.min(1, Math.max(0, (top - rect.top) / Math.max(1, rect.height))) : 0,
    ratio: Math.min(1, Math.max(0, scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight))) };
}

export function restoreReadingLocation(location: ReadingLocation, blocks: ReadingBlock[], scroller: HTMLElement) {
  const block = blocks.find((item) => item.key === location.key);
  if (block) {
    const rect = block.element.getBoundingClientRect();
    scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - 16 + rect.height * location.offset;
  } else scroller.scrollTop = location.ratio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

export function findReadingBlocks(blocks: ReadingBlock[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return blocks.flatMap((block) => {
    const index = block.text.toLocaleLowerCase().indexOf(needle);
    if (index < 0) return [];
    const start = Math.max(0, index - 28);
    return [{ block, before: `${start ? "…" : ""}${block.text.slice(start, index)}`, match: block.text.slice(index, index + needle.length),
      after: `${block.text.slice(index + needle.length, index + needle.length + 72)}${index + needle.length + 72 < block.text.length ? "…" : ""}` }];
  }).slice(0, 100);
}

/** A rough mixed Chinese/English reading estimate, not a measure of comprehension. */
export function readingMinutes(blocks: ReadingBlock[]) {
  const text = blocks.map((item) => item.text).join(" ");
  const chinese = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words = text.replace(/[\u3400-\u9fff]/g, " ").match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return chinese / 300 + words / 220;
}
