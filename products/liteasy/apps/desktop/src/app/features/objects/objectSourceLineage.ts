import type { ObjectEnvelope, ObjectRef } from "./object.types";

/** Compact provenance index. It contains locators, never source text or authority. */
export type ObjectSourceLineage = { paperIds: string[]; refs: ObjectRef[] };
export function objectSourceLineage(object: ObjectEnvelope): ObjectSourceLineage {
  const paperIds = (object.paperAnchors ?? []).map((anchor) => anchor.source.paperId);
  if (object.kind === "source.document" && !object.content.payload.legacyKey.startsWith("reading-file:") && !object.content.payload.legacyKey.startsWith("reference:")) paperIds.push(object.content.payload.paperId);
  if (object.kind === "workspace.board" && object.content.payload.paperId) paperIds.push(object.content.payload.paperId);
  const refs = [...object.provenance.sourceRefs, ...(object.provenance.derivedFrom ?? []),
    ...(object.paperAnchors ?? []).flatMap((anchor) => anchor.source.objectRef ? [anchor.source.objectRef] : [])];
  if (object.kind === "content.fragment") refs.push(...object.content.payload.anchors.map((anchor) => anchor.sourceRef));
  if (object.kind === "artifact.document") for (const block of object.content.payload.blocks) refs.push(...block.sourceRefs, ...(block.type === "reference" ? [block.ref] : []));
  return { paperIds: [...new Set(paperIds)], refs: [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()] };
}
