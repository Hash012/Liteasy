import { createOpenAIResponsesProvider } from "./providers/openaiResponses.mjs";

const allowedKinds = new Set([
  "architecture",
  "chart",
  "comparison",
  "example",
  "formula",
  "result",
  "table",
  "workflow",
  "other"
]);
const allowedImportance = new Set(["primary", "supporting", "reference"]);
const allowedPlacement = new Set(["overview", "evidence", "method", "results"]);

export const mineruFigureAnalysisSchema = {
  additionalProperties: false,
  properties: {
    figures: {
      items: {
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          id: { type: "string" },
          importance: { enum: [...allowedImportance], type: "string" },
          kind: { enum: [...allowedKinds], type: "string" },
          placement: { enum: [...allowedPlacement], type: "string" },
          selectionReason: { type: "string" },
          title: { type: "string" }
        },
        required: ["id", "title", "description", "kind", "importance", "placement", "selectionReason"],
        type: "object"
      },
      type: "array"
    }
  },
  required: ["figures"],
  type: "object"
};

function cleanText(value, fallback, maximum = 280) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : fallback;
}

function parseJsonObject(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(normalized.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAnalysis(figure, value) {
  if (!value || typeof value !== "object") return null;
  const kind = allowedKinds.has(value.kind) ? value.kind : "other";
  const importance = allowedImportance.has(value.importance) ? value.importance : "reference";
  const placement = allowedPlacement.has(value.placement) ? value.placement : "evidence";
  return {
    description: cleanText(value.description, "该图表为原文提供补充证据。", 440),
    importance,
    kind,
    placement,
    selectionReason: cleanText(value.selectionReason, "保留为可追溯的原文视觉证据。", 240),
    title: cleanText(value.title, figure.alt, 100)
  };
}

function buildVisionInput(figures, paperTitle) {
  const content = [{
    text: [
      "你正在为研究论文生成一份可阅读的视觉薄读。",
      `论文：${paperTitle || "未命名论文"}。`,
      "下面的每张图片都来自 MinerU 的高清提取，必须逐一查看后再作答；不要根据文件名猜测。",
      "为每张图给出简明中文标题、它实际表达的内容、图表类别，以及它是否值得嵌入薄读正文。",
      "primary 只给最能解释论文核心论点的 1–3 张；supporting 给有助于解释方法或证据的图；其余标为 reference。",
      "placement 表示最自然的内嵌位置：overview、method、evidence 或 results。",
      "严格返回 JSON，所有 figure id 都要覆盖，且不要杜撰图中不可见的数值或结论。"
    ].join("\n"),
    type: "input_text"
  }];

  for (const figure of figures) {
    content.push({
      text: `图表 ${figure.id}（第 ${figure.page} 页，原始说明：${figure.alt}）`,
      type: "input_text"
    });
    content.push({
      detail: "high",
      image_url: figure.dataUrl,
      type: "input_image"
    });
  }

  return [{ content, role: "user" }];
}

export async function analyzeMineruFigures({
  apiBaseUrl,
  apiKey,
  figures,
  model,
  paperTitle,
  reasoningEffort,
  providerFactory = createOpenAIResponsesProvider
}) {
  if (!apiKey || figures.length === 0) {
    return { figures, status: "skipped" };
  }

  const provider = providerFactory({ apiBaseUrl, apiKey, reasoningEffort });
  const output = await provider({
    input: buildVisionInput(figures, paperTitle),
    model,
    outputFormat: {
      name: "mineru_figure_analysis",
      schema: mineruFigureAnalysisSchema,
      strict: true
    },
    reasoningEffort
  });
  const parsed = parseJsonObject(output);
  const analysesById = new Map(
    (Array.isArray(parsed?.figures) ? parsed.figures : [])
      .filter((item) => typeof item?.id === "string")
      .map((item) => [item.id, item])
  );
  const enriched = figures.map((figure) => {
    const analysis = normalizeAnalysis(figure, analysesById.get(figure.id));
    return analysis ? { ...figure, analysis } : figure;
  });

  return {
    figures: enriched,
    selectedFigureIds: enriched
      .filter((figure) => figure.analysis?.importance === "primary")
      .map((figure) => figure.id),
    status: "completed"
  };
}
