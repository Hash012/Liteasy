import { z } from "zod";

const nonBlank = (maximum: number) => z.string().min(1).max(maximum).refine((value) => Boolean(value.trim()), "内容不能为空白");
const id = nonBlank(200);
const references = z.array(id).max(100);
const slideSchema = z.strictObject({
  id,
  title: nonBlank(240),
  markdown: nonBlank(12_000),
  notes: z.string().max(4_000),
  evidenceIds: references
});
export const slidesArtifactSchema = z.strictObject({
  version: z.literal("liteasy.authored-artifact/v1"),
  kind: z.literal("slides"),
  title: nonBlank(160),
  slides: z.array(slideSchema).min(1).max(40)
});
export const outlineArtifactSchema = z.strictObject({
  version: z.literal("liteasy.authored-artifact/v1"),
  kind: z.literal("outline"),
  title: nonBlank(160),
  nodes: z.array(z.strictObject({
    id,
    parentId: id.nullable(),
    label: nonBlank(1_000),
    evidenceIds: references
  })).min(1).max(1_200)
});
export const authoredArtifactSchema = z.discriminatedUnion("kind", [slidesArtifactSchema, outlineArtifactSchema]);
export type AuthoredArtifact = z.infer<typeof authoredArtifactSchema>;

/** Validate model and stored content before publishing it as an application file. */
export function parseAuthoredArtifact(value: unknown, allowedEvidenceIds?: ReadonlySet<string>): AuthoredArtifact {
  const artifact = authoredArtifactSchema.parse(value);
  const entries = artifact.kind === "slides" ? artifact.slides : artifact.nodes;
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  if (entriesById.size !== entries.length) throw new Error("生成内容包含重复节点，请重试。");
  for (const entry of entries) {
    if (allowedEvidenceIds && entry.evidenceIds.some((ref) => !allowedEvidenceIds.has(ref))) {
      throw new Error("生成内容引用了未提供的来源，请重试。");
    }
  }
  if (artifact.kind === "outline") {
    const parents = new Map(artifact.nodes.map((node) => [node.id, node.parentId]));
    for (const node of artifact.nodes) {
      const seen = new Set<string>([node.id]);
      let parent = node.parentId;
      while (parent !== null) {
        if (!parents.has(parent) || seen.has(parent) || seen.size >= 20) {
          throw new Error("生成的大纲层级无效或过深，请重试。");
        }
        seen.add(parent);
        parent = parents.get(parent)!;
      }
    }
  }
  return artifact;
}

export function authoredArtifactMarkdown(artifact: AuthoredArtifact, referenceLabel?: (ids: readonly string[]) => string): string {
  if (artifact.kind === "slides") {
    return [`# ${artifact.title}`, ...artifact.slides.map((slide) =>
      `## ${slide.title}\n\n${slide.markdown}${slide.notes ? `\n\n### 演讲备注\n\n${slide.notes}` : ""}${slide.evidenceIds.length && referenceLabel ? `\n\n**出处：** ${referenceLabel(slide.evidenceIds)}` : ""}`
    )].join("\n\n---\n\n");
  }
  const children = new Map<string | null, typeof artifact.nodes>();
  for (const node of artifact.nodes) {
    let siblings = children.get(node.parentId);
    if (!siblings) {
      siblings = [];
      children.set(node.parentId, siblings);
    }
    siblings.push(node);
  }
  const lines = [`# ${artifact.title}`, ""];
  const visit = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      lines.push(`${"  ".repeat(depth)}- ${node.label}${node.evidenceIds.length && referenceLabel ? `（出处：${referenceLabel(node.evidenceIds)}）` : ""}`);
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return lines.join("\n");
}
