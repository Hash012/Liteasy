import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { evaluateVisualizationBenchmark } from "./benchmark-visualization.mjs";
import { renderBiologyStructure } from "../src/app/features/visualization/renderers/biologyStructureRenderer";
import { renderCircuit } from "../src/app/features/visualization/renderers/circuitRenderer";
import { renderFunctionPlot } from "../src/app/features/visualization/renderers/functionPlotRenderer";
import { renderGeometry2D } from "../src/app/features/visualization/renderers/geometry2dRenderer";
import { renderGeometry3D } from "../src/app/features/visualization/renderers/geometry3dRenderer";
import { renderPhysicsDiagram } from "../src/app/features/visualization/renderers/physicsDiagramRenderer";
import { renderPhysicsProcess } from "../src/app/features/visualization/renderers/physicsProcessRenderer";
import { renderRasterIllustration } from "../src/app/features/visualization/renderers/rasterIllustrationRenderer";
import { renderReactionProcess } from "../src/app/features/visualization/renderers/reactionProcessRenderer";
import { renderSemanticGraph } from "../src/app/features/visualization/renderers/semanticGraphRenderer";
import {
  rasterIllustrationBrowserFixture
} from "../src/tests/fixtures/rasterIllustrationBrowserFixture";
import type {
  EvidenceBindingV1,
  SemanticObjectV1,
  VisualizationModality,
  VisualizationSpecV1
} from "../src/app/features/visualization/visualizationArtifact.types";

type ConformanceProposal = {
  accessibility: { objectReadingOrder: string[]; summary: string };
  evidenceBindings: EvidenceBindingV1[];
  interaction: { selectableObjectIds: string[] };
  semanticObjects: SemanticObjectV1[];
  spec: VisualizationSpecV1;
};

type LoadedFixture = {
  proposal: ConformanceProposal;
  sourceEvidenceIds: Set<string>;
  sourceFile: string;
};

type RenderOutput = {
  accessibility?: { summary?: string };
  selectableObjectIds?: readonly string[];
  summary?: string;
  svg?: string;
};

const expectedModalities = [
  "semantic_graph",
  "circuit",
  "physics_diagram",
  "biology_structure",
  "function_plot",
  "geometry_2d",
  "geometry_3d",
  "physics_process",
  "reaction_process",
  "raster_illustration"
] as const satisfies readonly VisualizationModality[];

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(desktopRoot, "../../../..");

const renderers: Record<string, (fixture: LoadedFixture) => RenderOutput> = {
  biology_structure: ({ proposal }) => renderBiologyStructure(proposal.spec.payload as never),
  circuit: ({ proposal }) => renderCircuit(proposal.spec.payload as never),
  function_plot: ({ proposal }) => renderFunctionPlot(proposal.spec.payload as never),
  geometry_2d: ({ proposal }) => renderGeometry2D(proposal.spec.payload as never),
  geometry_3d: ({ proposal }) => renderGeometry3D(proposal.spec.payload as never),
  physics_diagram: ({ proposal }) => renderPhysicsDiagram(proposal.spec.payload as never),
  physics_process: ({ proposal }) => renderPhysicsProcess(proposal.spec.payload as never),
  raster_illustration: () => renderRasterIllustration(rasterIllustrationBrowserFixture),
  reaction_process: ({ proposal }) => renderReactionProcess(proposal.spec.payload as never),
  semantic_graph: ({ proposal }) => renderSemanticGraph(proposal.spec.payload as never, {
    evidenceBindings: proposal.evidenceBindings,
    semanticObjects: proposal.semanticObjects
  })
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function listJsonFiles(directory: string): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  });
}

function loadConformanceFixtures(fixturesDirectory: string): Map<string, LoadedFixture> {
  const fixtures = new Map<string, LoadedFixture>();
  for (const path of listJsonFiles(fixturesDirectory)) {
    let parsed: {
      modalities?: Record<string, { valid?: ConformanceProposal }>;
      source?: { evidence?: { id?: string }[] };
    };
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!parsed.modalities || !parsed.source?.evidence) continue;
    const sourceEvidenceIds = new Set(parsed.source.evidence.flatMap((item) => item.id ? [item.id] : []));
    for (const [modality, entry] of Object.entries(parsed.modalities)) {
      if (!entry.valid || entry.valid.spec?.modality !== modality || fixtures.has(modality)) continue;
      fixtures.set(modality, { proposal: entry.valid, sourceEvidenceIds, sourceFile: path });
    }
  }
  return fixtures;
}

