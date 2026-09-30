import { saveReference, listReferences, editReference, removeReference } from "../shared/library";
import { webUrl } from "../shared/references";
import type { CaptureOptions, CollectedPage, PageInfo, RpcResult, SavedItem, StoredFile } from "../shared/types";

declare const Zotero: any;
const pending = new Set<number>();
const MAX_FILE = 100 * 1024 * 1024;

export function isPanelSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  const base = chrome.runtime.getURL("");
  if (!sender.url.startsWith(base)) return false;
  return /^(panel|popup|sidebar|options)\.html(?:[?#]|$)/.test(sender.url.slice(base.length));
}

async function pageInfo(tabId: number): Promise<PageInfo> {
  if (!Number.isInteger(tabId)) throw new Error("请选择一个网页标签页。");
  const tab = await chrome.tabs.get(tabId);
  if (!webUrl(tab.url)) throw new Error("请在论文或普通网页中使用采集功能。");
  const info = Zotero.Connector_Browser.getTabInfo(tabId);
  return {
    tabId, title: tab.title || tab.url!, url: tab.url!,
    translators: (info.translators || []).map((t: any) => ({ label: t.label, itemType: t.itemType })),
    isPDF: !!info.isPDF || /\.pdf(?:[?#]|$)/i.test(tab.url!)
  };
}

async function binaryFile(url: string, mimeType: string): Promise<Blob> {
  if (!webUrl(url)) throw new Error("附件地址无效。");
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`附件下载失败（HTTP ${response.status}）`);
  if (Number(response.headers.get("content-length")) > MAX_FILE) throw new Error("附件超过 100 MiB。");
  if (!response.body) throw new Error("附件没有可读取的正文。");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE) throw new Error("附件超过 100 MiB。");
      chunks.push(new Uint8Array(value));
    }
  } catch (error) { await reader.cancel(); throw error; }
  const blob = new Blob(chunks, { type: mimeType });
  const header = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  if (mimeType === "application/pdf" && !new TextDecoder().decode(header).includes("%PDF-")) throw new Error("附件返回的不是 PDF，可能需要先登录网站。");
  if (mimeType === "application/epub+zip" && (header[0] !== 0x50 || header[1] !== 0x4b)) throw new Error("附件返回的不是 EPUB。");
  return blob;
}

async function capture(options: CaptureOptions): Promise<SavedItem[]> {
  if (pending.has(options.tabId)) throw new Error("此页面正在保存，请稍候。");
  if (typeof options.collection !== "string" || options.collection.length > 100 || !Array.isArray(options.tags)
      || options.tags.length > 30 || options.tags.some(t => typeof t !== "string" || t.length > 100)) throw new Error("分类或标签过长。");
  const page = await pageInfo(options.tabId);
  pending.add(options.tabId);
  await chrome.action.setBadgeText({ tabId: options.tabId, text: "…" });
  await chrome.storage.session.set({ [`liteasy:job:${options.tabId}`]: { status: "saving" } });
  try {
    const info = Zotero.Connector_Browser.getTabInfo(options.tabId);
    let collected: CollectedPage;
    if (page.isPDF && !info.translators?.length) {
      collected = { url: page.url, translator: "PDF", warnings: [], items: [{
        itemType: "document", title: page.title, url: page.url, creators: [],
        attachments: [{ url: page.url, title: "全文 PDF", mimeType: "application/pdf" }]
      }] };
    } else {
      const response: RpcResult<CollectedPage> = await chrome.tabs.sendMessage(options.tabId,
        { type: "LITEASY_COLLECT_PAGE", snapshot: options.snapshot }, { frameId: info.frameId || 0 });
      if (!response?.ok) throw new Error(response?.error || "页面脚本未就绪，请刷新网页后重试。");
      collected = response.data;
    }
    const saved: SavedItem[] = [];
    for (const item of collected.items) {
      const files: Omit<StoredFile, "itemId">[] = [];
      const warnings = [...collected.warnings];
      if (collected.snapshot && collected.items.length === 1) {
        const blob = new Blob([collected.snapshot], { type: "text/html" });
        files.push({ id: crypto.randomUUID(), title: "网页快照", url: collected.url, mimeType: blob.type, size: blob.size, blob });
      }
      if (options.attachments) {
        for (const attachment of (item.attachments || []).slice(0, 30)) {
          if (!attachment.url || !["application/pdf", "application/epub+zip"].includes(attachment.mimeType || "")) continue;
          try {
            const blob = await binaryFile(attachment.url, attachment.mimeType!);
            files.push({ id: crypto.randomUUID(), title: attachment.title || "附件", url: attachment.url, mimeType: blob.type, size: blob.size, blob });
          } catch (error) { warnings.push(`${attachment.title || "附件"}：${String((error as Error).message || error)}`); }
        }
      }
      saved.push(await saveReference({ item, sourceUrl: collected.url, translator: collected.translator,
        collection: options.collection.trim(), tags: options.tags, files, warnings }));
    }
    await chrome.storage.session.set({ [`liteasy:job:${options.tabId}`]: { status: "saved", count: saved.length, warnings: saved.flatMap(s => s.warnings) } });
    await chrome.action.setBadgeText({ tabId: options.tabId, text: "✓" });
    void chrome.runtime.sendMessage({ type: "LITEASY_LIBRARY_CHANGED" }).catch(() => {});
    return saved;
  } catch (error) {
    const message = String((error as Error).message || error);
    await chrome.storage.session.set({ [`liteasy:job:${options.tabId}`]: { status: "error", error: message } });
    await chrome.action.setBadgeText({ tabId: options.tabId, text: "!" });
    throw error;
  } finally { pending.delete(options.tabId); }
}

