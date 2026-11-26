import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./cliError.mjs";

export function zoteroSnapshot(bytes, values) {
  let bodyMarkdown;
  try { bodyMarkdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new CliError("zotero_utf8_invalid", "Markdown 笔记必须采用 UTF-8 编码。", 2); }
  if (!bodyMarkdown.trim() || Array.from(bodyMarkdown).length > 12000 || bytes.length > 128 * 1024) {
    throw new CliError("zotero_note_size_invalid", "请选择不超过 12000 字的非空 Markdown 笔记；较长资料请另存资产。", 2);
  }
  if (!values["library-origin"] || values["library-origin"].length > 512) throw new CliError("zotero_origin_required", "请提供 --library-origin 区分本机实例与 Web library。", 2);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const links = [...new Set(bodyMarkdown.match(/zotero:\/\/[^\s)"<>]+/g) ?? [])].slice(0, 19);
  const source = { provider: "zotero", origin: values["library-origin"], contentHash, availability: "local_only",
    ...(values["note-id"] ? { sourceId: values["note-id"] } : {}), ...(values.locator ? { locator: values.locator } : {}) };
  return { scopeKey: values.scope?.[0] ?? "personal", kind: "reference",
    title: values.title ?? bodyMarkdown.match(/^#\s+(.+)$/m)?.[1]?.slice(0, 160) ?? path.basename(values.file, ".md").slice(0, 160),
    bodyMarkdown, basis: "imported", tags: ["zotero-md", contentHash], sourceRefs: [source, ...links.map((locator) => {
      const item = /^zotero:\/\/(?:select|open-pdf)\/((?:library|groups\/[0-9]+)\/items\/[A-Z0-9]{8})(?:[/?#]|$)/i.exec(locator)?.[1];
      return { provider: "zotero", origin: source.origin, locator, ...(item ? { sourceId: item, title: "文献/PDF 回链" } : {}), availability: "local_only" };
    })],
    attributes: { snapshot: true, noteIdentity: values["note-id"] ? "provided" : "unknown" } };
}
export async function importZoteroMarkdown({ client, values, submit }) {
  if (values.scope?.length > 1) throw new CliError("scope_invalid", "一份快照只能选择一个归组。", 2);
  if (!values.file || !/\.md$/i.test(values.file)) throw new CliError("zotero_file_required", "请用 --file 选择一份 Zotero Markdown 导出笔记。", 2);
  let bytes;
  try { bytes = await readFile(values.file); } catch { throw new CliError("zotero_file_unavailable", "无法读取 Markdown 笔记。", 2); }
  const entry = zoteroSnapshot(bytes, values);
  if (values["entry-id"]) {
    const expectedRevision = Number(values["expected-revision"]);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new CliError("revision_required", "更新快照需要 --expected-revision。", 2);
    return submit({ schemaVersion: "liteasy.context-write/v1", operationId: randomUUID(), action: "update", entryId: values["entry-id"], expectedRevision, entry });
  }
  const matches = await Promise.all(["active", "draft", "archived"].map((status) => client.list({ scopes: [entry.scopeKey], kinds: ["reference"], tags: entry.tags, status, limit: 100 })));
  const existing = matches.flatMap((page) => page.entries).find((item) => item.sourceRefs.some((source) => source.origin === entry.sourceRefs[0].origin && source.contentHash === entry.sourceRefs[0].contentHash && source.sourceId === entry.sourceRefs[0].sourceId));
  if (existing) return { duplicate: true, entryId: existing.id, revision: existing.revision };
  // Paper/PDF back-links never supply the note's identity. Changed unknown notes create new snapshots.
  const hex = createHash("sha256").update(JSON.stringify([entry.scopeKey, entry.sourceRefs[0].origin, entry.sourceRefs[0].sourceId ?? null, entry.sourceRefs[0].contentHash])).digest("hex");
  const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  // The entry's server-createdAt records import time; no unknown export/source timestamp is invented.
  return submit({ schemaVersion: "liteasy.context-write/v1", operationId, action: "create", entry });
}
