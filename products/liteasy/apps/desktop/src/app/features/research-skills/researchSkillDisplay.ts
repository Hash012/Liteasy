import catalog from "../../../../../../packages/research-skills/catalog.json";
import type { ResearchSkillRef } from "./researchDocument";

/** Resolve only the exact bundled version; an unknown old package is never relabeled as a newer method. */
export function researchSkillDisplayTitle(ref: ResearchSkillRef) {
  return catalog.entries.find(entry => entry.id === ref.id && entry.version === ref.version && entry.packageDigest === ref.packageDigest)?.title ?? "科研方法名称不可用";
}
