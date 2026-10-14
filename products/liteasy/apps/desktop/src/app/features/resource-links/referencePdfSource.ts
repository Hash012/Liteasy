import type { ObjectRepository } from "../objects/objectRepository";
import type { ObjectEnvelope, ObjectRef } from "../objects/object.types";
import type { ObjectAnchor } from "../objects/objectAnchor.types";
import { collectPaperAnchors } from "../paper-anchors/paperAnchorEntity";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import type { Paper } from "../workspace/workspace.types";
import { splitReference } from "./referenceText";

export type PreviewViewport = { page?: number; zoom?: number; scrollLeft?: number; scrollTop?: number };
export type PdfSourceMember = { scopeId: string; resourcePath: string; paperId: string; page: number };
export type PdfPreviewIntent = "asset" | "origin";
export type PdfSourceTarget = {
  documentKey: string; page: number; precision: "document" | "page" | "region";
  region?: { coordinateSpace: "normalized-viewport"; rects: Extract<ObjectAnchor, { type: "pdf" }>["rects"] };
};
export type ReferencePdf = { bytes: Uint8Array; path: string; page: number; documentKey?: string; target?: PdfSourceTarget };
const validPage = (page: number) => {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("来源页码无效，请重新选择来源或打开整篇文献。");
  return page;
};
function uniquePage(pages: number[]) {
  const unique = [...new Set(pages.map(validPage))];
  if (unique.length > 1) throw new Error("这条来源对应多个页码，请选择具体来源位置。");
  return unique[0];
}

