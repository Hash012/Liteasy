import type { CommunityAnnotation, CommunityReply, CreateAnnotationInput, CreateReplyInput } from "../community.types";

export type ReadingMaterial = { literatureId: string; title: string };
export type ReadingContributionKind = "question" | "evidence" | "summary";
export type PersonalReadingNote = { content: string; filename: string };

export function readingPacks(annotations: CommunityAnnotation[], organizationId: string) {
  return annotations.filter((annotation) => annotation.visibility === "organization" &&
    annotation.organizationId === organizationId && !annotation.withdrawnAt &&
    annotation.tags.some((tag) => tag.origin === "user" && tag.state === "active" && tag.name === "读书包"));
}

export function readingMaterials(annotations: CommunityAnnotation[], organizationId: string): ReadingMaterial[] {
  const materials = new Map<string, ReadingMaterial>();
  for (const annotation of annotations) {
    if (annotation.visibility !== "organization" || annotation.organizationId !== organizationId || annotation.withdrawnAt) continue;
    for (const target of annotation.targets) {
      if (!("literatureId" in target.literature)) continue;
      const literatureId = target.literature.literatureId;
      if (!materials.has(literatureId)) materials.set(literatureId, {
        literatureId,
        title: target.literature.literatureRecord?.title ?? "已确认文献（未提供标题）"
      });
    }
  }
  return [...materials.values()];
}

export function readingPackTitle(pack: CommunityAnnotation) {
  return pack.body.split("\n")[0].replace(/^#+\s*/, "").slice(0, 160);
}

function required(value: string, max: number, message: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(message);
  return normalized;
}

function organizationPack(pack: CommunityAnnotation) {
  if (pack.visibility !== "organization" || !pack.organizationId || pack.shareToPlaza || pack.withdrawnAt) {
    throw new Error("读书包的组织范围已变化，请重新加载。");
  }
}

export function buildReadingPack({ organizationId, title, guide, materials, deadline }: {
  organizationId: string; title: string; guide: string; materials: ReadingMaterial[]; deadline?: string;
}): CreateAnnotationInput {
  required(organizationId, 200, "请先选择有效组织。");
  const selected = [...new Set(materials.map((material) => required(material.literatureId, 200, "请重新确认文献身份。")))];
  if (!selected.length || selected.length > 100) throw new Error("请选择 1 至 100 篇已确认的资料。");
  if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
    Number.isNaN(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0, 10) !== deadline)) {
    throw new Error("请填写有效的讨论截止日期。");
  }
  return {
    body: `# ${required(title, 160, "请填写不超过 160 字的读书主题。")}\n\n## 导读\n${required(guide, 6000, "请填写导读，最多 6000 字。")}${deadline ? `\n\n讨论截止日期：${deadline}` : ""}`,
    organizationId,
    shareToPlaza: false,
    tags: ["读书包", "讨论中"],
    targets: selected.map((literatureId) => ({ kind: "whole_document", literature: { literatureId } })),
    visibility: "organization"
  };
}

export function buildReadingReply({ pack, kind, body, evidence, unresolved, references = [], viewerId }: {
  pack: CommunityAnnotation; kind: ReadingContributionKind; body: string; evidence?: string;
  unresolved?: string; references?: CommunityReply[]; viewerId: string;
}): CreateReplyInput {
  organizationPack(pack);
  if (kind === "summary" && pack.author.id !== viewerId) throw new Error("仅读书包主持人可整理主持人摘要。");
  if (references.some((reply) => reply.parentAnnotationId !== pack.id)) throw new Error("引用不属于当前读书包。");
  let content = `## ${kind === "summary" ? "主持人手动摘要" : kind === "question" ? "问题" : "原文对照与回应"}\n${required(body, 6000, "请填写内容，最多 6000 字。")}`;
  if (evidence?.trim()) content += `\n\n原文位置（自行核对）：${required(evidence, 500, "原文位置最多 500 字。")}`;
  if (kind === "summary") {
    content += `\n\n## 未解决项与异议\n${required(unresolved ?? "", 1000, "请明确记录未解决项与异议。")}`;
    if (references.length) content += `\n\n## 讨论依据\n${references.map((reply) =>
      `- /annotations/${encodeURIComponent(pack.id)}#reply-${encodeURIComponent(reply.id)}（修订 ${reply.revision}）`).join("\n")}`;
    content += "\n\n主持人手动整理，不代表全员共识；参与者可继续更正自己的观点。";
  }
  required(content, 8000, "本次内容过长，请减少正文或引用后重试。");
  return {
    body: content,
    expectedParent: { revision: pack.revision, visibility: "organization", organizationId: pack.organizationId },
    publishAsAnnotation: false, tags: [], targets: []
  };
}

export function isHostSummary(pack: CommunityAnnotation, reply: CommunityReply) {
  return reply.parentAnnotationId === pack.id && reply.author.id === pack.author.id &&
    reply.body.startsWith("## 主持人手动摘要\n");
}

export function buildPersonalReadingNote(pack: CommunityAnnotation, reflection: string): PersonalReadingNote {
  organizationPack(pack);
  return {
    content: `# 个人复盘\n\n${required(reflection, 8000, "请先填写个人复盘，最多 8000 字。")}\n\n来源引用：/annotations/${encodeURIComponent(pack.id)}（修订 ${pack.revision}）\n`,
    filename: "reading-group-note.md"
  };
}
