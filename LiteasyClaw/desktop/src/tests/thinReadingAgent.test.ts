import { describe, expect, test } from "vitest";
import {
  buildThinReadingAgentPrompt,
  parseThinReadingModelSeed
} from "../app/features/thin-reading/thinReadingAgent";
import { classifyThinReadingPaper } from "../app/features/thin-reading/thinReadingPromptRegistry";
import type { PreparedMultiPaperAnalysis } from "../app/features/paper-analysis/analysis.types";
import type { ThinReadingGenerationContext } from "../app/features/thin-reading/thinReading.types";

const context: ThinReadingGenerationContext = {
  artifactId: "artifact-thin-agent",
  depth: 0,
  paperIds: ["paper-survey"],
  primaryPaperId: "paper-survey",
  primaryPaperTitle: "Survey of Vector Database Management Systems",
  source: { kind: "root_overview" },
  targetLanguage: "zh-CN"
};

const prepared: PreparedMultiPaperAnalysis = {
  citations: [
    { page: 2, paperId: "paper-survey", snippet: "This survey presents a taxonomy of vector database systems." }
  ],
  evidence: [
    {
      analysisRunId: "analysis-1",
      chunkId: "paper-survey:p2:chunk-1",
      id: "evidence-survey-taxonomy",
      page: 2,
      paperId: "paper-survey",
      paperTitle: "Survey of Vector Database Management Systems",
      quote: "This survey presents a taxonomy of vector database systems.",
      relevance: 0.9,
      retrievalReason: "query_overlap_within_selected_paper",
      summary: "这篇综述给出 vector database systems 的 taxonomy（分类框架）。",
      terms: ["survey", "taxonomy", "vector database"]
    }
  ],
  evidencePrompt: "[evidence-survey-taxonomy] Survey of Vector Database Management Systems p.2\n摘要：这篇综述给出 taxonomy。\n原文：This survey presents a taxonomy.",
  paperClaims: [],
  retrievalConfidence: 0.91,
  run: {
    coverage: {
      coveredPaperIds: ["paper-survey"],
      missingPaperIds: [],
      ratio: 1,
      selectedPaperIds: ["paper-survey"]
    },
    createdAt: "2026-07-28T00:00:00.000Z",
    id: "analysis-1",
    plan: {
      dimensions: ["研究问题", "方法", "实验与结果", "局限与分歧"],
      maxEvidencePerPaper: 1,
      maxTotalEvidence: 1,
      paperIds: ["paper-survey"],
      query: "生成薄读"
    },
    query: "生成薄读",
    status: "running"
  }
};

