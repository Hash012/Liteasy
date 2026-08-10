import { communityApi } from "./communityApi";
import type { AnnotationTarget, LiteratureReference } from "./community.types";

function isCanonical(reference: LiteratureReference): reference is { literatureId: string } {
  return "literatureId" in reference;
}

export function inheritedTargetsAreCanonical(targets: AnnotationTarget[]) {
  return targets.every((target) => isCanonical(target.literature) && (target.kind !== "derived_passage" || target.evidence.every((item) => isCanonical(item.literature))));
}

export async function canonicalizeInheritedTargets(targets: AnnotationTarget[]): Promise<AnnotationTarget[]> {
  const confirmations = new Map<string, Promise<{ literatureId: string }>>();

  async function canonicalize(reference: LiteratureReference) {
    if (isCanonical(reference)) return structuredClone(reference);
    const key = JSON.stringify(reference);
    const existing = confirmations.get(key);
    if (existing) return existing;
    const confirmation = (async () => {
      const result = await communityApi.resolveLiterature({
        hints: {
          authors: reference.metadata.authors,
          identifiers: [{ kind: reference.identity.kind, value: reference.identity.value }],
          title: reference.metadata.title,
          ...(reference.metadata.year ? { year: reference.metadata.year } : {})
        },
        purpose: "forum_compose"
      });
      if (result.status !== "exact") throw new Error("LITERATURE_RECONFIRMATION_REQUIRED");
      const confirmed = await communityApi.confirmLiterature({ candidateKey: result.candidate.candidateKey, mode: "candidate" });
      return { literatureId: confirmed.literature.literatureId };
    })();
    confirmations.set(key, confirmation);
    return confirmation;
  }

  return Promise.all(targets.map(async (target): Promise<AnnotationTarget> => {
    if (target.kind === "whole_document") return { kind: target.kind, literature: await canonicalize(target.literature) };
    if (target.kind === "source_passage") return { ...structuredClone(target), literature: await canonicalize(target.literature) };
    return {
      ...structuredClone(target),
      evidence: await Promise.all(target.evidence.map(async (item) => ({ ...structuredClone(item), literature: await canonicalize(item.literature) }))),
      literature: await canonicalize(target.literature)
    };
  }));
}
