import {
  runCrossrefThinReadingLiveEval,
  runOpenAlexThinReadingLiveEval
} from "./thin-reading-openalex-live-eval.mjs";
import { requireOpenAlexApiKey } from "../../../../../development/dev-cloud/config.mjs";
import { searchExternalKnowledge } from "../../../../../development/dev-cloud/payloads/externalKnowledgePayloads.mjs";

async function runExternalAggregatorLiveEval() {
  const openAlexApiKey = requireOpenAlexApiKey();
  const result = await searchExternalKnowledge({
    limit: 8,
    query: "multimodal retrieval benchmark"
  }, { openAlexApiKey });
  const providers = new Set(result.sources.map((source) => source.provider));
  const crossrefSources = result.sources.filter((source) => source.provider === "crossref");
  if (!providers.has("openalex") || crossrefSources.length === 0 ||
    crossrefSources.some((source) => source.relation !== "topic_search")) {
    throw new Error("External aggregator live eval did not return traceable OpenAlex and Crossref topic sources.");
  }
  return { crossrefCount: crossrefSources.length, sourceCount: result.sources.length };
}

export async function runThinReadingExternalKnowledgeLiveEval() {
  const [aggregator, openAlex, crossref] = await Promise.all([
    runExternalAggregatorLiveEval(),
    runOpenAlexThinReadingLiveEval(),
    runCrossrefThinReadingLiveEval()
  ]);
  return { aggregator, crossref, openAlex };
}

runThinReadingExternalKnowledgeLiveEval()
  .then((result) => {
    console.log(`External knowledge live eval passed: ${result.openAlex.sourceId} ${result.openAlex.relation} ${result.openAlex.targetId}; Crossref ${result.crossref.sourceId}; aggregator ${result.aggregator.crossrefCount}/${result.aggregator.sourceCount} Crossref sources.`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
