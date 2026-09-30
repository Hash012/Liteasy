import { z } from "zod";
import { boundedJson } from "../extensions/extensionSchema";
/** Subflows are exact embedded definitions, expanded before compilation. No dynamic code lookup. */
export function expandSubflows(input: unknown, depth = 0): unknown {
  boundedJson(input);
  if (depth > 4) throw new Error("子流程嵌套不能超过四层。");
  if (!input || typeof input !== "object" || !Array.isArray((input as { nodes?: unknown[] }).nodes)) return input;
  type Binding = { source: string; nodeId?: string; path?: string; value?: unknown };
  type Node = { id: string; operation: { id: string }; input: Record<string, Binding>; map?: unknown; retries?: number; breakpoint?: boolean };
  type Flow = { nodes: Node[]; edges?: Array<{ from: string; to: string; when?: boolean }>; inputSchema: unknown; outputSchema: unknown; output: Binding; budget?: Record<string, number> };
  const flow = structuredClone(input) as Flow;
  const nodes: Node[] = [], edges = [...flow.edges ?? []];
  for (const node of flow.nodes) {
    if (node.operation?.id !== "core.subflow") { nodes.push(node); continue; }
    if (node.map || node.retries || Object.keys(node.input).some((key) => !["definition", "value"].includes(key)) || node.input.definition?.source !== "literal" || !node.input.value) throw new Error("子流程需要固定 definition 与 value 参数；迭代请在子流程内使用有界 map。");
    const child = expandSubflows(node.input.definition.value, depth + 1) as Flow;
    z.object({ schema: z.literal("liteasy.workflow/v2"), version: z.string().regex(/^\d+\.\d+\.\d+$/), nodes: z.array(z.unknown()).min(1).max(100) }).parse(child);
    const root = `${node.id}.input`, prefixed = (id: string) => `${node.id}.${id}`;
    const binding = (value: Binding): Binding => value.source === "input" ? { source: "node", nodeId: root, path: value.path ?? "" } : value.source === "node" ? { ...value, nodeId: prefixed(value.nodeId!) } : value;
    nodes.push({ ...node, id: root, operation: { id: "core.validate", version: "1.0.0" } as Node["operation"], input: { value: node.input.value, schema: { source: "literal", value: child.inputSchema } } });
    for (const item of child.nodes) {
      const mapped = { ...item, id: prefixed(item.id), input: Object.fromEntries(Object.entries(item.input).map(([key, value]) => [key, binding(value)])), ...(item.map ? { map: { ...item.map as object, items: binding((item.map as { items: Binding }).items) } } : {}) };
      nodes.push(mapped); edges.push({ from: root, to: mapped.id });
      // The parent result waits for all child operations, including independent writes.
      edges.push({ from: mapped.id, to: `${node.id}.complete` });
    }
    for (const edge of child.edges ?? []) edges.push({ ...edge, from: prefixed(edge.from), to: prefixed(edge.to) });
    // Incoming control edges must guard the child input as well as its result.
    for (const edge of flow.edges ?? []) if (edge.to === node.id) edges.push({ ...edge, to: root });
    nodes.push({ id: `${node.id}.complete`, title: "子流程完成", operation: { id: "core.join", version: "1.0.0" }, input: {} } as Node);
    edges.push({ from: `${node.id}.complete`, to: node.id });
    nodes.push({ ...node, operation: { id: "core.validate", version: "1.0.0" } as Node["operation"], input: { value: binding(child.output), schema: { source: "literal", value: child.outputSchema } }, breakpoint: false });
    // Nested budgets narrow the enclosing run; they cannot widen host limits.
    if (child.budget) flow.budget = Object.fromEntries(Object.entries({ ...flow.budget, ...child.budget }).map(([key, value]) => [key, Math.min(flow.budget?.[key] ?? value, child.budget?.[key] ?? value)]));
  }
  if (nodes.length > 100 || edges.length > 400) throw new Error("展开后的流程超过节点或连线限制。");
  return { ...flow, nodes, edges };
}
