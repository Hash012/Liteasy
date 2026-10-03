const purposes = new Set(["explanation", "question", "replication", "curation"]);
const origins = ["unspecified", "human", "ai_assisted", "ai_generated"];

// These are contributor declarations, never a scientific truth/correctness score.
export function annotationContribution(value, previous, contentChanged = false) {
  const prior = previous && typeof previous === "object" ? previous : {};
  const next = value && typeof value === "object" ? value : {};
  const origin = origins[Math.max(0, origins.indexOf(prior.origin), origins.indexOf(next.origin))];
  return {
    purpose: purposes.has(next.purpose) ? next.purpose : purposes.has(prior.purpose) ? prior.purpose : "explanation",
    origin,
    review: contentChanged ? "unreviewed" : next.review === "source_checked" || (next.review === undefined && prior.review === "source_checked") ? "source_checked" : "unreviewed",
    editedByUser: Boolean(prior.editedByUser || (previous && contentChanged))
  };
}
