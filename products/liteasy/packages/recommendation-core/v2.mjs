import { terms } from "./index.mjs";
export function canonicalCandidate(item) {
  const raw = item.doi || item.canonicalId || item.id;
  const doi = raw?.replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "").replace(/^doi:/i, "");
  if (/^10\.\d+\//.test(doi)) return `doi:${doi.toLowerCase()}`;
  const arxiv = raw?.match(/(?:arxiv:|arxiv.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return arxiv ? `arxiv:${arxiv[1]}` : String(item.canonicalId || item.id);
}
const score = item => Math.max(0, Math.min(1, item.scoreComponents?.finalScore ?? item.relevanceScore ?? 0));
const topics = item => item.facetIds?.length ? item.facetIds : item.relatedDocumentTitles?.length ? item.relatedDocumentTitles : [item.relatedDocumentTitle || "general"];
function overlap(a, b) { const left = new Set(terms(a.title)); const right = new Set(terms(b.title)); let common = 0; for (const term of left) if (right.has(term)) common++; return common / Math.max(1, Math.min(left.size, right.size)); }
/** Relevance gate precedes coverage and fatigue. No forced low-quality exploration slot. */
export function composeSlate(items, { count = 3, excluded = [], exposure = {}, topicExposure = {}, preserveOrder = false } = {}) {
  const excludedSet = new Set(excluded), unique = new Map();
  for (const item of items.slice(0, 200)) {
    const key = canonicalCandidate(item);
    if (!item.title?.trim() || score(item) < .15 || excludedSet.has(key) || excludedSet.has(item.id)) continue;
    if (!unique.has(key) || score(unique.get(key)) < score(item)) unique.set(key, item);
  }
  const remaining = [...unique.values()], result = [], covered = new Set();
  while (remaining.length && result.length < Math.max(1, Math.min(5, count))) {
    let best = 0, bestUtility = -Infinity;
    remaining.forEach((item, index) => {
      const coverage = topics(item).reduce((sum, topic) => sum + (covered.has(topic) ? 0 : .22 / (1 + (topicExposure[topic] || 0))), 0);
      const redundancy = result.reduce((max, selected) => Math.max(max, overlap(item, selected)), 0) * .12;
      const fatigue = Math.min(.3, (exposure[canonicalCandidate(item)] || 0) * .06);
      const order = preserveOrder ? .25 * (1 - items.indexOf(item) / Math.max(1, items.length)) : 0;
      const utility = score(item) + order + coverage - redundancy - fatigue;
      if (utility > bestUtility) { bestUtility = utility; best = index; }
    });
    const selected = remaining.splice(best, 1)[0]; result.push(selected); topics(selected).forEach(topic => covered.add(topic));
  }
  return result;
}
/** Strict whitelist: source text is data; model output cannot create a catalogue or permissions. */
export function validateResearchReasons(value, candidateIds, evidenceIds) {
  if (!value || Object.keys(value).some(key => key !== "reasons") || !Array.isArray(value.reasons) || value.reasons.length > 5) throw new Error("Invalid explanation schema");
  const candidates = new Set(candidateIds), evidence = new Set(evidenceIds), seen = new Set();
  return value.reasons.map(row => {
    if (!row || Object.keys(row).some(key => !["candidateId", "evidenceIds", "text", "role"].includes(key)) || !candidates.has(row.candidateId) || seen.has(row.candidateId) || typeof row.text !== "string" || !row.text.trim() || row.text.length > 600 || !["next_read", "alternative", "foundation", "bridge", "new_evidence"].includes(row.role) || !Array.isArray(row.evidenceIds) || !row.evidenceIds.length || row.evidenceIds.length > 8 || row.evidenceIds.some(id => !evidence.has(id))) throw new Error("Unverified recommendation explanation");
    seen.add(row.candidateId); return row;
  });
}
export function projectEvidence(events, { now, epoch, tombstones, days = 30 }) {
  const deleted = new Set(tombstones), latest = new Map(), seen = new Set();
  for (const event of events) {
    if (seen.has(event.id) || event.epoch !== epoch || deleted.has(event.sourceId) || event.at > now || event.at < now - days * 86400000 || !["annotation_committed", "user_question_committed", "qualified_reading_interval", "accepted_insight"].includes(event.type)) continue;
    seen.add(event.id); const key = `${event.type}:${event.producerActionId}`;
    if (!latest.has(key) || latest.get(key).at <= event.at) latest.set(key, event);
  }
  const perDay = new Map();
  return [...latest.values()].sort((a, b) => b.at - a.at).flatMap(event => {
    const key = `${event.sourceId}:${Math.floor(event.at / 86400000)}`, used = perDay.get(key) || 0;
    const halfLife = event.type === "qualified_reading_interval" ? 7 : 90;
    const weight = Math.min(Math.max(0, 3 - used), (event.type === "user_question_committed" ? 1.5 : 1) * 2 ** (-(now - event.at) / (halfLife * 86400000)));
    perDay.set(key, used + weight); return weight > 0 ? [{ ...event, weight }] : [];
  });
}
export function clusterInterests(events, fixed = []) {
  const facets = fixed.filter(facet => ["confirmed", "pinned", "paused"].includes(facet.status)).slice(0, 6).map(facet => ({ ...facet }));
  for (const event of events) {
    const words = terms(event.text || "").slice(0, 16); if (!words.length) continue;
    const match = facets.find(facet => facet.status !== "paused" && words.some(word => terms(facet.problem || facet.label).includes(word)));
    if (match) { match.evidenceIds = [...new Set([...match.evidenceIds, event.id])].slice(-100); continue; }
    if (facets.length >= 6) continue;
    facets.push({ id: `facet:${event.id}`, version: event.revision, label: words.slice(0, 3).join(" · "), problem: (event.text || "").slice(0, 300), methods: [], tasksOrDatasets: [], metrics: [], stage: "unspecified", unresolvedQuestions: event.type === "user_question_committed" ? [{ id: event.id, text: event.text.slice(0, 500), evidenceIds: [event.id] }] : [], status: "tentative", evidenceIds: [event.id], exclusions: [], confidenceBand: "limited" });
  }
  return facets;
}
