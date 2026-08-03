import {
  evaluateRetrievalGate,
  formatRetrievalGateReport,
  gateRelevanceTarget,
  parseRetrievalGateWorksheet,
  type RetrievalGateAnchorSample,
  type RetrievalGateLabel
} from "../app/features/retrieval/retrievalGateMetrics";

function label(overrides: Partial<RetrievalGateLabel> = {}): RetrievalGateLabel {
  return {
    hasCitationGraph: true,
    openAccessFullText: true,
    relevant: true,
    ...overrides
  };
}

function anchor(
  anchorId: string,
  relevantCount: number,
  overrides: Partial<RetrievalGateAnchorSample> = {}
): RetrievalGateAnchorSample {
  return {
    anchorId,
    domain: "stem",
    language: "en",
    results: Array.from({ length: 5 }, (_unused, index) =>
      label({ relevant: index < relevantCount })
    ),
    ...overrides
  };
}

/** A sample that satisfies the coverage requirements, so single metrics can be varied. */
function balancedSample(relevantPerAnchor: number): RetrievalGateAnchorSample[] {
  return [
    anchor("stem-1", relevantPerAnchor),
    anchor("hum-1", relevantPerAnchor, { domain: "humanities" }),
    anchor("zh-1", relevantPerAnchor, { language: "zh", queryPath: "direct" })
  ];
}

test("passes when every group clears the relevance target", () => {
  const report = evaluateRetrievalGate(balancedSample(4));

  expect(report.passed).toBe(true);
  expect(report.shortfalls).toEqual([]);
  expect(report.anchorMeanRelevance).toBeCloseTo(0.8);
  expect(report.topFiveRelevance).toEqual({ count: 12, rate: 0.8, total: 15 });
});

test("fails when three of five results per anchor are irrelevant", () => {
  const report = evaluateRetrievalGate(balancedSample(2));

  expect(report.passed).toBe(false);
  expect(report.anchorMeanRelevance).toBeCloseTo(0.4);
  expect(report.shortfalls[0]).toContain("低于目标");
});

test("refuses to pass a sample with no humanities papers", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    anchor("zh-1", 5, { language: "zh", queryPath: "direct" })
  ]);

  expect(report.passed).toBe(false);
  expect(report.shortfalls.some((entry) => entry.includes("人文社科分组"))).toBe(true);
  expect(report.humanities.sampleCount).toBe(0);
});

test("fails when humanities anchors alone fall short, even if the overall mean passes", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    anchor("stem-2", 5),
    anchor("stem-3", 5),
    anchor("hum-1", 1, { domain: "humanities" }),
    anchor("zh-1", 5, { language: "zh", queryPath: "direct" })
  ]);

  expect(report.anchorMeanRelevance).toBeGreaterThanOrEqual(gateRelevanceTarget);
  expect(report.passed).toBe(false);
  expect(report.shortfalls.some((entry) => entry.includes("人文社科锚点相关率"))).toBe(true);
});

test("refuses to pass without Chinese anchors, since the two query paths stay untested", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    anchor("hum-1", 5, { domain: "humanities" })
  ]);

  expect(report.passed).toBe(false);
  expect(report.shortfalls.some((entry) => entry.includes("中文锚点"))).toBe(true);
});

test("compares direct and translated retrieval for Chinese anchors", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    anchor("hum-1", 5, { domain: "humanities" }),
    anchor("zh-direct", 1, { language: "zh", queryPath: "direct" }),
    anchor("zh-translated", 4, { language: "zh", queryPath: "translated" })
  ]);

  expect(report.zhByQueryPath.direct).toEqual({ count: 1, rate: 0.2, total: 5 });
  expect(report.zhByQueryPath.translated).toEqual({ count: 4, rate: 0.8, total: 5 });
});

test("keeps a paired Chinese direct path as diagnostics instead of an extra product anchor", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    anchor("hum-1", 5, { domain: "humanities" }),
    {
      anchorId: "zh-shared:direct",
      domain: "stem",
      language: "zh",
      queryPath: "direct",
      results: []
    },
    anchor("zh-shared:translated", 4, { language: "zh", queryPath: "translated" })
  ]);

  expect(report.anchorMeanRelevance).toBeCloseTo((1 + 1 + 0.8) / 3);
  expect(report.topFiveRelevance).toEqual({ count: 14, rate: 14 / 15, total: 15 });
  expect(report.zhByQueryPath.direct).toEqual({ count: 0, rate: 0, total: 0 });
  expect(report.zhByQueryPath.translated).toEqual({ count: 4, rate: 0.8, total: 5 });
  expect(report.anchorsWithoutResults).toEqual([]);
});

