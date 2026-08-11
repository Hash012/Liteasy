import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  runVisualizationDecisionPlanner,
  visualizationDecisionOutputJsonSchema,
} from "../src/app/features/visualization/visualizationDecisionPlanner";
import { parseMultimodalDecisionEvaluationDataset } from "../src/app/features/visualization/visualizationDecisionEvaluation";
import { VisualizationProviderGateway } from "../../../services/api/src/visualizationProviderGateway.mjs";
import { EnvironmentVisualizationSecretStore } from "../../../services/api/src/visualizationSecretStore.mjs";
import { productionVisualizationProviderAdapters } from "../../../services/api/src/visualizationStructuredProviderAdapter.mjs";

const caseSchema = z.object({
  evidence: z.array(z.object({
    id: z.string().min(1).max(120),
    page: z.number().int().positive(),
    quote: z.string().min(8).max(8_000)
  }).strict()).min(1).max(12),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  question: z.string().min(8).max(1_000),
  reviewZh: z.object({
    evidence: z.array(z.object({
      id: z.string().min(1).max(120),
      text: z.string().min(8).max(8_000)
    }).strict()).min(1).max(12),
    question: z.string().min(8).max(1_000),
    title: z.string().min(3).max(300)
  }).strict(),
  targetLanguage: z.enum(["en-US", "zh-CN"]),
  title: z.string().min(3).max(300)
}).strict();

const casesSchema = z.object({
  cases: z.array(caseSchema).min(1),
  schema: z.literal("liteasy.multimodal-decision-cases/v1")
}).strict();

function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return resolve(process.cwd(), index >= 0 ? process.argv[index + 1] : fallback);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function previousReviews(path: string) {
  try {
    const previous = parseMultimodalDecisionEvaluationDataset(JSON.parse(await readFile(path, "utf8")));
    return new Map(previous.records.map((record) => [record.caseId, record]));
  } catch {
    return new Map();
  }
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesPath = argument(
  "--cases",
  resolve(desktopRoot, "../../../../development/test-data/thin-reading-multimodal/planner-decision-cases.v1.json")
);
const outputPath = argument(
  "--out",
  resolve(desktopRoot, "../../../../development/test-data/thin-reading-multimodal/planner-decision-evaluation.v2.json")
);
const routeValue = process.env.LITEASY_VISUALIZATION_DECISION_ROUTE?.trim();
if (!routeValue) throw new Error("LITEASY_VISUALIZATION_DECISION_ROUTE is required");
const route = JSON.parse(routeValue);
const endpoint = new URL(route.endpoint);
const inputCases = casesSchema.parse(JSON.parse(await readFile(casesPath, "utf8")));
if (new Set(inputCases.cases.map(({ id }) => id)).size !== inputCases.cases.length) {
  throw new Error("multimodal_decision_case_duplicate");
}

const gateway = new VisualizationProviderGateway({
  adapters: productionVisualizationProviderAdapters,
  egressPolicy: { allowedHostnames: [endpoint.hostname] },
  secretStore: new EnvironmentVisualizationSecretStore(process.env)
});
const prior = await previousReviews(outputPath);
const recordedAt = new Date().toISOString();
const schemaSha256 = sha256(canonicalJson(visualizationDecisionOutputJsonSchema));
const records = [];

for (const input of inputCases.cases) {
  let plannerAttempt = 0;
  const planning = await runVisualizationDecisionPlanner({
    evidence: input.evidence,
    generate: async ({ prompt, schema, schemaName }) => {
      plannerAttempt += 1;
      return gateway.generateStructured({
        dataClass: "paper",
        invocationId: `decision_eval_${input.id}_${plannerAttempt}`,
        modality: "semantic_graph",
        payload: { prompt, schema, schemaName },
        route
      });
    },
    question: input.question,
    requestedBy: "automatic",
    title: input.title
  });
  const attempts = planning.attempts.map((attempt) => ({
    accepted: attempt.accepted,
    promptSha256: sha256(attempt.prompt),
    ...(attempt.rejectionReason ? { rejectionReason: attempt.rejectionReason } : {}),
    responseSha256: sha256(attempt.response)
  }));
  const finalResponse = planning.attempts[planning.attempts.length - 1].response;
  const output = planning.decision;
  const promptSha256 = sha256(planning.basePrompt);
  const responseSha256 = sha256(finalResponse);
  const previous = prior.get(input.id);
  const recordInput = {
    evidence: input.evidence,
    question: input.question,
    targetLanguage: input.targetLanguage,
    title: input.title
  };
  const review = previous && canonicalJson(previous.input) === canonicalJson(recordInput)
    ? previous.review
    : null;
  records.push({
    caseId: input.id,
    input: recordInput,
    providerRecording: {
      attempts,
      endpoint: route.endpoint,
      model: route.model,
      plannerContract: "liteasy.visualization-decision-planner/v1",
      promptSha256,
      providerId: route.providerId,
      recordedAt,
      response: { output, sha256: responseSha256 },
      routeId: route.routeId,
      schemaSha256
    },
    review,
  });
  process.stdout.write(
    `${input.id}: ${planning.intent ? `generate ${planning.intent.candidateModalities.join(",")} (${planning.decision.basis})` : `omit (${planning.decision.basis})`}\n`
  );
}

const dataset = parseMultimodalDecisionEvaluationDataset({
  protocolVersion: 2,
  records,
  schema: "liteasy.multimodal-decision-evaluation/v2"
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
process.stdout.write(`Recorded ${records.length} production-planner decisions to ${outputPath}\n`);
