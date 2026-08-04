/**
 * Builds the labeling worksheet for the retrieval precision gate.
 *
 * Runs real retrieval for each sample anchor and writes every result out with `relevant`
 * left null, for a human to judge. What the machine can already tell — whether a citation
 * graph was available, whether the open-access full text is fetchable — is filled in, so
 * the labeling work is only the part that genuinely needs judgement.
 *
 *   node scripts/retrieval-gate-sample.mjs [--anchors <path>] [--out <path>] [--limit 5]
 *
 * Needs OPENALEX_API_KEY (services/dev-cloud/.env.local or the environment). Then label
 * the worksheet and read the verdict with:
 *
 *   LITEASY_RETRIEVAL_GATE_WORKSHEET=<path> npx vitest run src/tests/retrievalGateWorksheet.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../services/dev-cloud/config.mjs";
import { searchExternalKnowledge } from "../../services/dev-cloud/payloads/externalKnowledgePayloads.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const retrievalGateProtocolVersion = 2;

/** Relations that only exist because a citation graph was reachable. */
const citationGraphRelations = new Set([
  "bibliographic_coupling",
  "cited_by_target",
  "cites_target",
  "co_cited"
]);

function parseArgs(argv) {
  const args = { anchors: path.join(scriptDir, "retrieval-gate-anchors.json"), limit: 5, out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--anchors" || flag === "--out") {
      args[flag.slice(2)] = argv[index + 1] ?? "";
      index += 1;
    } else if (flag === "--limit") {
      args.limit = Number.parseInt(argv[index + 1] ?? "5", 10) || 5;
      index += 1;
    }
  }
  args.out = args.out || path.join(scriptDir, "retrieval-gate-worksheet.json");
  return args;
}

function hasCitationGraph(source) {
  return citationGraphRelations.has(source?.relation) ||
    Number.isFinite(source?.referencesCount) ||
    Number.isFinite(source?.citationCount);
}

function toWorksheetResult(source) {
  return {
    // Left null on purpose: an unjudged result must never count as relevant.
    relevant: null,
    hasCitationGraph: hasCitationGraph(source),
    openAccessFullText: Boolean(source?.fullTextUrl),
    provider: source?.provider ?? "",
    relation: source?.relation ?? "",
    sourceId: source?.id ?? "",
    title: source?.title ?? "",
    url: source?.url ?? ""
  };
}

/**
 * Mirrors what the service itself does: OpenAlex only when a key exists, with the free
 * providers and Semantic Scholar always enabled. Without OpenAlex there is no citation
 * graph, so that metric becomes an artifact of the configuration rather than a finding.
 */
function retrievalOptions(openAlexApiKey, semanticScholarApiKey) {
  return {
    allowCrossrefOnlyFallback: true,
    anchorReferenceMode: "exclusive",
    arxivEnabled: true,
    crossrefEnabled: true,
    doajEnabled: true,
    oapenEnabled: true,
    openAireEnabled: true,
    openAlexEnabled: Boolean(openAlexApiKey),
    semanticScholarEnabled: true,
    ...(openAlexApiKey ? { openAlexApiKey } : {}),
    ...(semanticScholarApiKey ? { semanticScholarApiKey } : {})
  };
}

