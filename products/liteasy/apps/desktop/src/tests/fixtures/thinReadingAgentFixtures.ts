export const v2ModelOutput = {
  anchors: [],
  claims: [{
    evidenceIds: ["evidence-survey-taxonomy"],
    status: "grounded",
    text: "向量数据库系统的分类框架组织了关键设计取舍。"
  }],
  externalKnowledge: [],
  omittedSections: [],
  paperEvidence: ["evidence-survey-taxonomy"],
  paperType: "survey",
  recommendedFigures: [],
  summary: "这篇综述给出向量数据库系统的分类框架，并据此组织关键设计取舍和研究边界。",
  summarySentences: [{
    evidenceIds: ["evidence-survey-taxonomy"],
    externalKnowledge: [],
    status: "grounded",
    text: "这篇综述给出向量数据库系统的分类框架，并据此组织关键设计取舍和研究边界。"
  }],
  visualizationIntent: {
    candidateModalities: ["semantic_graph"],
    evidenceIds: ["evidence-survey-taxonomy"],
    expectedLearningGain: "high",
    purpose: "explain_structure",
    requestedBy: "automatic"
  },
  withinPaperClosure: true
} as const;

export const intentWithUnknownEvidence = {
  ...v2ModelOutput,
  visualizationIntent: {
    ...v2ModelOutput.visualizationIntent,
    evidenceIds: ["evidence-not-reviewed"]
  }
} as const;

export function modelReturning(output: unknown) {
  return {
    generateAnswer: async () => ({ answer: JSON.stringify(output) })
  };
}
