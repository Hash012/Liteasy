import type { LiteratureCandidate } from "../paper-identity/literature.types";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";

let queue = Promise.resolve();
let lastRequest = 0;

export function readArxivMetadata(config: PaperServiceConfig, id: string): Promise<LiteratureCandidate | undefined> {
  const task = queue.then(async () => {
    // arXiv requests at least three seconds between sequential API calls.
    const delay = 3000 - (Date.now() - lastRequest);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequest = Date.now();
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("id_list", id);
    const response = await paperServiceRequest(config, url.href, { authenticate: false });
    if (!response.ok) throw new Error(`arXiv 元数据请求失败（HTTP ${response.status}）。`);
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("arXiv 元数据格式无效。");
    const atom = "http://www.w3.org/2005/Atom";
    for (const entry of Array.from(xml.getElementsByTagNameNS(atom, "entry"))) {
      const text = (tag: string) => entry.getElementsByTagNameNS(atom, tag)[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const resolvedId = normalizeLiteratureIdentifier("arxiv_id", text("id"));
      if ((/v\d+$/.test(id) ? resolvedId : resolvedId.replace(/v\d+$/, "")) !== id) continue;
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
    return undefined;
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}
