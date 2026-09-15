import { z } from "zod";
import { authoredArtifactMarkdown, authoredArtifactSchema, type AuthoredArtifact } from "../artifact-workflow/authoredArtifact";
import { contextRefSchema } from "../context/objectContext";
import { collectPaperAnchors, formatPaperAnchorText, paperAnchorEntitySchema, paperAnchorLabel } from "../paper-anchors/paperAnchorEntity";

/** The native file keeps exact source identities beside the typed creative content. */
export const authoredResourceFileSchema = z.strictObject({
  schema: z.literal("liteasy.authored-resource/v1"),
  artifactId: z.string().min(1),
  content: authoredArtifactSchema,
  sources: z.strictObject({
    paperAnchors: z.array(paperAnchorEntitySchema),
    contextRefs: z.array(contextRefSchema),
  }),
});
export type AuthoredResourceFile = z.infer<typeof authoredResourceFileSchema>;

export function createAuthoredResourceFile(input: {
  artifactId: string;
  content: AuthoredArtifact;
  paperAnchors?: readonly unknown[];
  contextRefs?: readonly unknown[];
}): AuthoredResourceFile {
  return authoredResourceFileSchema.parse({
    schema: "liteasy.authored-resource/v1",
    artifactId: input.artifactId,
    content: input.content,
    sources: { paperAnchors: collectPaperAnchors(input.paperAnchors ?? []), contextRefs: input.contextRefs ?? [] },
  });
}

export function authoredResourceMarkdown(file: AuthoredResourceFile): string {
  const { paperAnchors, contextRefs } = file.sources;
  const contextIds = new Map(contextRefs.map((ref, index) => ["objectId" in ref
    ? `${ref.objectId}@${ref.revision}` : `context-${index + 1}`, `来源资源 ${index + 1}`]));
  const referenceLabel = (ids: readonly string[]) => [...new Set(ids.map((id) => {
    if (contextIds.has(id)) return contextIds.get(id)!;
    const matches = paperAnchors.filter((anchor) => anchor.evidenceIds.includes(id));
    if (!matches.length) return "〔来源待关联〕";
    const identities = new Set(matches.map((anchor) => JSON.stringify([anchor.source, anchor.locator, anchor.snapshot])));
    return identities.size === 1 ? paperAnchorLabel(matches[0]!) : "〔来源待关联〕";
  }))].join("；");
  const lines = [formatPaperAnchorText(authoredArtifactMarkdown(file.content, referenceLabel), paperAnchors)];
  if (paperAnchors.length) {
    lines.push("## 论文出处", "");
    for (const anchor of paperAnchors) {
      lines.push(`### ${paperAnchorLabel(anchor)}`, "", ...anchor.snapshot.quote.split(/\r?\n/).map((line) => `> ${line}`), "");
    }
  }
  return `${formatPaperAnchorText(lines.join("\n\n").trim(), paperAnchors)}\n`;
}
