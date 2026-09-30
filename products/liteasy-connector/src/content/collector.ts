import { webUrl } from "../shared/references";
import type { CollectedPage, ReferenceItem } from "../shared/types";

// This adapter runs in the same isolated world as the pinned upstream scripts.
// Translation stays in Zotero's MV3 sandbox; no translator eval is added here.
declare const Zotero: any;

// MV3 keeps one translator instance per frame. Automatic detection and a save
// requested immediately after navigation must not reset that same instance.
let translationQueue: Promise<unknown> = Promise.resolve();
function serializeTranslation<T>(work: () => Promise<T>): Promise<T> {
  const next = translationQueue.then(work, work);
  translationQueue = next.catch(() => {});
  return next;
}
const detectPage = Zotero.PageSaving.onPageLoad.bind(Zotero.PageSaving);
Zotero.PageSaving.onPageLoad = (force?: boolean) => serializeTranslation(() => detectPage(force));

function genericItem(): ReferenceItem {
  const values = (names: string[]) => names.flatMap(name => Array.from(document.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"],meta[property="${name}"]`)).map(m => m.content.trim()).filter(Boolean));
  const first = (...names: string[]) => values(names)[0] || "";
  const title = first("citation_title", "DC.title", "og:title") || document.title || location.href;
  const doi = first("citation_doi", "DC.identifier").replace(/^doi:/i, "");
  const pdf = webUrl(first("citation_pdf_url"));
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return {
    itemType: doi || first("citation_journal_title") ? "journalArticle" : "webpage",
    title, url: webUrl(canonical) || location.href, DOI: doi,
    date: first("citation_publication_date", "citation_date", "DC.date"),
    publicationTitle: first("citation_journal_title"),
    volume: first("citation_volume"), issue: first("citation_issue"),
    abstractNote: first("citation_abstract", "description", "og:description"),
    creators: values(["citation_author", "DC.creator"]).map(name => ({ name, creatorType: "author" })),
    attachments: pdf ? [{ title: "全文 PDF", url: pdf, mimeType: "application/pdf" }] : []
  };
}

function deadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  })]).finally(() => clearTimeout(timeout));
}

async function collect(snapshot: boolean): Promise<CollectedPage> {
  const warnings: string[] = [];
  let items: ReferenceItem[] = [];
  let translator = "网页元数据";
  let translators: any[] = [];
  let cancelled = false;
  try {
    await deadline(Zotero.initDeferred.promise, 15000, "站点识别尚未就绪");
    translators = Zotero.PageSaving.translators || [];
    if (!translators.length) {
      await deadline(detectPage(), 15000, "站点识别尚未就绪");
      translators = Zotero.PageSaving.translators || [];
    }
    if (translators.length) {
      const translate = await Zotero.PageSaving._initTranslate(translators[0].itemType);
      translator = translators[0].label;
      const result = await Zotero.TranslateWeb.translate({
        translate, translators: translators.slice(),
        onTranslatorFallback: (_old: unknown, next: { label: string }) => { translator = next.label; },
        onSelect: (_object: unknown, choices: Record<string, string>, callback: (choices: unknown) => void) => {
          // Reuse the upstream multiple-item selector and its cancellation semantics.
          void Zotero.Connector_Browser.onSelect(choices).then((selected: Record<string, unknown> | false) => {
            cancelled = !selected || Object.keys(selected).length === 0;
            callback(selected);
          }, () => { cancelled = true; callback({}); });
        }
      });
      items = result.items;
      if (!items.length) { cancelled = true; throw new Error("已取消采集，未保存条目。"); }
    }
  } catch (error) {
    const message = String((error as Error).message || error);
    if (cancelled) throw new Error("已取消采集，未保存条目。");
    if (translators[0]?.itemType === "multiple") throw error;
    warnings.push(`站点识别未完成，已使用页面元数据：${message}`);
    translator = "网页元数据";
  }
  if (!items.length) items = [genericItem()];
  const result: CollectedPage = { items, url: location.href, translator, warnings };
  if (snapshot && items.length === 1 && translators[0]?.itemType !== "multiple") {
    try {
      const html: string = await deadline(Zotero.SingleFile.retrievePageData(), 45000, "网页快照生成超时");
      if (new Blob([html]).size > 25 * 1024 * 1024) throw new Error("网页快照超过 25 MiB");
      result.snapshot = html;
    } catch (error) { warnings.push(`HTML 快照未生成：${String((error as Error).message || error)}`); }
  } else if (snapshot) {
    warnings.push("批量采集保留各条文献与附件；搜索结果页不会作为论文快照保存。");
  }
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "LITEASY_COLLECT_PAGE") return;
  serializeTranslation(() => collect(message.snapshot === true)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
