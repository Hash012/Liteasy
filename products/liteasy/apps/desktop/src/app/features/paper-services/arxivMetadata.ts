import type { LiteratureCandidate } from "../paper-identity/literature.types";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";

let queue = Promise.resolve();
let lastRequest = 0;

function matchesArxivId(resolved: string, requested: string) {
  return Boolean(resolved) && (/v\d+$/.test(requested) ? resolved === requested : resolved.replace(/v\d+$/, "") === requested);
}

async function readArxivPageMetadata(config: PaperServiceConfig, id: string): Promise<LiteratureCandidate | undefined> {
  const url = `https://arxiv.org/abs/${id}`;
  const response = await paperServiceRequest(config, url, { authenticate: false });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`arXiv 题录页面请求失败（HTTP ${response.status}）。`);
  const page = new DOMParser().parseFromString(await response.text(), "text/html");
  const meta = (name: string) => page.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? "";
  const pageId = normalizeLiteratureIdentifier("arxiv_id", page.querySelector('meta[property="og:url"]')?.getAttribute("content") ??
    page.title.match(/^\[([^\]]+)\]/)?.[1] ?? "");
  const citationId = normalizeLiteratureIdentifier("arxiv_id", meta("citation_arxiv_id"));
  // The unversioned canonical/citation URL alone cannot verify a requested PDF version.
  if (!matchesArxivId(pageId, id) || citationId.replace(/v\d+$/, "") !== pageId.replace(/v\d+$/, "")) return undefined;
  const title = meta("citation_title");
  const authors = Array.from(page.querySelectorAll('meta[name="citation_author"]')).map((author) => {
    const name = author.getAttribute("content")?.trim() ?? "";
    const parts = name.split(",");
    return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : name;
  }).filter(Boolean);
  if (!title || !authors.length) return undefined;
  const year = Number(meta("citation_date").slice(0, 4));
  return {
    candidateKey: `arxiv:${pageId}`, provider: "arxiv", recordUrl: url,
    record: { title, authors, ...(year > 0 ? { year } : {}),
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: pageId }] }
  };
}

export function readArxivMetadata(config: PaperServiceConfig, id: string): Promise<LiteratureCandidate | undefined> {
  const task = queue.then(async () => {
    // arXiv requests at least three seconds between sequential API calls.
    const delay = 3000 - (Date.now() - lastRequest);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequest = Date.now();
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("id_list", id);
    let xml: Document;
    try {
      const response = await paperServiceRequest(config, url.href, { authenticate: false });
      if (!response.ok) throw new Error(`arXiv 元数据请求失败（HTTP ${response.status}）。`);
      xml = new DOMParser().parseFromString(await response.text(), "application/xml");
      if (xml.querySelector("parsererror")) throw new Error("arXiv 元数据格式无效。");
    } catch (error) {
      // The public Atom endpoint is often rate limited; the same version's official
      // abstract page supplies citation metadata without substituting a published edition.
      const fallback = await readArxivPageMetadata(config, id);
      if (fallback) return fallback;
      throw error;
    }
    const atom = "http://www.w3.org/2005/Atom";
    for (const entry of Array.from(xml.getElementsByTagNameNS(atom, "entry"))) {
      const text = (tag: string) => entry.getElementsByTagNameNS(atom, tag)[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const resolvedId = normalizeLiteratureIdentifier("arxiv_id", text("id"));
      if (!matchesArxivId(resolvedId, id)) continue;
      const title = text("title");
      if (!title) continue;
      const year = Number(text("published").slice(0, 4));
      return {
        candidateKey: `arxiv:${resolvedId}`, provider: "arxiv", recordUrl: text("id"),
        record: {
          title, authors: Array.from(entry.getElementsByTagNameNS(atom, "author"))
            .map((author) => author.getElementsByTagNameNS(atom, "name")[0]?.textContent?.trim() ?? "").filter(Boolean),
          ...(year > 0 ? { year } : {}),
          identifiers: [{ kind: "arxiv_id", source: "public_registry", value: resolvedId }]
        }
      } satisfies LiteratureCandidate;
    }
    return readArxivPageMetadata(config, id);
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}
