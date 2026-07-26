import { describe, expect, test } from "vitest";
import { parseCglDocument } from "../app/features/intuition-graph/cglParser";
import { serializeCglDocument } from "../app/features/intuition-graph/cglSerializer";
import { applyIntuitionGraphPatch } from "../app/features/intuition-graph/graphPatch";
import { projectIntuitionGraph } from "../app/features/layered-reading/graphProjection";
import { defaultGraphViewState } from "../app/features/layered-reading/layeredReading.types";

const validCgl = `Graph ColbertIntuition
version="liteasy-customized-graph/v1"
work="doi:10.1145/example"
root=Thesis

Node Thesis
Node Mechanism
Node Detail

Thesis {
  level=0
  kind=thesis
  label:"ColBERT 的核心结论"
  description:"延迟交互保留 token 级匹配。"
  evidence=["evidence-1"]
  source=paper(run="analysis-1")
  expandable=true
  tags=["retrieval"]
  to(id="thesis-mechanism", target=Mechanism, kind=expands, description="关键机制", evidence=["evidence-1"])
}

Mechanism {
  level=1
  kind=mechanism
  label:"MaxSim"
  description:"每个 query token 找到最匹配的 document token。"
  evidence=["evidence-2"]
  source=paper(run="analysis-1")
  expandable=true
  tags=["mechanism"]
  to(id="mechanism-detail", target=Detail, kind=expands, evidence=["evidence-2"])
}

Detail {
  level=2
  kind=evidence
  label:"效率证据"
  description:"文档表示可以提前计算。"
  evidence=["evidence-3"]
  source=paper(run="analysis-1")
  expandable=false
  tags=[]
}
`;

describe("CGL intuition graph", () => {
  test("parses, validates, and canonically serializes a documented graph", () => {
    const result = parseCglDocument(validCgl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);
    const reparsed = parseCglDocument(serializeCglDocument(result.graph));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.graph).toMatchObject({ id: "ColbertIntuition", rootNodeId: "Thesis", workId: "doi:10.1145/example" });
  });

  test("rejects an expands cycle and facts without evidence", () => {
    const result = parseCglDocument(validCgl
      .replace('to(id="mechanism-detail", target=Detail, kind=expands, evidence=["evidence-2"])', 'to(id="mechanism-thesis", target=Thesis, kind=expands, evidence=["evidence-2"])')
      .replace('evidence=["evidence-3"]', "evidence=[]"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/cycle|requires evidence/);
  });

  test("rejects a stale patch and applies an in-revision local upsert", () => {
    const result = parseCglDocument(validCgl);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const stale = applyIntuitionGraphPatch(result.graph, {
      version: "liteasy-intuition-graph-patch/v1", graphId: result.graph.id, baseRevision: 0, requestId: "request-1", focusNodeId: "Mechanism", targetLevel: 2,
      upsertNodes: [], upsertEdges: [], removeNodeIds: [], removeEdgeIds: [], explanation: "stale"
    });
    expect(stale).toMatchObject({ ok: false });
    const node = result.graph.nodes.find((item) => item.id === "Detail");
    if (!node) throw new Error("fixture node missing");
    const applied = applyIntuitionGraphPatch(result.graph, {
      version: "liteasy-intuition-graph-patch/v1", graphId: result.graph.id, baseRevision: 1, requestId: "request-2", focusNodeId: "Mechanism", targetLevel: 2,
      upsertNodes: [{ ...node, label: "效率证据（补充）" }], upsertEdges: [], removeNodeIds: [], removeEdgeIds: [], explanation: "补充 L2 证据"
    });
    expect(applied).toMatchObject({ ok: true, graph: { revision: 2 } });
  });

  test("keeps semantic level and topology radius independent", () => {
    const result = parseCglDocument(validCgl);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const radiusOne = projectIntuitionGraph(result.graph, { ...defaultGraphViewState, focusNodeId: "Thesis", graphRadius: 1, semanticLevel: 4 });
    const levelZero = projectIntuitionGraph(result.graph, { ...defaultGraphViewState, focusNodeId: "Thesis", graphRadius: 3, semanticLevel: 0 });
    expect(radiusOne.nodes.map((node) => node.id)).toEqual(["Thesis", "Mechanism"]);
    expect(levelZero.nodes.map((node) => node.id)).toEqual(["Thesis"]);
  });
});
