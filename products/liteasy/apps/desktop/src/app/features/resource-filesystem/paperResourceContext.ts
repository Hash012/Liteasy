import type { ObjectRepository } from "../objects/objectRepository";
import { objectText, refOf, type ObjectEnvelope } from "../objects/object.types";
import type { PaperProjectRepository } from "../paper-projects/paperProjectRepository";
import type { Paper } from "../workspace/workspace.types";
import type { PaperResourceKind } from "../import/paperResource.types";
import { MODEL_IMAGE_LIMITS } from "../models/modelImages";
import { liteasyPath } from "./liteasyPath";
import { contextAttachments } from "./resourceContext";

/** A resource group is one read-only context asset; original page/image refs stay immutable. */
export async function paperResourceContext(input: { repository: ObjectRepository; projects: PaperProjectRepository;
  paper: Paper; kind: PaperResourceKind; active(): boolean }) {
  const { repository, projects, paper, kind, active } = input;
  const check = () => { if (!active()) throw new Error("账号已切换。"); };
  check();
  const project = (await projects.listProjects()).find((item) => item.paperId === paper.id);
  const items = (project ? await projects.listAssets(project.projectId) : []).filter((item) => item.role === "source" && item.ref && (
    kind === "multimodal" ? item.kind === "text" || item.kind === "image" : item.kind === (kind === "figures" ? "image" : "text")
  )).sort((left, right) => (left.page ?? 0) - (right.page ?? 0) || Number(left.kind === "image") - Number(right.kind === "image") || left.title.localeCompare(right.title));
  if (!items.length) throw new Error("论文附件尚未完成保存，请稍后重试或先在阅读器解析论文。");
  const title = `${paper.title} · ${{ extracted_text: "提取文本", figures: "插图", multimodal: "图文版" }[kind]}`.slice(0, 1000);
  const parts: string[] = [];
  const descriptors = new Map<string, ObjectEnvelope["assets"][number]>();
  let bytes = 0;
  for (const item of items) {
    check();
    const source = await repository.get(item.ref!);
    if (source.kind !== "source.document" || source.content.payload.paperId !== paper.id) throw new Error("论文附件来源不一致，请刷新文献库。");
    const label = item.title.replace(/[\[\]\\]/g, "");
    const text = `## ${item.page ? `第 ${item.page} 页 · ` : ""}${item.title}\n来源：[《${label}》](${liteasyPath(repository.scopeId, { kind: "object", ref: item.ref! })})\n\n${objectText(source)}`;
    bytes += new TextEncoder().encode(JSON.stringify(text)).byteLength;
    // Head and immutable revision are saved together. Bound the transaction before
    // joining the body; never silently cut the last pages from the user's selection.
    if (bytes > 8 * 1024 * 1024) throw new Error("这组附件正文超过 8 MiB，请在“添加上下文”中按页或章节搜索并分批添加。尚未省略或截断任何原文。");
    parts.push(text);
    for (const descriptor of source.assets) if (descriptor.mediaType.startsWith("image/")) descriptors.set(descriptor.assetId, descriptor);
  }
  const images = [...descriptors.values()];
  const imageBudgetExceeded = images.length > MODEL_IMAGE_LIMITS.count || images.some((image) => image.byteLength > MODEL_IMAGE_LIMITS.imageBytes)
    || images.reduce((total, image) => total + image.byteLength, 0) > MODEL_IMAGE_LIMITS.totalBytes;
  const imageNotice = imageBudgetExceeded ? "本组图片超过一次调用的图片预算。这里保留全部图片说明及固定来源链接，未加载图片像素；需要查看原图时，请按下方图片标题 search 后分别 read。" : "";
  const summary = `${items.length} 项已解析来源 · 按原文页码排列 · 正文可按 offset 分页读取。${imageNotice}`;
  check();
  const object = await repository.projectLegacy(`paper-resource-group:${project!.projectId}:${kind}`, {
    kind: "source.document", title, sourceRefs: items.map((item) => item.ref!), assets: imageBudgetExceeded ? [] : images,
    content: { schema: "liteasy.source-document/v1", payload: { paperId: paper.id,
      text: [`# ${title}`, summary, ...parts].join("\n\n"), abstractText: summary,
      legacyKey: `paper-resource-group:${project!.projectId}:${kind}`, availability: "local",
      ...(paper.contentHash ? { documentHash: paper.contentHash } : {}),
    } },
  });
  const attachments = await contextAttachments(repository, [refOf(object)], active);
  return attachments.map((attachment) => ({ ...attachment, detail: `${items.length} 项 · 已固定版本${imageBudgetExceeded ? " · 图片按需分批读取" : ""}` }));
}
