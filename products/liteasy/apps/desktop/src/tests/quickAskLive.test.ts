import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "vitest";
import { createQuickAskService } from "../app/features/pdf/quickAskService";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { validateDirectModelConfig, type DirectModelConfig } from "../app/features/models/modelProviders";
import type { QuickAskGenerationReceipt } from "../app/features/pdf/pdfQuickAsk";

const authorized = process.env.LITEASY_QUICKASK_LIVE_ALLOW_PAID === "explicitly-authorized" && !!process.env.LITEASY_QUICKASK_LIVE_CONFIG;
/** Opt-in only. Credentials come solely from the explicitly supplied file, never the user's vault. */
test.skipIf(!authorized)("live restricted Quick Ask: five synthetic tasks, three independent attempts each", async () => {
  let configuration: DirectModelConfig; let apiKey: string;
  try {
    const json = JSON.parse(await readFile(process.env.LITEASY_QUICKASK_LIVE_CONFIG!, "utf8"));
    configuration = validateDirectModelConfig({ provider: json.provider, endpoint: json.endpoint, model: json.model, protocol: json.protocol ?? "openai", outputFormat: "prompt" });
    if (typeof json.apiKey !== "string" || !json.apiKey.trim() || /[\r\n]/.test(json.apiKey)) throw new Error("invalid");
    apiKey = json.apiKey;
  } catch { throw new Error("Explicit live configuration is invalid; no credentials or configuration are printed."); }
  const settings = { ...createSettingsStore().getState(), "models.connection_mode": "direct" as const, "models.direct_provider": configuration.provider,
    "models.direct_model": configuration.model, "models.direct_endpoint": configuration.endpoint, "models.direct_protocol": configuration.protocol, "models.direct_output_format": "prompt" as const };
  const results: Array<Record<string, unknown>> = [];
  const tasks = ["Explain the selected equation in one sentence.", "Give one tiny numerical example.", "Derive the equation in at most three short lines.", "Translate the selected text into Chinese only.", "State one limitation, in one sentence."];
  for (const [taskIndex, question] of tasks.entries()) for (let repetition = 0; repetition < 3; repetition++) {
    let attempts = 0; let receipt: QuickAskGenerationReceipt | undefined;
    const started = performance.now();
    try {
      const service = createQuickAskService({ getSettings: () => settings, directTransport: async ({ config, body, signal, onChunk }) => {
        attempts++;
        const response = await fetch(`${config.endpoint}/${config.protocol === "anthropic" ? "messages" : "chat/completions"}`, { method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", ...(config.protocol === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${apiKey}` }) }, body: JSON.stringify(body) });
        if (!response.ok || !response.body) throw new Error("live_transport_failed");
        const reader = response.body.getReader();
        try { while (true) { const item = await reader.read(); if (item.done) break; onChunk?.(item.value); } }
        finally { await reader.cancel().catch(() => {}); }
        return "";
      } });
      const answer = await service.run({ paper: { id: "synthetic-linear", title: "Synthetic linear equation" }, page: 1, source: { scopeId: "live-synthetic", paperId: "synthetic-linear", documentRevision: "synthetic-v1", extractorRevision: "fixture-v1" },
        excerpt: "For constant speed v, distance equals speed times time: d = v t.", question, pageText: "For constant speed v, distance equals speed times time: d = v t.", abstractText: "", signal: AbortSignal.timeout(60000), onReceipt: value => { receipt = value; } });
      results.push({ task: taskIndex + 1, repetition: repetition + 1, status: answer.trim() && receipt?.terminal === "completed" && attempts === 1 ? "passed" : "failed", terminal: receipt?.terminal ?? "unknown", modelAttempts: attempts, elapsedMs: performance.now() - started, contextPrepareMs: receipt?.contextPrepareMs, firstTokenMs: receipt?.firstTokenMs, inputTokenEstimate: receipt?.context.inputTokenEstimate, providerId: receipt?.providerId, modelId: receipt?.modelId });
    } catch {
      results.push({ task: taskIndex + 1, repetition: repetition + 1, status: "failed", terminal: receipt?.terminal ?? "unknown", modelAttempts: attempts, elapsedMs: performance.now() - started, reason: "transport_or_terminal_validation_failed" });
    }
  }
  const report = { status: results.every(row => row.status === "passed") ? "passed" : "failed", syntheticOnly: true, strongModelComparison: "not_run_no_authorization", results };
  if (process.env.LITEASY_QUICKASK_LIVE_REPORT) await writeFile(process.env.LITEASY_QUICKASK_LIVE_REPORT, JSON.stringify(report, null, 2));
  expect(results.every(row => row.status === "passed")).toBe(true);
}, 16 * 60000);