function rasterFixture(): LoadedFixture {
  const claimId = rasterIllustrationBrowserFixture.evidenceClaimIds[0];
  const evidenceId = "raster-browser-png";
  return {
    proposal: {
      accessibility: {
        objectReadingOrder: rasterIllustrationBrowserFixture.labels.map((label) => label.id),
        summary: rasterIllustrationBrowserFixture.visualSchema
      },
      evidenceBindings: [{ claimId, confidence: "direct", evidenceIds: [evidenceId] }],
      interaction: { selectableObjectIds: rasterIllustrationBrowserFixture.labels.map((label) => label.id) },
      semanticObjects: rasterIllustrationBrowserFixture.labels.map((label) => ({
        evidenceClaimIds: [...label.evidenceClaimIds],
        kind: "raster_label",
        label: label.text,
        objectId: label.id,
        objectPath: [label.id],
        selectable: true
      })),
      spec: { modality: "raster_illustration", payload: rasterIllustrationBrowserFixture }
    },
    sourceEvidenceIds: new Set([evidenceId]),
    sourceFile: "src/tests/fixtures/rasterIllustrationBrowserFixture.tsx"
  };
}

function evidenceCoverage(fixture: LoadedFixture) {
  const bindingByClaim = new Map(fixture.proposal.evidenceBindings.map((binding) => [binding.claimId, binding]));
  const factualObjects = fixture.proposal.semanticObjects.filter((object) => object.evidenceClaimIds.length > 0);
  const evidenceBoundObjects = factualObjects.filter((object) => object.evidenceClaimIds.every((claimId) => {
    const binding = bindingByClaim.get(claimId);
    return binding && binding.evidenceIds.length > 0 && binding.evidenceIds.every((id) => fixture.sourceEvidenceIds.has(id));
  }));
  return {
    evidenceBoundObjectCount: evidenceBoundObjects.length,
    factualObjectCount: factualObjects.length
  };
}

function sameIds(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return [...actual].sort().every((id, index) => id === [...expected].sort()[index]);
}

function measureRender(fixture: LoadedFixture, iterations: number) {
  const modality = fixture.proposal.spec.modality;
  const renderer = renderers[modality];
  if (!renderer) throw new Error("visualization_benchmark_renderer_missing");
  const renderSamplesMs: number[] = [];
  const outputDigests: string[] = [];
  let hardGate: "fail" | "pass" = "pass";
  const diagnostics: string[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    const output = renderer(fixture);
    renderSamplesMs.push(Number((performance.now() - startedAt).toFixed(3)));
    outputDigests.push(digest(output));
    const summary = output.accessibility?.summary ?? output.summary;
    if (!summary || !sameIds(output.selectableObjectIds, fixture.proposal.interaction.selectableObjectIds)) {
      hardGate = "fail";
      diagnostics.push("visualization_projection_contract_invalid");
    }
    if (modality !== "raster_illustration" && (!output.svg || !output.svg.includes("<svg"))) {
      hardGate = "fail";
      diagnostics.push("visualization_projection_svg_missing");
    }
  }

  const coverage = evidenceCoverage(fixture);
  if (coverage.factualObjectCount === 0 || coverage.evidenceBoundObjectCount !== coverage.factualObjectCount) {
    hardGate = "fail";
    diagnostics.push("visualization_projection_evidence_invalid");
  }
  return {
    ...coverage,
    diagnostics: [...new Set(diagnostics)],
    hardGate,
    modality,
    outputDigests,
    renderSamplesMs,
    sourceFile: fixture.sourceFile
  };
}

function normalizeAssetPath(fromFile: string, specifier: string): string {
  return resolve(dirname(fromFile), specifier);
}

