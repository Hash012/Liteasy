import { fileURLToPath } from "node:url";

const target = Object.freeze({
  id: "W2963341956",
  title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
});

const source = Object.freeze({
  id: "W3177828909",
  title: "Highly accurate protein structure prediction with AlphaFold"
});

const crossrefTarget = Object.freeze({
  doi: "10.1038/s41586-021-03819-2",
  titleFragment: "Highly accurate protein structure prediction with AlphaFold"
});

function openAlexWorkId(value) {
  if (typeof value !== "string") {
    return "";
  }
  const match = value.match(/(?:^|\/)W\d+$/i);
  return match ? match[0].replace(/^\//, "").toUpperCase() : "";
}

export function validateCitesTargetRecord(input) {
  const sourceId = openAlexWorkId(input.source?.id);
  const targetId = openAlexWorkId(input.target?.id);
  const sourceTitle = String(input.source?.display_name ?? "").trim();
  const referencedWorks = Array.isArray(input.source?.referenced_works)
    ? input.source.referenced_works.map(openAlexWorkId)
    : [];
  const issues = [];

  if (sourceId !== source.id) {
    issues.push(`source work ID changed: expected ${source.id}, received ${sourceId || "none"}`);
  }
  if (targetId !== target.id) {
    issues.push(`target work ID changed: expected ${target.id}, received ${targetId || "none"}`);
  }
  if (sourceTitle !== source.title) {
    issues.push(`source title changed: expected ${JSON.stringify(source.title)}, received ${JSON.stringify(sourceTitle)}`);
  }
  if (!referencedWorks.includes(target.id)) {
    issues.push(`OpenAlex no longer reports ${source.id} as citing ${target.id}`);
  }
  return issues;
}

async function fetchWork(id) {
  const response = await fetch(
    `https://api.openalex.org/works/${id}?select=id,display_name,referenced_works`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) {
    throw new Error(`OpenAlex returned ${response.status} for ${id}.`);
  }
  return response.json();
}

export async function runOpenAlexThinReadingLiveEval() {
  const [targetRecord, sourceRecord] = await Promise.all([
    fetchWork(target.id),
    fetchWork(source.id)
  ]);
  const issues = validateCitesTargetRecord({ source: sourceRecord, target: targetRecord });
  if (issues.length > 0) {
    throw new Error(`OpenAlex thin-reading live eval failed:\n- ${issues.join("\n- ")}`);
  }
  return { relation: "cites_target", sourceId: source.id, targetId: target.id };
}

export async function runCrossrefThinReadingLiveEval() {
  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(crossrefTarget.doi)}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) {
    throw new Error(`Crossref returned ${response.status} for ${crossrefTarget.doi}.`);
  }
  const record = (await response.json())?.message;
  const doi = String(record?.DOI ?? "").toLowerCase();
  const title = String(Array.isArray(record?.title) ? record.title[0] : "").trim();
  if (doi !== crossrefTarget.doi.toLowerCase() || !title.includes(crossrefTarget.titleFragment)) {
    throw new Error(`Crossref thin-reading live eval failed for ${crossrefTarget.doi}: received DOI=${JSON.stringify(doi)}, title=${JSON.stringify(title)}.`);
  }
  return { provider: "crossref", sourceId: doi, sourceRecordUrl: `https://api.crossref.org/works/${encodeURIComponent(doi)}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runOpenAlexThinReadingLiveEval()
    .then((result) => {
      console.log(`OpenAlex live eval passed: ${result.sourceId} ${result.relation} ${result.targetId}.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
