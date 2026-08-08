/**
 * The retrieval precision gate.
 *
 * Anchor-level association is only worth building a UI on top of if the retrieval behind
 * it is good enough. When five related papers hang off an anchor and three are irrelevant,
 * no amount of interaction design recovers it. So this computes the four numbers the plan
 * asks for from hand-labeled results, and refuses to pass on a sample that cannot answer
 * the question — notably one with no humanities papers, the domain where both retrieval
 * paths degrade at once.
 */

/** How many results per anchor the gate judges. */
export const gateTopResultCount = 5;
/** The plan's target: at least this share of an anchor's top results must be relevant. */
export const gateRelevanceTarget = 0.6;

export type RetrievalGateLabel = {
  /** Whether a citation graph was available — it decides if "closeness" has an
   *  explainable source or is only a model's guess. */
  hasCitationGraph: boolean;
  /** Whether the open-access full text could actually be fetched, which bounds how often
   *  「阅读全文」 is even clickable. */
  openAccessFullText: boolean;
  relevant: boolean;
};

export type RetrievalGateAnchorSample = {
  anchorId: string;
  domain: "humanities" | "stem";
  language: "en" | "zh";
  /** For Chinese anchors: whether the query went out as-is or was translated first. */
  queryPath?: "direct" | "translated";
  results: readonly RetrievalGateLabel[];
};

export type RetrievalGateRate = {
  count: number;
  rate: number;
  total: number;
};

export type RetrievalGateReport = {
  /** Mean of each anchor's own relevance rate. This is what the gate judges, because the
   *  target is stated per anchor — pooling would let one rich anchor cover for a poor one. */
  anchorMeanRelevance: number;
  anchorsWithoutResults: string[];
  citationGraphCoverage: RetrievalGateRate;
  humanities: {
    anchorMeanRelevance: number;
    sampleCount: number;
  };
  openAccessFullText: RetrievalGateRate;
  passed: boolean;
  /** Every reason the gate did not pass, in the order they were checked. */
  shortfalls: string[];
  topFiveRelevance: RetrievalGateRate;
  zhByQueryPath: {
    direct: RetrievalGateRate;
    translated: RetrievalGateRate;
  };
};

function emptyRate(): RetrievalGateRate {
  return { count: 0, rate: 0, total: 0 };
}

function toRate(count: number, total: number): RetrievalGateRate {
  return { count, rate: total === 0 ? 0 : count / total, total };
}

function topResults(sample: RetrievalGateAnchorSample) {
  return sample.results.slice(0, gateTopResultCount);
}

function anchorRelevanceRate(sample: RetrievalGateAnchorSample) {
  const results = topResults(sample);
  if (results.length === 0) {
    // An anchor that returned nothing counts as zero, not as absent: silently dropping it
    // would flatter the score exactly where retrieval failed hardest.
    return 0;
  }
  return results.filter((result) => result.relevant).length / results.length;
}

function meanAnchorRelevance(samples: readonly RetrievalGateAnchorSample[]) {
  if (samples.length === 0) {
    return 0;
  }
  return samples.reduce((total, sample) => total + anchorRelevanceRate(sample), 0) / samples.length;
}

function queryPathBaseAnchorId(sample: RetrievalGateAnchorSample) {
  const suffix = sample.queryPath ? `:${sample.queryPath}` : "";
  return suffix && sample.anchorId.endsWith(suffix)
    ? sample.anchorId.slice(0, -suffix.length)
    : sample.anchorId;
}

/**
 * The direct Chinese path is an evaluation arm, not a route the product uses alone. When the
 * same anchor also has a translated path, the product submits translated + direct together and
 * therefore inherits at least the translated candidates. Keep direct-only metrics visible, but
 * do not count that comparison arm as an extra zero-result product anchor.
 */
function productPathSamples(samples: readonly RetrievalGateAnchorSample[]) {
  const translatedAnchorIds = new Set(
    samples
      .filter((sample) => sample.queryPath === "translated")
      .map(queryPathBaseAnchorId)
  );
  return samples.filter((sample) => !(
    sample.queryPath === "direct" && translatedAnchorIds.has(queryPathBaseAnchorId(sample))
  ));
}

function pooledRate(
  samples: readonly RetrievalGateAnchorSample[],
  predicate: (label: RetrievalGateLabel) => boolean
) {
  let count = 0;
  let total = 0;
  for (const sample of samples) {
    for (const result of topResults(sample)) {
      total += 1;
      if (predicate(result)) {
        count += 1;
      }
    }
  }
  return toRate(count, total);
}