test("an anchor that returned nothing counts as zero rather than being dropped", () => {
  const report = evaluateRetrievalGate([
    anchor("stem-1", 5),
    { anchorId: "stem-empty", domain: "stem", language: "en", results: [] },
    anchor("hum-1", 5, { domain: "humanities" }),
    anchor("zh-1", 5, { language: "zh", queryPath: "direct" })
  ]);

  expect(report.anchorsWithoutResults).toEqual(["stem-empty"]);
  // Three perfect anchors and one empty one: 3/4, not 100%.
  expect(report.anchorMeanRelevance).toBeCloseTo(0.75);
});

test("judges only the top five results of an anchor", () => {
  const report = evaluateRetrievalGate([
    {
      anchorId: "long",
      domain: "humanities",
      language: "zh",
      queryPath: "direct",
      // First five relevant, everything after irrelevant — the tail must not drag it down.
      results: [
        ...Array.from({ length: 5 }, () => label({ relevant: true })),
        ...Array.from({ length: 10 }, () => label({ relevant: false }))
      ]
    }
  ]);

  expect(report.anchorMeanRelevance).toBe(1);
  expect(report.topFiveRelevance.total).toBe(5);
});

test("measures citation-graph and open-access coverage separately from relevance", () => {
  const report = evaluateRetrievalGate([
    {
      anchorId: "mixed",
      domain: "humanities",
      language: "zh",
      queryPath: "direct",
      results: [
        label({ hasCitationGraph: true, openAccessFullText: false }),
        label({ hasCitationGraph: false, openAccessFullText: false }),
        label({ hasCitationGraph: true, openAccessFullText: true }),
        label({ hasCitationGraph: false, openAccessFullText: false }),
        label({ hasCitationGraph: true, openAccessFullText: false })
      ]
    }
  ]);

  expect(report.citationGraphCoverage).toEqual({ count: 3, rate: 0.6, total: 5 });
  expect(report.openAccessFullText).toEqual({ count: 1, rate: 0.2, total: 5 });
  // All five are relevant, so a poor full-text rate does not by itself fail the gate.
  expect(report.passed).toBe(true);
});

test("reports an empty sample as unable to judge rather than as a pass", () => {
  const report = evaluateRetrievalGate([]);

  expect(report.passed).toBe(false);
  expect(report.shortfalls[0]).toContain("样本为空");
});

test("prints every gate number and the reasons it failed", () => {
  const text = formatRetrievalGateReport(evaluateRetrievalGate(balancedSample(2)));

  expect(text).toContain("锚点 top-5 相关率（正式产品路径，按锚点平均）：40%");
  expect(text).toContain("可拿到引用图：100%");
  expect(text).toContain("开放获取全文可得：100%");
  expect(text).toContain("验证门未通过：");
});

test("reports unlabeled results instead of treating a blank as relevant", () => {
  const parsed = parseRetrievalGateWorksheet({
    anchors: [
      {
        anchorId: "zh-1",
        domain: "humanities",
        language: "zh",
        queryPath: "direct",
        results: [
          { hasCitationGraph: true, openAccessFullText: true, relevant: true },
          { hasCitationGraph: true, openAccessFullText: false, relevant: null },
          { hasCitationGraph: false, openAccessFullText: false }
        ]
      }
    ]
  });

  expect(parsed.unlabeled).toEqual(["zh-1#1", "zh-1#2"]);
  // The unjudged ones count as not relevant, so an unfinished sheet cannot pass.
  expect(parsed.samples[0].results.map((result) => result.relevant)).toEqual([true, false, false]);
  expect(evaluateRetrievalGate(parsed.samples).passed).toBe(false);
});

test("keeps the grouping a worksheet declares and defaults the rest conservatively", () => {
  const parsed = parseRetrievalGateWorksheet({
    anchors: [
      { anchorId: "a", domain: "humanities", language: "zh", queryPath: "translated", results: [] },
      { anchorId: "b", results: [] },
      { domain: "humanities", results: [] }
    ]
  });

  expect(parsed.samples).toHaveLength(2);
  expect(parsed.samples[0]).toMatchObject({ domain: "humanities", language: "zh", queryPath: "translated" });
  // No declared grouping means STEM/English, never the group we still need to prove.
  expect(parsed.samples[1]).toMatchObject({ domain: "stem", language: "en" });
  expect(parsed.samples[1].queryPath).toBeUndefined();
});

test("treats a malformed worksheet as no sample at all", () => {
  expect(parseRetrievalGateWorksheet(null).samples).toEqual([]);
  expect(parseRetrievalGateWorksheet({ anchors: "many" }).samples).toEqual([]);
});
