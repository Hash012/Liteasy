// Reuse the existing secret-loading/local dev-cloud lifecycle. Explicit invocation only.
const strategy = process.argv[2] ?? "all";
const runId = process.argv[3] ?? "initial";
if (!["all", "direct_model", "fixed_retrieval", "research_loop"].includes(strategy) || !/^[a-zA-Z0-9_-]{1,64}$/.test(runId)) {
  throw new Error("用法：node scripts/research-loop-eval.mjs [all|direct_model|fixed_retrieval|research_loop] [运行标识]");
}
process.env.LITEASY_RESEARCH_ABLATION_STRATEGY = strategy;
process.env.LITEASY_RESEARCH_ABLATION_RUN_ID = runId;
process.env.LITEASY_RESEARCH_LOOP_LIVE_EVAL = "1";
await import("./thin-reading-live-model-eval.mjs");