async function retrieve(anchor, queryPath, query, options) {
  try {
    const payload = await searchExternalKnowledge(
      {
        ...(Array.isArray(anchor.anchorReferences) && anchor.anchorReferences.length > 0
          ? { anchorReferences: anchor.anchorReferences }
          : {}),
        limit: options.limit,
        query,
        ...(anchor.targetPaperTitle ? { targetPaperTitle: anchor.targetPaperTitle } : {}),
        // Without this the citation graph never expands: resolveTargetWork can only
        // reach the paper being read through a DOI or arXiv id.
        ...(anchor.targetPaperIdentity ? { targetPaperIdentity: anchor.targetPaperIdentity } : {})
      },
      retrievalOptions(options.openAlexApiKey, options.semanticScholarApiKey)
    );
    return {
      anchorId: queryPath ? `${anchor.anchorId}:${queryPath}` : anchor.anchorId,
      domain: anchor.domain === "humanities" ? "humanities" : "stem",
      language: anchor.language === "zh" ? "zh" : "en",
      ...(queryPath ? { queryPath } : {}),
      query,
      ...(payload?.anchorReferenceResolution
        ? { anchorReferenceResolution: payload.anchorReferenceResolution }
        : {}),
      results: (payload?.sources ?? []).slice(0, options.limit).map(toWorksheetResult)
    };
  } catch (error) {
    // A failed anchor stays in the sheet with no results: it must count as zero, because
    // dropping it would flatter the score exactly where retrieval failed hardest.
    return {
      anchorId: queryPath ? `${anchor.anchorId}:${queryPath}` : anchor.anchorId,
      domain: anchor.domain === "humanities" ? "humanities" : "stem",
      language: anchor.language === "zh" ? "zh" : "en",
      ...(queryPath ? { queryPath } : {}),
      error: error instanceof Error ? error.message : String(error),
      query,
      results: []
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const openAlexApiKey = process.env.OPENALEX_API_KEY?.trim() ?? "";
  const semanticScholarApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() ?? "";
  if (!openAlexApiKey) {
    process.stdout.write(
      "没有 OPENALEX_API_KEY，本轮只用 Crossref / arXiv / DOAJ / OpenAIRE / OAPEN。\n" +
        "注意：引用图这一项会因此接近 0，那是配置造成的，不是检索的结论。\n\n"
    );
  }
  const definition = JSON.parse(fs.readFileSync(args.anchors, "utf8"));
  const sampleAnchors = Array.isArray(definition?.anchors) ? definition.anchors : [];
  if (sampleAnchors.length === 0) {
    throw new Error(`样本集 ${args.anchors} 里没有锚点。`);
  }

  const options = { limit: args.limit, openAlexApiKey, semanticScholarApiKey };
  const anchors = [];
  for (const anchor of sampleAnchors) {
    if (anchor.language === "zh" && anchor.translatedQuery) {
      // The same Chinese anchor down both paths, so the comparison is like-for-like.
      anchors.push(await retrieve(anchor, "direct", anchor.query, options));
      anchors.push(await retrieve(anchor, "translated", anchor.translatedQuery, options));
    } else {
      anchors.push(await retrieve(anchor, undefined, anchor.query, options));
    }
    process.stdout.write(`已检索 ${anchor.anchorId}\n`);
  }

  const worksheet = {
    anchors,
    generatedAt: new Date().toISOString(),
    // Recorded so the numbers stay interpretable months later.
    activeSources: Object.entries(retrievalOptions(openAlexApiKey, semanticScholarApiKey))
      .filter(([name, value]) => name.endsWith("Enabled") && value === true)
      .map(([name]) => name.replace(/Enabled$/, "")),
    anchorReferenceMode: "exclusive",
    retrievalGateProtocolVersion,
    instruction:
      "逐条把 relevant 改成 true 或 false。留 null 的条目一律按不相关计，且验证门会因未完成打标而不通过。",
    limit: args.limit
  };
  fs.writeFileSync(args.out, `${JSON.stringify(worksheet, null, 2)}\n`, "utf8");

  const resultCount = anchors.reduce((total, anchor) => total + anchor.results.length, 0);
  const failed = anchors.filter((anchor) => anchor.error);
  process.stdout.write(
    `\n已写出打标表：${args.out}\n锚点 ${anchors.length} 个，待判断条目 ${resultCount} 条。\n`
  );
  if (failed.length > 0) {
    process.stdout.write(`检索失败的锚点 ${failed.length} 个：${failed.map((anchor) => anchor.anchorId).join("、")}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