/** Asset preview never follows a derived note's ancestors; origin is an explicit action. */
export async function resolveReferencePdf(input: {
  path: string; repository: ObjectRepository; papers: readonly Paper[]; signal?: AbortSignal; intent?: PdfPreviewIntent; member?: PdfSourceMember;
}): Promise<{ paper: Paper; path: string; page: number; target: PdfSourceTarget } | undefined> {
  const { target: locator, fragment } = splitReference(input.path);
  let target;
  try { target = parseLiteasyPath(locator, input.repository.scopeId); }
  catch (error) {
    if (!/^liteasy:\/\/(papers|objects|paper-annotations)\//.test(locator)) return undefined;
    throw error;
  }
  const selector = fragment || (target.kind === "object" ? target.ref.selectorId ?? "" : "");
  const pageSelector = /^(?:page[=:](.*)|p\.?(-?\d+|NaN))$/.exec(selector);
  const explicitPage = pageSelector ? validPage(Number(pageSelector[1] ?? pageSelector[2])) : undefined;
  let page = explicitPage, paperId: string | undefined, documentHash: string | undefined;
  let region: PdfSourceTarget["region"], requiresLocation = input.intent === "origin";
  const visited = new Set<string>();
  const hashes = new Set<string>();
  function hash(value?: string) { if (value) hashes.add(value); }
  async function source(object: ObjectEnvelope, depth = 0): Promise<void> {
    input.signal?.throwIfAborted();
    if (depth > 4 || visited.has(object.objectId)) throw new Error("来源引用存在循环，请重新选择来源。");
    visited.add(object.objectId);
    if (!["source.document", "content.fragment"].includes(object.kind) && input.intent !== "origin") return;
    const anchors = collectPaperAnchors(object.paperAnchors ?? []);
    const anchorPapers = [...new Set(anchors.map(anchor => anchor.source.paperId))];
    if (object.kind === "source.document") {
      paperId = object.content.payload.paperId;
      documentHash = object.content.payload.documentHash; hash(documentHash);
      if (anchorPapers.some(id => id !== paperId)) throw new Error("来源文献信息冲突，请重新选择来源。");
      requiresLocation ||= anchors.length > 0 || object.content.payload.pages?.length === 1;
    } else if (object.kind === "content.fragment") {
      requiresLocation = true;
      const pdfAnchors = object.content.payload.anchors.filter(anchor => anchor.type === "pdf");
      const refs = [...new Map(pdfAnchors.map(anchor => [JSON.stringify(anchor.sourceRef), anchor.sourceRef])).values()];
      if (refs.length > 1) throw new Error("这条摘录来自多个文档，请选择具体来源。");
      if (pdfAnchors.length) {
        for (const anchor of pdfAnchors) hash(anchor.documentHash);
        page ??= uniquePage(pdfAnchors.map(anchor => anchor.page));
        const matching = pdfAnchors.filter(anchor => anchor.page === page);
        const rects = matching.flatMap(anchor => anchor.rects);
        if (rects.length) region = { coordinateSpace: "normalized-viewport", rects };
        await source(await input.repository.get(refs[0] as ObjectRef), depth + 1);
      }
    }
    if (anchorPapers.length > 1) throw new Error("这条资产有多个来源文献，请选择具体来源。");
    paperId ??= anchorPapers[0];
    for (const anchor of anchors) {
      hash(anchor.source.documentHash);
      if (anchor.source.selector?.type === "pdf") {
        hash(anchor.source.selector.documentHash);
        if (anchor.locator.page && anchor.source.selector.page !== anchor.locator.page) throw new Error("来源定位信息冲突，请重新选择来源。");
      }
    }
    page ??= uniquePage(anchors.flatMap(anchor => anchor.locator.page === undefined ? [] : [anchor.locator.page]));
    const rects = anchors.filter(anchor => anchor.locator.page === page).flatMap(anchor => anchor.source.selector?.type === "pdf" ? anchor.source.selector.rects : []);
    if (rects.length && !region) region = { coordinateSpace: "normalized-viewport", rects };
    if (object.kind === "source.document" && page === undefined && requiresLocation) {
      page = uniquePage(object.content.payload.pages?.map(value => value.page) ?? []);
    }
  }
  if (target.kind === "paper" || target.kind === "pdf-annotation") {
    paperId = target.paperId;
    requiresLocation = target.kind === "pdf-annotation";
  } else if (target.kind === "object") await source(target.followLatest
    ? await input.repository.resolveLatest(target.ref.objectId) : await input.repository.get(target.ref));
  else return undefined;
  input.signal?.throwIfAborted();
  if (!paperId) {
    if (input.intent === "origin") throw new Error("此资产未记录可定位的原文来源，仍可预览资产本身。");
    return undefined;
  }
  // A fallback belongs to the clicked, versioned member, never an arbitrary objectId alias.
  if (page === undefined && input.member) {
    const member = input.member;
    if (member.scopeId !== input.repository.scopeId || splitReference(member.resourcePath).target !== locator || member.paperId !== paperId) {
      throw new Error("项目成员与来源文献不一致，请重新选择来源。");
    }
    page = validPage(member.page);
  }
  const paper = input.papers.find(value => value.id === paperId);
  if (!paper) throw new Error("原始 PDF 已不在当前文献库中，请重新导入文件。");
  if (!paper.sourcePath) throw new Error("未找到原始 PDF 文件，请在文献库中重新关联文件。");
  if (hashes.size > 1 || [...hashes].some(value => paper.contentHash && value !== paper.contentHash)) throw new Error("原始 PDF 已更换，无法按旧引用预览。请重新选择来源。");
  if (hashes.size && !paper.contentHash) throw new Error("无法核验原始 PDF 的版本，请重新关联文件后选择来源。");
  if (page === undefined && requiresLocation) throw new Error("这条来源未记录页码，无法定位；可打开整篇文献查找。");
  const precision = page === undefined ? "document" : region ? "region" : "page";
  page = validPage(page ?? 1);
  return { paper, path: liteasyPath(input.repository.scopeId, { kind: "paper", paperId }), page,
    target: { documentKey: JSON.stringify([input.repository.scopeId, paperId, paper.contentHash ?? paper.sourcePath]), page, precision, region } };
}