async function dispatch(message: any): Promise<unknown> {
  switch (message.type) {
    case "LITEASY_PAGE_INFO": return pageInfo(message.tabId);
    case "LITEASY_CAPTURE": return capture(message.options);
    case "LITEASY_LIST": return listReferences();
    case "LITEASY_EDIT": {
      if (typeof message.collection !== "string" || message.collection.length > 100 || !Array.isArray(message.tags)
          || message.tags.length > 30 || message.tags.some((t: unknown) => typeof t !== "string" || t.length > 100)) throw new Error("分类或标签过长。");
      return editReference(message.id, { collection: message.collection.trim() || "未分类", tags: message.tags });
    }
    case "LITEASY_REMOVE": return removeReference(message.id);
    default: throw new Error("未知请求。");
  }
}

const types = new Set(["LITEASY_PAGE_INFO", "LITEASY_CAPTURE", "LITEASY_LIST", "LITEASY_EDIT", "LITEASY_REMOVE"]);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!types.has(message?.type)) return;
  if (!isPanelSender(sender)) { respond({ ok: false, error: "仅允许扩展管理页面操作文献库。" }); return; }
  dispatch(message).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove(`liteasy:job:${id}`); });
void Zotero.initDeferred.promise.then(async () => {
  const session = await chrome.storage.session.get(null);
  for (const [key, job] of Object.entries(session)) {
    if (key.startsWith("liteasy:job:") && job?.status === "saving" && !pending.has(Number(key.split(":").at(-1)))) {
      await chrome.storage.session.set({ [key]: { status: "error", error: "上次保存被中断。已写入的文献仍在文献库中，可重试补齐附件。" } });
    }
  }
  await Zotero.Prefs.set("firstUse", false);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  const fromTab = (tab: chrome.tabs.Tab, snapshot = true) => capture({
    tabId: tab.id!, snapshot, attachments: true, collection: "", tags: []
  });
  Zotero.Connector_Browser.saveWithTranslator = (tab: chrome.tabs.Tab) => fromTab(tab);
  Zotero.Connector_Browser.saveAsWebpage = (tab: chrome.tabs.Tab, _frameId: number, options: { snapshot?: boolean } = {}) => fromTab(tab, options.snapshot !== false);
  // The upstream observer still detects translators and PDF frames. Its save
  // surfaces all route to Liteasy; no Zotero desktop/account writes are exposed.
  let menuQueue = Promise.resolve();
  Zotero.Connector_Browser._updateExtensionUI = (tab?: chrome.tabs.Tab) => {
    menuQueue = menuQueue.catch(() => {}).then(async () => {
      tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id || !tab.active) return;
      await chrome.action.setIcon({ tabId: tab.id, path: { 16: "Icon-32.png", 32: "Icon-32.png" } });
      await chrome.action.setTitle({ tabId: tab.id, title: "Liteasy Connector" });
      await chrome.contextMenus.removeAll();
      if (webUrl(tab.url)) {
        chrome.contextMenus.create({ id: "liteasy-save", title: "保存到 Liteasy（含快照与附件）", contexts: ["page", "action"] });
        chrome.contextMenus.create({ id: "liteasy-save-link", title: "保存到 Liteasy（不保存快照）", contexts: ["page", "action"] });
      }
      void chrome.runtime.sendMessage({ type: "LITEASY_PAGE_CHANGED", tabId: tab.id }).catch(() => {});
    });
    return menuQueue;
  };
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id && (info.menuItemId === "liteasy-save" || info.menuItemId === "liteasy-save-link")) {
      void fromTab(tab, info.menuItemId === "liteasy-save").catch(error => console.warn("Liteasy capture:", error.message));
    }
  });
  await Zotero.Connector_Browser._updateExtensionUI();
});
