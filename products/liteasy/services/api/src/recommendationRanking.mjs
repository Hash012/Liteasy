import { LibraryRepositoryError } from "./libraryRepository.mjs";

export const recommendationStyles = new Set(["balanced", "frontier", "classic", "exploratory"]);

export function recommendationStyle(value) {
  if (value === undefined) return "balanced";
  if (!recommendationStyles.has(value)) throw new LibraryRepositoryError("recommendation_style_invalid");
  return value;
}

const stopWords = new Set("a an and are as at be by for from in into is of on or the to using via with study studies analysis based approach paper".split(" "));

export function titleKey(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value) {
  const normalized = titleKey(value);
  const latin = (normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []).filter((token) => !stopWords.has(token));
  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return new Set([...latin, ...chineseRuns.flatMap((run) =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  )]);
}

export function similarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.sqrt(leftTokens.size * rightTokens.size);
}

export function score(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

export function styleEvidence(source, style, now) {
  const year = source.publishedYear;
  const validYear = Number.isInteger(year) && year >= 1600 && year <= now.getUTCFullYear();
  const publishedTime = typeof source.publishedAt === "string" ? Date.parse(source.publishedAt) : NaN;
  const age = Number.isFinite(publishedTime)
    ? publishedTime <= now.getTime() ? (now.getTime() - publishedTime) / (365.25 * 24 * 60 * 60 * 1000) : undefined
    : validYear ? now.getUTCFullYear() - year : undefined;
  const citations = Number.isSafeInteger(source.citationCount) && source.citationCount >= 0
    ? source.citationCount : undefined;
  const recency = age === undefined ? 0.5 : Math.exp(-age / 3);
  // A large count is supporting evidence, not a claim of quality or field-normalized impact.
  const influence = citations === undefined ? 0.5 : Math.min(1, Math.log1p(citations) / Math.log1p(1000));
  const maturity = age === undefined ? 0.5 : Math.min(1, age / 8);
  const classic = citations === undefined ? 0.5 : influence * (0.4 + maturity * 0.6);
  const styleScore = style === "frontier" ? recency : style === "classic" ? classic
    : style === "exploratory" ? 0.5 : (recency + classic) / 2;
  const label = { balanced: "均衡阅读", frontier: "前沿进展", classic: "经典回顾", exploratory: "跨域探索" }[style];
  const facts = [
    age === undefined ? "发表时间未知，不据此判断新旧" : `发表年份 ${year ?? new Date(publishedTime).getUTCFullYear()}`,
    citations === undefined ? "引用数据缺失，不据此判断影响力" : `Crossref 收录引用 ${citations} 次（非完整引用统计）`
  ];
  return { explanation: `${label}排序；${facts.join("；")}`, styleScore: score(styleScore) };
}

export function diverseRecommendations(candidates, style, limit = 8) {
  const remaining = [...candidates];
  const selected = [];
  const diversityWeight = style === "exploratory" ? 0.25 : 0.08;
  while (remaining.length && selected.length < limit) {
    const ranked = remaining.map((item) => {
      const redundancy = Math.max(0, ...selected.map((prior) => similarity(prior.title, item.title)));
      const penalty = score(redundancy * diversityWeight);
      return {
        ...item,
        scoreComponents: {
          ...item.scoreComponents,
          diversityPenalty: penalty,
          finalScore: score(item.scoreComponents.finalScore - penalty)
        }
      };
    }).sort((left, right) => right.scoreComponents.finalScore - left.scoreComponents.finalScore ||
      right.relevanceScore - left.relevanceScore || left.id.localeCompare(right.id));
    const next = ranked[0];
    if (next.scoreComponents.diversityPenalty > 0) next.reason += "；同时兼顾主题多样性，减少相似标题重复。";
    selected.push(next);
    remaining.splice(remaining.findIndex((item) => item.id === next.id), 1);
  }
  return selected;
}
