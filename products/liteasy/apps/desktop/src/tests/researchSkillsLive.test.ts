import { getDefaultModelForProvider } from "../app/features/models/modelPolicy";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { test, expect } from "vitest";
import { createDirectModelClient } from "../app/features/models/directModelClient";
import { loadResearchSkill, listResearchSkills } from "../app/features/research-skills/researchSkillCatalog";
import { generateResearchDocument } from "../app/features/research-skills/researchDocumentGeneration";
import { hashText } from "../app/features/context/objectContext";
const envPath = process.env.LITEASY_RESEARCH_LIVE_ENV;
/** Explicitly configured synthetic smoke; never enumerates the user's credential vault. */
test.skipIf(!envPath)("configured live model generates a bounded research card", async () => {
  const settings = parseEnv(await readFile(envPath!, "utf8"));
  const provider = settings.LITEASY_MODEL_PROVIDER || "openai";
  const apiKey = provider === "deepseek" ? settings.DEEPSEEK_API_KEY : settings.OPENAI_API_KEY;
  const endpoint = (provider === "deepseek" ? settings.DEEPSEEK_BASE_URL : settings.OPENAI_BASE_URL)?.replace(/\/$/, "");
  const model = (provider === "deepseek" ? settings.DEEPSEEK_MODEL : settings.OPENAI_MODEL) || getDefaultModelForProvider(provider);
  if (!apiKey || !endpoint || !model) throw new Error("Explicit live configuration incomplete; no request sent");
  const skill = await loadResearchSkill(listResearchSkills().find(skill => skill.id === "research-read")!.ref!);
  const source = "Synthetic experiment, not a published paper. Question: does caching reduce repeated lookup time? Method: twelve repeated lookups on one fixed synthetic table. Mean time without cache was 10 ms and with cache was 4 ms. No variance, hardware details, independent repetitions or ablation results were recorded. This fixture does not support generalization to production workloads.";
  let requests = 0;
  const usage: unknown[] = [];
  const generate = createDirectModelClient({ provider, endpoint, model, protocol: "openai", outputFormat: "prompt" }, async ({ config, body, signal }) => {
    requests++;
    const response = await fetch(`${config.endpoint}/chat/completions`, { method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`live_http_${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text); usage.push(parsed.usage ?? null);
    return text;
  });
  const started = performance.now();
  let status = "failed", reason = "", document;
  try {
    document = await generateResearchDocument({ skill, provider, model, generate, signal: AbortSignal.timeout(90000),
      invocation: { schema: "liteasy.skill-invocation/v1", requestId: "live-synthetic-one", scopeId: "live-synthetic", sessionGeneration: "one", skill: skill.ref, prompt: "用中文生成简洁研究卡。每节最多两句，清楚说明缺失数据；不要编造评估。", preset: { parameters: {} }, inputs: [{ role: "primary", refs: [{ objectId: "synthetic-paper", revision: "1" }] }], destination: { kind: "entry-child", canonicalEntryId: "synthetic-entry", paperId: "synthetic-paper", scopeId: "live-synthetic", title: "Synthetic caching fixture" }, origin: { kind: "workflow_entry", entryPoint: "live-smoke", initiatedBy: { type: "user", id: "explicit-test" } }, modelBindingId: "configured-live-binding", contextSnapshotId: "snapshot", budget: { inputTokens: 32000, outputTokens: 4000, repairAttempts: 1 } },
      snapshot: { snapshotId: "snapshot", scopeId: "live-synthetic", purpose: "research-read", createdAt: new Date().toISOString(), tokens: 150, entries: [{ ref: { objectId: "synthetic-paper", revision: "1" }, title: "Synthetic caching fixture", text: source, sha256: await hashText(source), tokens: 150, origin: "explicit", trustLabel: "source", extractor: "liteasy.text/v1" }] } });
    status = "passed";
  } catch (error) { reason = error instanceof Error ? error.message.slice(0, 500) : "generation_failed"; }
  const report = { status, provider, model, requests, usage, elapsedMs: Math.round(performance.now() - started), cost: "not_reported_by_provider", scientificQuality: "not_scored_synthetic_smoke_only", reason, draft: document?.draft };
  if (process.env.LITEASY_RESEARCH_LIVE_REPORT) await writeFile(process.env.LITEASY_RESEARCH_LIVE_REPORT, JSON.stringify(report, null, 2) + "\n");
  expect(status, reason).toBe("passed");
}, 110000);
