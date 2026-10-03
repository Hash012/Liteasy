import { describe, expect, test } from "vitest";
import { createAnnotationSchema, createReplySchema } from "@intuecho/contracts";
import { buildReadingPack, buildReadingReply, buildPersonalReadingNote, isHostSummary, readingMaterials, readingPacks } from "./readingGroup";
import { annotationFixture, replyFixture } from "./readingGroupFixtures";

describe("organization reading group payload boundaries", () => {
  test("selects only current organization materials and never carries excerpts or record payloads into a pack", () => {
    const source = annotationFixture({ targets: [{
      kind: "source_passage", anchorHash: "source-anchor", excerpt: "PRIVATE_EXCERPT", rects: [],
      literature: { literatureId: "literature_1", literatureRecord: { status: "confirmed", revision: 1, title: "Synthetic reading", privateUrl: "PRIVATE_URL" } }
    }] as never });
    const materials = readingMaterials([source, annotationFixture({ id: "foreign", organizationId: "org_other" })], "org_x");
    expect(materials).toEqual([{ literatureId: "literature_1", title: "Synthetic reading", revision: 1 }]);
    const payload = buildReadingPack({ organizationId: "org_x", title: "Selected reading", guide: "Compare the evidence", materials, deadline: "2026-10-15" });
    expect(createAnnotationSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ visibility: "organization", organizationId: "org_x", shareToPlaza: false, tags: ["读书包", "讨论中"] });
    expect(payload.targets).toEqual([{ kind: "whole_document", literature: { literatureId: "literature_1" } }]);
    expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_EXCERPT|PRIVATE_URL|literatureRecord/);
    expect(() => buildReadingPack({ organizationId: "org_x", title: "empty", guide: "Guide", materials: [] })).toThrow();
  });

  test("questions and evidence responses stay ordinary replies in the existing organization scope", () => {
    const pack = annotationFixture();
    const payload = buildReadingReply({ pack, kind: "question", body: "Which assumption needs checking?", evidence: "Reading 1, section 2", viewerId: "member_1" });
    expect(createReplySchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ publishAsAnnotation: false, targets: [], tags: [] });
    expect(payload.expectedParent).toEqual({ revision: 2, visibility: "organization", organizationId: "org_x" });
    expect(payload.body).toContain("## 问题");
    expect(payload.body).toContain("原文位置（自行核对）");
    expect(() => buildReadingReply({ pack: { ...pack, visibility: "public" }, kind: "question", body: "Question", viewerId: "member_1" })).toThrow();
  });

  test("only the actual pack author can prepare a host summary, preserving unresolved items and source revisions", () => {
    const pack = annotationFixture();
    const contribution = replyFixture({ revision: 3 });
    expect(() => buildReadingReply({ pack, kind: "summary", body: "Conclusion", unresolved: "Disagreement", viewerId: "someone_else", references: [contribution] })).toThrow();
    const payload = buildReadingReply({ pack, kind: "summary", body: "Provisional conclusion", unresolved: "The assumption is still disputed", viewerId: pack.author.id, references: [contribution] });
    expect(payload.body).toContain("## 未解决项与异议");
    expect(payload.body).toContain("The assumption is still disputed");
    expect(payload.body).toContain("修订 3");
    expect(payload.body).toContain("不代表全员共识");
    expect(payload.body).not.toContain(contribution.body);
    expect(isHostSummary(pack, replyFixture({ body: payload.body, author: contribution.author }))).toBe(false);
    expect(isHostSummary(pack, replyFixture({ body: "Updated summary wording", author: pack.author, collaboration: payload.collaboration }))).toBe(true);
  });

  test("personal note export includes only new personal writing and a bounded source reference", () => {
    const pack = annotationFixture({ body: "PRIVATE_GROUP_BODY", author: { ...annotationFixture().author, name: "PRIVATE_AUTHOR" } });
    const note = buildPersonalReadingNote(pack, "My independently written reflection");
    expect(note.content).toContain("My independently written reflection");
    expect(note.content).toContain("/annotations/pack_1");
    expect(note.content).toContain("修订 2");
    expect(note.content).not.toMatch(/PRIVATE_GROUP_BODY|PRIVATE_AUTHOR|literature_1/);
    expect(note.content).toContain("sourcePolicy: organization-bound");
    expect(note.content).toContain("sourceNamespace: intuecho.annotation");
    expect(note.filename).toBe("reading-group-note.md");
    expect(readingPacks([pack, { ...pack, id: "foreign", organizationId: "org_other" }, { ...pack, id: "withdrawn", withdrawnAt: "2026-10-03" }], "org_x")).toEqual([pack]);
  });
});

test("typed reading packs survive renamed labels and legacy lookalikes remain ordinary", () => {
  const pack = annotationFixture({ tags: [], body: "Renamed text" });
  expect(readingPacks([pack, annotationFixture({ id: "legacy", collaboration: null })], "org_x")).toEqual([pack]);
  expect(isHostSummary(pack, replyFixture({ author: pack.author, body: "## 主持人手动摘要\nLegacy", collaboration: null }))).toBe(false);
});
test("unconfirmed or unversioned source projections cannot become confirmed materials", () => {
  expect(readingMaterials([annotationFixture({ targets: [{ kind: "whole_document", literature: { literatureId: "fake" } }] })], "org_x")).toEqual([]);
});