function formatPercent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function evaluateRetrievalGate(
  samples: readonly RetrievalGateAnchorSample[]
): RetrievalGateReport {
  const productSamples = productPathSamples(samples);
  const humanitiesSamples = productSamples.filter((sample) => sample.domain === "humanities");
  const zhSamples = samples.filter((sample) => sample.language === "zh");
  const anchorMeanRelevance = meanAnchorRelevance(productSamples);
  const humanitiesMeanRelevance = meanAnchorRelevance(humanitiesSamples);

  const shortfalls: string[] = [];
  if (productSamples.length === 0) {
    shortfalls.push("样本为空，无法判断检索精度。");
  }
  if (productSamples.length > 0 && anchorMeanRelevance < gateRelevanceTarget) {
    shortfalls.push(
      `锚点 top-${gateTopResultCount} 相关率 ${formatPercent(anchorMeanRelevance)}，低于目标 ${formatPercent(gateRelevanceTarget)}。`
    );
  }
  if (humanitiesSamples.length === 0) {
    shortfalls.push("样本缺少人文社科分组，该领域的退化无法被这一轮发现。");
  } else if (humanitiesMeanRelevance < gateRelevanceTarget) {
    shortfalls.push(
      `人文社科锚点相关率 ${formatPercent(humanitiesMeanRelevance)}，低于目标 ${formatPercent(gateRelevanceTarget)}。`
    );
  }
  if (zhSamples.length === 0) {
    shortfalls.push("样本缺少中文锚点，无法比较直接检索与先译成英文两条路。");
  }

  return {
    anchorMeanRelevance,
    anchorsWithoutResults: productSamples
      .filter((sample) => sample.results.length === 0)
      .map((sample) => sample.anchorId),
    citationGraphCoverage: pooledRate(productSamples, (result) => result.hasCitationGraph),
    humanities: {
      anchorMeanRelevance: humanitiesMeanRelevance,
      sampleCount: humanitiesSamples.length
    },
    openAccessFullText: pooledRate(productSamples, (result) => result.openAccessFullText),
    passed: shortfalls.length === 0,
    shortfalls,
    topFiveRelevance: pooledRate(productSamples, (result) => result.relevant),
    zhByQueryPath: {
      direct: zhSamples.some((sample) => sample.queryPath === "direct")
        ? pooledRate(
            zhSamples.filter((sample) => sample.queryPath === "direct"),
            (result) => result.relevant
          )
        : emptyRate(),
      translated: zhSamples.some((sample) => sample.queryPath === "translated")
        ? pooledRate(
            zhSamples.filter((sample) => sample.queryPath === "translated"),
            (result) => result.relevant
          )
        : emptyRate()
    }
  };
}

export type RetrievalGateWorksheetRow = {
  hasCitationGraph?: unknown;
  openAccessFullText?: unknown;
  relevant?: unknown;
};

export type RetrievalGateWorksheet = {
  anchors: readonly {
    anchorId: string;
    domain?: unknown;
    language?: unknown;
    queryPath?: unknown;
    results?: readonly RetrievalGateWorksheetRow[];
  }[];
};

export type ParsedRetrievalGateWorksheet = {
  samples: RetrievalGateAnchorSample[];
  /** `anchorId#index` for every result still awaiting a human judgement. */
  unlabeled: string[];
};

/**
 * Reads a hand-labeled worksheet. Anything left unjudged is reported rather than assumed:
 * treating a blank as relevant would let an unfinished labeling pass the gate, which is
 * the one failure mode that would waste all the work downstream of it.
 */
export function parseRetrievalGateWorksheet(value: unknown): ParsedRetrievalGateWorksheet {
  const anchors = (value as RetrievalGateWorksheet | undefined)?.anchors;
  if (!Array.isArray(anchors)) {
    return { samples: [], unlabeled: [] };
  }
  const unlabeled: string[] = [];
  const samples = anchors.flatMap((anchor) => {
    const anchorId = typeof anchor?.anchorId === "string" ? anchor.anchorId : "";
    if (!anchorId) {
      return [];
    }
    const rawResults: readonly RetrievalGateWorksheetRow[] = Array.isArray(anchor.results)
      ? anchor.results
      : [];
    const results = rawResults.map((result, index) => {
      if (typeof result?.relevant !== "boolean") {
        unlabeled.push(`${anchorId}#${index}`);
      }
      return {
        hasCitationGraph: result?.hasCitationGraph === true,
        openAccessFullText: result?.openAccessFullText === true,
        relevant: result?.relevant === true
      };
    });
    return [{
      anchorId,
      domain: anchor.domain === "humanities" ? ("humanities" as const) : ("stem" as const),
      language: anchor.language === "zh" ? ("zh" as const) : ("en" as const),
      ...(anchor.queryPath === "direct" || anchor.queryPath === "translated"
        ? { queryPath: anchor.queryPath }
        : {}),
      results
    }];
  });
  return { samples, unlabeled };
}

export function formatRetrievalGateReport(report: RetrievalGateReport) {
  const lines = [
    `锚点 top-${gateTopResultCount} 相关率（正式产品路径，按锚点平均）：${formatPercent(report.anchorMeanRelevance)}`,
    `合计相关条目：${report.topFiveRelevance.count}/${report.topFiveRelevance.total}`,
    `可拿到引用图：${formatPercent(report.citationGraphCoverage.rate)}（${report.citationGraphCoverage.count}/${report.citationGraphCoverage.total}）`,
    `开放获取全文可得：${formatPercent(report.openAccessFullText.rate)}（${report.openAccessFullText.count}/${report.openAccessFullText.total}）`,
    `人文社科：${report.humanities.sampleCount} 个锚点，相关率 ${formatPercent(report.humanities.anchorMeanRelevance)}`,
    `中文直接检索：${formatPercent(report.zhByQueryPath.direct.rate)}（${report.zhByQueryPath.direct.count}/${report.zhByQueryPath.direct.total}）`,
    `中文先译再检索：${formatPercent(report.zhByQueryPath.translated.rate)}（${report.zhByQueryPath.translated.count}/${report.zhByQueryPath.translated.total}）`
  ];
  if (report.anchorsWithoutResults.length > 0) {
    lines.push(`无任何结果的锚点：${report.anchorsWithoutResults.join("、")}`);
  }
  lines.push(report.passed ? "验证门通过，可以继续做 UI。" : "验证门未通过：");
  for (const shortfall of report.shortfalls) {
    lines.push(`  - ${shortfall}`);
  }
  return lines.join("\n");
}
