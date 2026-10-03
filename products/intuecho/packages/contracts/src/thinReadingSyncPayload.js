function literature(reference) {
  return { literatureId: reference?.literatureId };
}

function sourcePassage(value) {
  return {
    anchorHash: value.anchorHash,
    excerpt: value.excerpt,
    literature: literature(value.literature),
    ...(value.page === undefined ? {} : { page: value.page }),
    rects: (value.rects ?? []).map((rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
  };
}

// Match the existing wire fields, not response hydration such as literatureRecord,
// display labels, or target row IDs. Array order is part of the publication.
export function thinReadingSyncPayload(value) {
  return JSON.stringify({
    body: value.body,
    targets: value.targets.map((target) => target.kind === "source_passage"
      ? { kind: target.kind, ...sourcePassage(target) }
      : target.kind === "derived_passage"
        ? { kind: target.kind, literature: literature(target.literature), derivedContent: {
            artifactId: target.derivedContent.artifactId, excerpt: target.derivedContent.excerpt,
            nodeId: target.derivedContent.nodeId, version: target.derivedContent.version
          }, evidence: target.evidence.map(sourcePassage) }
        : { kind: target.kind, literature: literature(target.literature) })
  });
}
