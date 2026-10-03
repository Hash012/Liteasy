import assert from "node:assert/strict";

export async function verifyScopeDerivedTags(repository) {
  const author = { id: "scope-author", name: "Synthetic author", initials: "SA" };
  const other = { id: "scope-other", name: "Synthetic reader", initials: "SR" };
  const literature = await repository.confirmRefetchedLiterature(author, { candidateKey: "crossref:doi:10.1000/scope-tags", provider: "crossref", record: { authors: ["Synthetic"], title: "Scope tag fixture", identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/scope-tags" }], year: 2026 } });
  const base = { body: "Synthetic spectral methods converge using the same controlled sentence for every scope isolation example.", tags: [], shareToPlaza: false, targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  const platform = (annotation) => annotation.tags.filter((tag) => tag.origin === "platform");
  for (const [visibility, organizationId, marker] of [["private", undefined, "private-marker"], ["organization", "org-x", "org-marker"], ["mutual_followers", undefined, "mutual-marker"]]) {
    const sample = await repository.createAnnotation(author, { ...base, visibility, organizationId, tags: [marker] });
    const publicResult = await repository.createAnnotation(other, { ...base, visibility: "public" });
    assert.ok(!platform(publicResult).some((tag) => tag.name === marker), `${visibility} sample must not label public output`);
    const sameScope = await repository.createAnnotation(author, { ...base, visibility, organizationId });
    assert.ok(platform(sameScope).some((tag) => tag.name === marker), "eligible same-scope inference remains available");
    assert.equal(platform(sameScope).find((tag) => tag.name === marker).classifierVersion, "local-semantic-scope-v2");
    assert.deepEqual(platform(sameScope).find((tag) => tag.name === marker).sourceScope, { visibility, organizationId: organizationId ?? null, authorId: visibility === "organization" ? null : author.id });
    await repository.withdraw(sample.id, author);
    const afterWithdrawal = await repository.createAnnotation(author, { ...base, visibility, organizationId });
    assert.ok(!platform(afterWithdrawal).some((tag) => tag.name === marker));
  }
}
