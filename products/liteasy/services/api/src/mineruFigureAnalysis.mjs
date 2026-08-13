const maximumResponseBytes = 2 * 1024 * 1024;
const structuredOutputFallbackStatuses = new Set([400, 422, 500, 502]);
const allowedImportance = new Set(["primary", "supporting", "reference"]);
const allowedKinds = new Set([
  "architecture", "chart", "comparison", "example", "formula", "result", "table", "workflow", "other"
]);
const allowedPlacement = new Set(["overview", "evidence", "method", "results"]);

const outputSchema = {
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

function responseUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

function buildInput(figures, paperTitle) {
  const content = [{
    text: [
      "Analyze every supplied research-paper figure for a concise Chinese thin reading.",
      `Paper: ${paperTitle || "Untitled paper"}.`,
      "Return JSON only. Cover every figure id. Do not invent values or conclusions that are not visible.",
      "Use primary for at most three figures central to the paper, supporting for useful method or evidence figures, and reference otherwise."
    ].join("\n"),
    type: "input_text"
  }];
  for (const figure of figures) {
    content.push({ text: `Figure ${figure.id}, page ${figure.page}.`, type: "input_text" });
    content.push({ detail: "high", image_url: figure.dataUrl, type: "input_image" });
  }
  return [{ content, role: "user" }];
}

async function readBoundedJson(response) {
  if (!response.body) throw new Error("model response body missing");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumResponseBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("model response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("model response has no output text");
}

function cleanText(value, fallback, maximum) {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maximum) : fallback;
}

function normalizeAnalysis(figure, value) {
  if (!value || typeof value !== "object" || value.id !== figure.id) return undefined;
  return {
    description: cleanText(value.description, "This figure provides supporting evidence from the paper.", 440),
    importance: allowedImportance.has(value.importance) ? value.importance : "reference",
    kind: allowedKinds.has(value.kind) ? value.kind : "other",
    placement: allowedPlacement.has(value.placement) ? value.placement : "evidence",
    selectionReason: cleanText(value.selectionReason, "Retained as traceable visual evidence.", 240),
    title: cleanText(value.title, figure.alt, 100)
  };
}

export async function analyzeMineruFigures({
  fetchImpl = fetch,
  figures,
  modelConfig,
  paperTitle,
  timeoutMs = 120_000
}) {
  if (!modelConfig?.apiKey || figures.length === 0) return { figures, status: "skipped" };
  const send = (includeFormat) => fetchImpl(responseUrl(modelConfig.baseUrl), {
    body: JSON.stringify({
      input: buildInput(figures, paperTitle),
      model: modelConfig.model,
      ...(includeFormat ? { text: {
        format: {
          name: "mineru_figure_analysis",
          schema: outputSchema,
          strict: true,
          type: "json_schema"
        }
      } } : {})
    }),
    headers: { Authorization: `Bearer ${modelConfig.apiKey}`, "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(Math.min(timeoutMs, 300_000))
  });
  let response = await send(true);
  if (structuredOutputFallbackStatuses.has(response.status)) {
    await response.body?.cancel?.().catch(() => {});
    response = await send(false);
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error(`model response status ${response.status}`);
  }
  const parsed = JSON.parse(outputText(await readBoundedJson(response)));
  const values = new Map(
    (Array.isArray(parsed?.figures) ? parsed.figures : [])
      .filter((item) => typeof item?.id === "string")
      .map((item) => [item.id, item])
  );
  const enriched = figures.map((figure) => {
    const analysis = normalizeAnalysis(figure, values.get(figure.id));
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