describe("thinReadingAgent", () => {
  test("classifies paper type from title and evidence for prompt guidance", () => {
    expect(classifyThinReadingPaper({
      evidencePrompt: prepared.evidencePrompt,
      title: "A Survey of Vector Database Management Systems"
    })).toBe("survey");
    expect(classifyThinReadingPaper({
      evidencePrompt: "The paper reports experiments, ablations, baseline comparisons, and accuracy gains.",
      title: "ColBERT: Efficient and Effective Passage Search"
    })).toBe("experimental");
  });

  test("builds a type-aware thin-reading prompt with the structured contract", () => {
    const prompt = buildThinReadingAgentPrompt({ context, prepared });

    expect(prompt).toContain("初步论文类型：综述型论文");
    expect(prompt).toContain("paperType");
    expect(prompt).toContain("summarySentences");
    expect(prompt).toContain("每个内容性句子都必须能追溯");
    expect(prompt).toContain("evidence-survey-taxonomy");
    expect(prompt).toContain("分类框架");
    expect(prompt).toContain("label 必须是短按钮文案");
    expect(prompt).toContain("不要复制整张 evidence 矩阵");
    expect(prompt).toContain("留存测试");
    expect(prompt).toContain("人工留存案例");
    expect(prompt.match(/信号：/g)).toHaveLength(3);
    expect(prompt).toContain("反摘要门控");
    expect(prompt).toContain("Skeptical audit");
    expect(prompt).toContain("读后留存测试");
  });

  test("includes parent claims and evidence spans when generating a branch", () => {
    const prompt = buildThinReadingAgentPrompt({
      context: {
        ...context,
        depth: 1,
        parentClaims: [
          {
            evidenceIds: ["evidence-survey-taxonomy"],
            id: "claim-parent-taxonomy",
            status: "grounded",
            text: "上一层判断认为 taxonomy 是这篇综述留给读者的主轴。"
          }
        ],
        parentEvidenceSpans: [
          {
            chunkId: "paper-survey:p2:chunk-1",
            confidence: 0.91,
            id: "evidence-survey-taxonomy",
            page: 2,
            paperId: "paper-survey",
            quote: "This survey presents a taxonomy of vector database systems."
          }
        ],
        parentNodeId: "thin-reading-root",
        parentSummary: "上一层总述聚焦 taxonomy。",
        parentTitle: "Survey overview",
        source: { kind: "omitted_section", label: "分类轴线", sectionKey: "taxonomy" }
      },
      prepared
    });

    expect(prompt).toContain("上一层关键判断");
    expect(prompt).toContain("claim-parent-taxonomy");
    expect(prompt).toContain("taxonomy 是这篇综述留给读者的主轴");
    expect(prompt).toContain("上一层论文内证据 span");
    expect(prompt).toContain("This survey presents a taxonomy");
    expect(prompt).toContain("本轮输出仍只能引用下方可用 evidence ID");
  });

  test("parses fenced JSON and validates evidence IDs against the current run", () => {
    const seed = parseThinReadingModelSeed(
      [
        "```json",
        JSON.stringify({
          externalKnowledge: [],
          claims: [
            {
              evidenceIds: ["evidence-survey-taxonomy"],
              status: "grounded",
              text: "这篇综述用 taxonomy 组织 vector database systems 的知识地图。"
            }
          ],
          omittedSections: [{ label: "分类轴线", sectionKey: "taxonomy" }],
          paperEvidence: ["evidence-survey-taxonomy"],
          paperType: "survey",
          recommendations: [
            {
              compatibility: 0.77,
              note: "本地待同步的分类框架理解线索。",
              relationship: "分类框架与问题设定"
            }
          ],
          summary: "这篇综述的核心不是给出单一系统方案，而是用 taxonomy（分类框架）组织 vector database systems 的知识地图。",
          summarySentences: [
            {
              evidenceIds: ["evidence-survey-taxonomy"],
              externalKnowledge: [],
              status: "grounded",
              text: "这篇综述的核心不是给出单一系统方案，而是用 taxonomy（分类框架）组织 vector database systems 的知识地图。"
            }
          ],
          withinPaperClosure: true
        }),
        "```"
      ].join("\n"),
      { analysisEvidence: prepared.evidence }
    );

    expect(seed).toMatchObject({
      evidence: {
        claims: [
          expect.objectContaining({
            evidenceIds: ["evidence-survey-taxonomy"],
            status: "grounded",
            text: expect.stringContaining("taxonomy")
          })
        ],
        paperEvidenceSpans: [
          expect.objectContaining({
            id: "evidence-survey-taxonomy",
            page: 2,
            paperId: "paper-survey",
            quote: expect.stringContaining("taxonomy")
          })
        ],
        summarySentences: [
          expect.objectContaining({
            evidenceIds: ["evidence-survey-taxonomy"],
            status: "grounded",
            text: expect.stringContaining("taxonomy")
          })
        ]
      },
      paperType: "survey",
      summary: expect.stringContaining("taxonomy"),
      withinPaperClosure: true
    });
    expect(seed.omittedSections[0]).toMatchObject({
      label: "分类轴线",
      sectionKey: "taxonomy"
    });
  });

  test("creates sentence-level evidence mapping when the model omits summarySentences", () => {
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [],
      omittedSections: [],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "survey",
      recommendations: [],
      summary: "第一句概括 taxonomy。第二句说明它组织知识地图。",
      withinPaperClosure: true
    }), {
      analysisEvidence: prepared.evidence
    });

    expect(seed.evidence.summarySentences).toEqual([
      expect.objectContaining({
        evidenceIds: ["evidence-survey-taxonomy"],
        text: "第一句概括 taxonomy。"
      }),
      expect.objectContaining({
        evidenceIds: ["evidence-survey-taxonomy"],
        text: "第二句说明它组织知识地图。"
      })
    ]);
  });

  test("requires explicit sentence traceability for live generation", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [{
        evidenceIds: ["evidence-survey-taxonomy"],
        status: "grounded",
        text: "taxonomy 是核心贡献。"
      }],
      omittedSections: [],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "survey",
      recommendations: [],
      summary: "这篇综述用 taxonomy 组织 vector database systems，并明确了研究空白。",
      withinPaperClosure: true
    }), {
      analysisEvidence: prepared.evidence,
      requireExplicitTraceability: true
    })).toThrow("summarySentences 必须显式覆盖正文");
  });

  test("rejects live sentence evidence omitted from the top-level evidence set", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [{
        evidenceIds: ["evidence-listed"],
        status: "grounded",
        text: "taxonomy 是核心贡献。"
      }],
      omittedSections: [],
      paperEvidence: ["evidence-listed"],
      paperType: "survey",
      recommendations: [],
      summary: "这篇综述用 taxonomy 组织 vector database systems，并明确了研究空白。",
      summarySentences: [{
        evidenceIds: ["evidence-unlisted"],
        externalKnowledge: [],
        status: "grounded",
        text: "这篇综述用 taxonomy 组织 vector database systems，并明确了研究空白。"
      }],
      withinPaperClosure: true
    }), {
      allowedEvidenceIds: ["evidence-listed", "evidence-unlisted"],
      requireExplicitTraceability: true
    })).toThrow("未列入 paperEvidence");
  });

  test("rebuilds sentence evidence mapping when model summarySentences drift from the displayed summary", () => {
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [],
      omittedSections: [],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "survey",
      recommendations: [],
      summary: "第一句概括 taxonomy。第二句说明它组织知识地图。",
      summarySentences: [
        {
          evidenceIds: ["evidence-survey-taxonomy"],
          externalKnowledge: [],
          status: "grounded",
          text: "模型另写了一句不存在于正文中的解释。"
        }
      ],
      withinPaperClosure: true
    }), {
      analysisEvidence: prepared.evidence
    });

    expect(seed.evidence.summarySentences).toEqual([
      expect.objectContaining({
        evidenceIds: ["evidence-survey-taxonomy"],
        text: "第一句概括 taxonomy。"
      }),
      expect.objectContaining({
        evidenceIds: ["evidence-survey-taxonomy"],
        text: "第二句说明它组织知识地图。"
      })
    ]);
  });

  test("normalizes long omitted section labels from live model output", () => {
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [],
      omittedSections: [
        {
          label: "ACORN-γ 与 ACORN-1 的详细构造与搜索算法",
          sectionKey: "method_details"
        },
        {
          label: "相关工作（预过滤、后过滤、专用索引）",
          sectionKey: "related_work"
        }
      ],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "systems",
      recommendations: [],
      summary: "这篇论文的核心是通过 ACORN 图结构改造混合向量检索，使谓词过滤下的近似最近邻搜索保持高召回与高吞吐。",
      withinPaperClosure: true
    }), {
      analysisEvidence: prepared.evidence
    });

    expect(seed.omittedSections[0]).toMatchObject({
      label: "ACORN-γ 与 ACORN-1 的详细构造与搜索算法",
      sectionKey: "method_details"
    });
    expect(seed.omittedSections[1]).toMatchObject({
      label: "相关工作",
      sectionKey: "related_work"
    });
  });

  test("accepts and normalizes live model output with many paper evidence references", () => {
    const manyEvidence = Array.from({ length: 18 }, (_, index) => ({
      analysisRunId: "analysis-many",
      chunkId: `paper-acorn:p${index + 1}:chunk-1`,
      id: `evidence-${index + 1}-acorn`,
      page: index + 1,
      paperId: "paper-acorn",
      paperTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
      quote: `ACORN evidence quote ${index + 1}.`,
      relevance: 0.82,
      retrievalReason: "query_overlap_within_selected_paper",
      summary: `ACORN evidence summary ${index + 1}.`,
      terms: ["ACORN"]
    }));
    const evidenceReferences = manyEvidence.map((item, index) =>
      index % 2 === 0 ? item.id : `${item.id} 支撑 ACORN 的混合搜索论证`
    );
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      claims: [
        {
          evidenceIds: [
            "evidence-1-acorn",
            "evidence-2-acorn 与 evidence-3-acorn 共同支撑"
          ],
          status: "grounded",
          text: "ACORN 用图结构调整支持谓词无关的混合向量搜索。"
        }
      ],
      omittedSections: [{ label: "实验设置", sectionKey: "experiment_setup" }],
      paperEvidence: evidenceReferences,
      paperType: "systems",
      recommendations: [],
      summary: "ACORN 的核心贡献是通过图结构和搜索策略改造，让混合向量检索在谓词过滤场景下仍能保持高召回与高吞吐。",
      withinPaperClosure: true
    }), {
      analysisEvidence: manyEvidence
    });

    expect(seed.evidence.paperEvidence).toHaveLength(18);
    expect(seed.evidence.paperEvidence[0]).toBe("evidence-1-acorn");
    expect(seed.evidence.paperEvidenceSpans).toHaveLength(18);
    expect(seed.evidence.claims?.[0]?.evidenceIds).toEqual([
      "evidence-1-acorn",
      "evidence-2-acorn",
      "evidence-3-acorn"
    ]);
  });

  test("rejects thin-reading output without paper or external evidence markers", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      omittedSections: [],
      paperEvidence: [],
      paperType: "unknown",
      recommendations: [],
      summary: "这段总述长度足够，但没有任何论文内证据或外部知识来源标记。",
      withinPaperClosure: true
    }))).toThrow("缺少论文内证据或外部知识来源标记");
  });

  test("rejects paperEvidence that is outside the available evidence matrix", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      omittedSections: [],
      paperEvidence: ["evidence-from-another-run"],
      paperType: "experimental",
      recommendations: [],
      summary: "ColBERT 的核心贡献是用 MaxSim late interaction 保留 token-level matching signals。",
      withinPaperClosure: true
    }), {
      allowedEvidenceIds: ["evidence-current-run"]
    })).toThrow("paperEvidence 引用了不可用的 evidence ID");
  });

  test("rejects grounded claims that reference evidence outside the current run", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      claims: [
        {
          evidenceIds: ["evidence-other-run"],
          status: "grounded",
          text: "这个判断错误地引用了另一轮证据。"
        }
      ],
      externalKnowledge: [],
      omittedSections: [],
      paperEvidence: ["evidence-current-run"],
      paperType: "experimental",
      recommendations: [],
      summary: "ColBERT 的核心贡献是用 MaxSim late interaction 保留 token-level matching signals。",
      withinPaperClosure: true
    }), {
      allowedEvidenceIds: ["evidence-current-run"]
    })).toThrow("claims.evidenceIds 引用了不可用的 evidence ID");
  });

  test("creates a fallback synthesis claim when the model omits claims", () => {
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      omittedSections: [],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "survey",
      recommendations: [],
      summary: "这篇综述用 taxonomy 组织 vector database systems 的知识地图。",
      withinPaperClosure: true
    }), {
      analysisEvidence: prepared.evidence
    });

    expect(seed.evidence.claims?.[0]).toMatchObject({
      evidenceIds: ["evidence-survey-taxonomy"],
      status: "grounded",
      text: expect.stringContaining("taxonomy")
    });
  });

  test("marks the node outside the paper closure when retrieval coverage is insufficient", () => {
    const weakPrepared: PreparedMultiPaperAnalysis = {
      ...prepared,
      retrievalConfidence: 0.62,
      run: {
        ...prepared.run,
        coverage: {
          ...prepared.run.coverage,
          missingPaperIds: ["paper-missing"],
          ratio: 0.5
        }
      }
    };
    const seed = parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: [],
      omittedSections: [],
      paperEvidence: ["evidence-survey-taxonomy"],
      paperType: "survey",
      recommendations: [],
      summary: "这篇综述用 taxonomy 组织 vector database systems 的知识地图。",
      withinPaperClosure: true
    }), {
      analysis: weakPrepared
    });

    expect(seed.withinPaperClosure).toBe(false);
  });

  test("rejects external source ids that were not returned by this retrieval turn", () => {
    expect(() => parseThinReadingModelSeed(JSON.stringify({
      externalKnowledge: ["openalex:W-INVENTED"],
      omittedSections: [],
      paperEvidence: [],
      paperType: "survey",
      recommendations: [],
      summary: "后续工作扩展了这套分类，并在新的任务与数据集上验证了它的适用边界。",
      summarySentences: [{
        evidenceIds: [],
        externalKnowledge: ["openalex:W-INVENTED"],
        status: "weak",
        text: "后续工作扩展了这套分类，并在新的任务与数据集上验证了它的适用边界。"
      }],
      withinPaperClosure: false
    }), {
      externalSources: [{
        abstract: "A traceable source.",
        authors: ["A. Author"],
        id: "openalex:W-ALLOWED",
        provider: "openalex",
        relation: "topic_search",
        relevance: 0.8,
        retrievalQuery: "taxonomy follow-up",
        sourceId: "W-ALLOWED",
        title: "Allowed source",
        url: "https://openalex.org/W-ALLOWED"
      }]
    })).toThrow("本轮检索中不存在");
  });
});