function staticImports(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\bfrom\s*["'](\.\.?\/[^"']+)["']/g,
    /\bimport\s*["'](\.\.?\/[^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports];
}

function inspectBuild(distDirectory: string) {
  const diagnostics: string[] = [];
  const indexPath = join(distDirectory, "index.html");
  if (!existsSync(indexPath)) {
    return { diagnostics: ["visualization_build_index_missing"], inspected: false, initialChunks: [], threeChunkFiles: [], threeInitialChunk: null };
  }
  const html = readFileSync(indexPath, "utf8");
  const entryMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i) ??
    html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i);
  if (!entryMatch) {
    return { diagnostics: ["visualization_build_entry_missing"], inspected: false, initialChunks: [], threeChunkFiles: [], threeInitialChunk: null };
  }
  const entryPath = resolve(distDirectory, entryMatch[1].replace(/^\//, ""));
  const initialFiles = new Set<string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (initialFiles.has(current)) continue;
    if (!existsSync(current)) {
      diagnostics.push(`visualization_build_chunk_missing:${relative(distDirectory, current)}`);
      continue;
    }
    initialFiles.add(current);
    const source = readFileSync(current, "utf8");
    for (const specifier of staticImports(source)) pending.push(normalizeAssetPath(current, specifier));
  }

  const assetsDirectory = join(distDirectory, "assets");
  const jsFiles = existsSync(assetsDirectory)
    ? readdirSync(assetsDirectory).filter((name) => name.endsWith(".js")).map((name) => join(assetsDirectory, name))
    : [];
  const threeChunkFiles = jsFiles.filter((path) => {
    const source = readFileSync(path, "utf8");
    return source.includes("WebGLRenderer") && source.includes("Matrix4");
  });
  if (threeChunkFiles.length === 0) diagnostics.push("visualization_three_chunk_missing");
  const threeInitialChunk = threeChunkFiles.some((path) => initialFiles.has(path));
  return {
    diagnostics,
    inspected: diagnostics.length === 0,
    initialChunks: [...initialFiles].map((path) => relative(distDirectory, path)).sort(),
    initialTransferBytes: [...initialFiles].reduce((sum, path) => sum + statSync(path).size, 0),
    threeChunkFiles: threeChunkFiles.map((path) => relative(distDirectory, path)).sort(),
    threeInitialChunk
  };
}

export function runVisualizationBenchmark(options: {
  distDirectory?: string;
  fixturesDirectory?: string;
  iterations?: number;
} = {}) {
  const fixturesDirectory = resolve(options.fixturesDirectory ?? resolve(
    repositoryRoot,
    "development/test-data/thin-reading-multimodal"
  ));
  const distDirectory = resolve(options.distDirectory ?? resolve(desktopRoot, "dist"));
  const iterations = Number(options.iterations ?? 7);
  if (!Number.isInteger(iterations) || iterations < 2 || iterations > 50) {
    throw new Error("visualization_benchmark_iterations_invalid");
  }
  const diagnostics: string[] = [];
  const fixtures = loadConformanceFixtures(fixturesDirectory);
  fixtures.set("raster_illustration", rasterFixture());
  const results = [];
  for (const modality of expectedModalities) {
    const fixture = fixtures.get(modality);
    if (!fixture) continue;
    try {
      results.push(measureRender(fixture, iterations));
    } catch (error) {
      results.push({
        diagnostics: [error instanceof Error ? error.message : "visualization_benchmark_render_failed"],
        evidenceBoundObjectCount: 0,
        factualObjectCount: fixture.proposal.semanticObjects.length,
        hardGate: "fail",
        modality,
        outputDigests: [],
        renderSamplesMs: [],
        sourceFile: fixture.sourceFile
      });
    }
  }
  if (!existsSync(fixturesDirectory)) diagnostics.push("visualization_fixture_directory_missing");
  return evaluateVisualizationBenchmark({ build: inspectBuild(distDirectory), diagnostics, results });
}

function main() {
  const report = runVisualizationBenchmark({
    distDirectory: argValue("--dist"),
    fixturesDirectory: argValue("--fixtures"),
    iterations: Number(argValue("--iterations") ?? 7)
  });
  const out = argValue("--out");
  if (out) writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (report.hardGate !== "pass") process.exitCode = 1;
}

if (!process.env.VITEST && !process.env.VITEST_WORKER_ID) {
  main();
}
