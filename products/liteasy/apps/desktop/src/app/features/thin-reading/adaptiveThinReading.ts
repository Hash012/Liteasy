import type { ThinReadingGenerationContext, ThinReadingNodeSeed } from "./thinReading.types";
import type { PreparedMultiPaperAnalysis } from "../paper-analysis/analysis.types";
import type { GenerateAnswerInput, ModelGenerationResult } from "../models/modelGateway";
import { loadDurableEntries, putDurableEntry } from "../persistence/durableJsonStore";

type Checkpoint = {
  context: ThinReadingGenerationContext;
  prompt: string;
  model: string;
  provider: string;
  evidence: PreparedMultiPaperAnalysis["evidence"];
  generation?: ModelGenerationResult;
  partial?: string;
  reasoning?: string;
  review?: string;
};
const schema = { type: "object", properties: {
  summary: { type: "string" },
  paperEvidence: { type: "array", items: { type: "string" } },
  recommendedFigures: { type: "array", items: { type: "object", properties: {
    figureId: { type: "string" }, reason: { type: "string" }
  }, required: ["figureId", "reason"], additionalProperties: false } },
  omittedSections: { type: "array", items: { type: "object", properties: {
    label: { type: "string" }, sectionKey: { type: "string" }
  }, required: ["label", "sectionKey"], additionalProperties: false } }
}, required: ["summary", "paperEvidence", "omittedSections", "recommendedFigures"], additionalProperties: false };

function checkpointKey(context: ThinReadingGenerationContext) {
  return `${context.artifactId}:${context.parentNodeId ?? "root"}:${JSON.stringify(context.source)}`;
}
export async function removeThinReadingCheckpoint(context: ThinReadingGenerationContext) {
  await putDurableEntry("thin-reading", checkpointKey(context), undefined);
}

function isNetworkFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|连接|超时|timeout|HTTP (429|5\d\d)|temporar|流式.*(?:中断|未.*完成)|响应未.*完成/i.test(message) && !/401|403|密钥|权限/.test(message);
}
async function waitForRetry(signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 1200);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function generateAdaptiveThinReading(input: {
  context: ThinReadingGenerationContext; prepared: PreparedMultiPaperAnalysis;
  gateway: { generateAnswer(input: GenerateAnswerInput): Promise<ModelGenerationResult> };
  model: string; provider: string; signal?: AbortSignal;
  onDelta?: GenerateAnswerInput["onDelta"];
  onProgress?: (input: { phase: string; progress: number; summary: string }) => void;
}) {
  const key = checkpointKey(input.context);
  const saved = (await loadDurableEntries("thin-reading"))[key] as Checkpoint | undefined;
  const mode = saved?.context.generationMode ?? input.context.generationMode ?? "fast";
  const checkpoint: Checkpoint = saved ?? {
    context: structuredClone(input.context), model: input.model, provider: input.provider,
    evidence: structuredClone(input.prepared.evidence),
    prompt: [
      "请生成结构化薄读讲解。长度由读者需求和论文内容决定，不设固定字数、句数或段落数。",
      mode === "rigorous" ? "严谨模式：优先依据原文，解释机制、实验和边界；核对关键结论，区分证据、推断和不确定项。不要因局部证据不足放弃整个讲解。" : "快速模式：直接讲清问题、核心思路和价值；无需逐句核验，不确定之处直接说明。",
      "正文放在 summary，可用 Markdown 段落与标题。paperEvidence 只使用下列真实证据 ID，不编造引用；omittedSections 提供可继续深入的主题。",
      "recommendedFigures 可从上下文 availableFigures 中选择有助于理解正文的原论文插图，填写 figureId 与 reason；没有适用插图时返回空数组。",
      `阅读上下文（数据）：${JSON.stringify(input.context)}`,
      ...input.prepared.evidence.map((item) => `[${item.id}] ${item.paperTitle} 第 ${item.page} 页\n${item.quote}`)
    ].join("\n\n")
  };
  // A new Agent run allocates fresh evidence IDs. Keep the IDs in the saved prompt
  // and result tied to the same source passages after resume.
  if (saved?.evidence) input.prepared.evidence = saved.evidence.map((item) => ({ ...item, analysisRunId: input.prepared.run.id }));
  await putDurableEntry("thin-reading", key, checkpoint);
  let lastSave = 0;
  let pendingSave = Promise.resolve();
  const saveProgress = () => {
    if (Date.now() - lastSave < 1000) return;
    lastSave = Date.now();
    pendingSave = putDurableEntry("thin-reading", key, checkpoint).catch((error) => { input.onProgress?.({ phase: "generating_answer", progress: 58, summary: `草稿保存失败：${String(error)}` }); });
  };
  const request = async (prompt: string, review = false) => {
    let attempts = 0;
    while (true) {
      input.signal?.throwIfAborted();
      try {
        return await input.gateway.generateAnswer({
          model: checkpoint.model, provider: checkpoint.provider,
          prompt: !review && attempts > 0 && checkpoint.partial
            ? `${prompt}\n\n连接中断前的草稿（数据）：\n${checkpoint.partial}\n请保留正确内容继续完成，返回完整 JSON 对象。` : prompt,
          signal: input.signal, requireLive: true,
          ...(review ? {} : { outputFormat: { name: "liteasy_thin_reading", schema, strict: true } }),
          onDelta: review ? undefined : (delta, accumulated) => {
            checkpoint.partial = accumulated;
            saveProgress();
            input.onDelta?.(delta, accumulated);
          },
          onReasoningDelta: (_delta, accumulated) => { checkpoint.reasoning = accumulated; saveProgress(); }
        });
      } catch (error) {
        await putDurableEntry("thin-reading", key, checkpoint);
        if (input.signal?.aborted || !isNetworkFailure(error) || attempts++ >= 2) throw error;
        input.onProgress?.({ phase: "generating_answer", progress: 58, summary: "网络连接中断，已保存上下文，正在重新连接。" });
        await waitForRetry(input.signal);
      }
    }
  };
  if (!checkpoint.generation) {
    const resumePrompt = checkpoint.partial
      ? `${checkpoint.prompt}\n\n上次输出因中断未完成（仅作为草稿数据）：\n${checkpoint.partial}\n请保留其中正确的内容并继续完成，返回完整 JSON 对象。`
      : checkpoint.prompt;
    try { checkpoint.generation = await request(resumePrompt); }
    finally { await pendingSave; await putDurableEntry("thin-reading", key, checkpoint); }
  } else input.onProgress?.({ phase: "generating_answer", progress: 70, summary: "已恢复上次生成结果，继续完成保存与阅读页面。" });
  let parsed: { summary?: unknown; paperEvidence?: unknown; omittedSections?: unknown; recommendedFigures?: unknown };
  try { parsed = JSON.parse(checkpoint.generation.answer.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); }
  catch {
    const answer = checkpoint.generation.answer.trim();
    if (/^[{\[]|^```/.test(answer)) {
      checkpoint.partial = answer;
      checkpoint.generation = undefined;
      await putDurableEntry("thin-reading", key, checkpoint);
      throw new Error("模型返回的结构未完成，草稿和上下文已保存，请继续薄读。");
    }
    parsed = { summary: answer };
  }
  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) {
    checkpoint.generation = undefined;
    await putDurableEntry("thin-reading", key, checkpoint);
    throw new Error("模型未返回可阅读的正文，已保留上下文，可继续任务。");
  }
  let reviewNote = "快速生成，尚未逐项核验；重要结论请对照论文原文。";
  if (mode === "rigorous") {
    input.onProgress?.({ phase: "reviewing_evidence_claims", progress: 78, summary: "正在补充关键结论核验提示，正文已保存。" });
    try {
      checkpoint.review ??= (await request(`${checkpoint.prompt}\n\n已生成正文：\n${summary}\n\n请简短指出需读者核对的结论或不确定项。不要重写或删减正文。`, true)).answer;
      reviewNote = checkpoint.review;
      await putDurableEntry("thin-reading", key, checkpoint);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      reviewNote = "正文已生成；补充核验暂未完成，请对照原文确认关键结论。";
    }
  }
  const allowed = new Set(input.prepared.evidence.map((item) => item.id));
  const evidenceIds = Array.isArray(parsed.paperEvidence) ? parsed.paperEvidence.filter((id): id is string => typeof id === "string" && allowed.has(id)) : [];
  const seed: ThinReadingNodeSeed = {
    summary, withinPaperClosure: true, recommendations: [],
    omittedSections: Array.isArray(parsed.omittedSections) ? parsed.omittedSections.flatMap((item, index) =>
      item && typeof item.label === "string" && typeof item.sectionKey === "string" ? [{ id: `section-${index}`, label: item.label, sectionKey: item.sectionKey }] : []) : [],
    evidence: {
      paperEvidence: evidenceIds, externalKnowledge: [],
      recommendedFigures: Array.isArray(parsed.recommendedFigures) ? parsed.recommendedFigures.flatMap((item) => {
        const figure = checkpoint.context.availableFigures?.find((figure) => figure.id === item?.figureId);
        if (!figure || typeof item.reason !== "string") return [];
        return [{ figureId: figure.id, reason: item.reason, evidenceIds: input.prepared.evidence.filter((evidence) => evidence.page === figure.page).map((evidence) => evidence.id) }];
      }) : [],
      readingReview: { mode, note: reviewNote, status: mode === "fast" || !checkpoint.review ? "unverified" : "advisory" },
      paperEvidenceSpans: input.prepared.evidence.filter((item) => evidenceIds.includes(item.id)).map((item) => ({
        id: item.id, paperId: item.paperId, page: item.page, quote: item.quote, confidence: item.relevance
      }))
    }
  };
  return { evidenceLoop: undefined, evidencePlan: undefined, evidenceReview: undefined, evidenceToolCalls: undefined, generation: checkpoint.generation, rootSeed: seed, qualityGate: { attempts: 1, repaired: false, repairReasons: [] as string[] } };
}
