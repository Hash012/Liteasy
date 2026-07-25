import { CstParser, type CstNode, type IToken } from "chevrotain";
import {
  BooleanLiteral, Colon, Comma, cglTokens, Equal, Graph, Identifier, LCurly, LParen, LSquare, Node,
  NumberLiteral, RCurly, RParen, RSquare, StringLiteral, To, lexCgl
} from "./cglLexer";
import type { IntuitionGraphCompleteNode, IntuitionGraphDocument, IntuitionGraphEdge, IntuitionGraphNode, SemanticLevel } from "./intuitionGraph.types";
import { validateIntuitionGraph } from "./intuitionGraphValidator";

class CglParser extends CstParser {
  constructor() {
    super(cglTokens, { recoveryEnabled: true });
    this.performSelfAnalysis();
  }

  document = this.RULE("document", () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.item));
  });
  item = this.RULE("item", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.graphDecl) },
      { ALT: () => this.SUBRULE(this.nodeDecl) },
      { GATE: () => this.LA(2).tokenType === LCurly, ALT: () => this.SUBRULE(this.nodeBlock) },
      { ALT: () => this.SUBRULE(this.property) }
    ]);
  });
  graphDecl = this.RULE("graphDecl", () => { this.CONSUME(Graph); this.CONSUME(Identifier); });
  nodeDecl = this.RULE("nodeDecl", () => { this.CONSUME(Node); this.CONSUME(Identifier); });
  nodeBlock = this.RULE("nodeBlock", () => {
    this.CONSUME(Identifier); this.CONSUME(LCurly);
    this.MANY(() => this.SUBRULE(this.statement));
    this.CONSUME(RCurly);
  });
  statement = this.RULE("statement", () => this.OR([
    { ALT: () => this.SUBRULE(this.property) }, { ALT: () => this.SUBRULE(this.edgeCall) }
  ]));
  property = this.RULE("property", () => {
    this.CONSUME(Identifier); this.OR([{ ALT: () => this.CONSUME(Equal) }, { ALT: () => this.CONSUME(Colon) }]);
    this.SUBRULE(this.value);
  });
  edgeCall = this.RULE("edgeCall", () => {
    this.CONSUME(To); this.CONSUME(LParen); this.OPTION(() => this.SUBRULE(this.arguments)); this.CONSUME(RParen);
  });
  arguments = this.RULE("arguments", () => {
    this.SUBRULE(this.argument); this.MANY(() => { this.CONSUME(Comma); this.SUBRULE2(this.argument); });
  });
  argument = this.RULE("argument", () => { this.CONSUME(Identifier); this.CONSUME(Equal); this.SUBRULE(this.value); });
  value = this.RULE("value", () => this.OR([
    { ALT: () => this.CONSUME(NumberLiteral) }, { ALT: () => this.CONSUME(BooleanLiteral) },
    { ALT: () => this.CONSUME(StringLiteral) }, { ALT: () => this.SUBRULE(this.array) },
    { GATE: () => this.LA(2).tokenType === LParen, ALT: () => this.SUBRULE(this.call) },
    { ALT: () => this.CONSUME(Identifier) }
  ]));
  array = this.RULE("array", () => { this.CONSUME(LSquare); this.OPTION(() => { this.SUBRULE(this.value); this.MANY(() => { this.CONSUME(Comma); this.SUBRULE2(this.value); }); }); this.CONSUME(RSquare); });
  call = this.RULE("call", () => { this.CONSUME(Identifier); this.CONSUME(LParen); this.OPTION(() => this.SUBRULE(this.arguments)); this.CONSUME(RParen); });
}

const parser = new CglParser();
type CglValue = string | number | boolean | CglValue[] | { call: string; args: Record<string, CglValue> };
type RawBlock = { id: string; properties: Record<string, CglValue>; edges: Record<string, CglValue>[] };

function token(node: CstNode, key: string): IToken | undefined { return node.children[key]?.[0] as IToken | undefined; }
function child(node: CstNode, key: string): CstNode | undefined { return node.children[key]?.[0] as CstNode | undefined; }
function children(node: CstNode, key: string): CstNode[] { return (node.children[key] ?? []) as CstNode[]; }
function parseValue(node: CstNode): CglValue {
  const str = token(node, "StringLiteral"); if (str) return JSON.parse(str.image) as string;
  const num = token(node, "NumberLiteral"); if (num) return Number(num.image);
  const bool = token(node, "BooleanLiteral"); if (bool) return bool.image === "true";
  const id = token(node, "Identifier"); if (id) return id.image;
  const array = child(node, "array"); if (array) return children(array, "value").map(parseValue);
  const call = child(node, "call");
  if (call) return { call: token(call, "Identifier")?.image ?? "", args: parseArguments(child(call, "arguments")) };
  return "";
}
function parseArguments(node?: CstNode): Record<string, CglValue> {
  return Object.fromEntries(children(node ?? { children: {}, name: "empty" } as CstNode, "argument").map((arg) => [token(arg, "Identifier")?.image ?? "", parseValue(child(arg, "value")!)]));
}
function parseProperty(node: CstNode): [string, CglValue] { return [token(node, "Identifier")?.image ?? "", parseValue(child(node, "value")!)]; }
function asStrings(value: CglValue | undefined): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function asLevel(value: CglValue | undefined): SemanticLevel | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4 ? value as SemanticLevel : undefined; }
function sourceFrom(value: CglValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("call" in value)) return { type: "system", ruleId: "cgl-import" } as const;
  if (value.call === "paper" && typeof value.args.run === "string") return { type: "paper", analysisRunId: value.args.run } as const;
  if (value.call === "community" && typeof value.args.note === "string" && typeof value.args.author === "string") return { type: "community", intuitionNoteId: value.args.note, authorId: value.args.author } as const;
  if (value.call === "user" && typeof value.args.note === "string") return { type: "user", localNoteId: value.args.note } as const;
  return { type: "system", ruleId: "cgl-import" } as const;
}

export type CglParseResult =
  | { ok: true; graph: IntuitionGraphDocument }
  | { ok: false; errors: string[] };

export function parseCglDocument(input: string): CglParseResult {
  const lexed = lexCgl(input);
  if (lexed.errors.length) return { ok: false, errors: lexed.errors.map((error) => `L${error.line}:C${error.column} ${error.message}`) };
  parser.input = lexed.tokens;
  const cst = parser.document();
  if (parser.errors.length) return { ok: false, errors: parser.errors.map((error) => `L${error.token.startLine ?? 1}:C${error.token.startColumn ?? 1} ${error.message}`) };
  const graphDecl = children(cst, "item").map((item) => child(item, "graphDecl")).find(Boolean);
  const graphId = graphDecl ? token(graphDecl, "Identifier")?.image : undefined;
  const declarations = children(cst, "item").map((item) => child(item, "nodeDecl")).filter((value): value is CstNode => Boolean(value)).map((node) => token(node, "Identifier")?.image ?? "");
  const topProperties = children(cst, "item").map((item) => child(item, "property")).filter((value): value is CstNode => Boolean(value));
  const metadata = Object.fromEntries(topProperties.map(parseProperty));
  const blocks: RawBlock[] = children(cst, "item").map((item) => child(item, "nodeBlock")).filter((value): value is CstNode => Boolean(value)).map((block) => ({
    id: token(block, "Identifier")?.image ?? "",
    properties: Object.fromEntries(children(block, "statement").map((statement) => child(statement, "property")).filter((value): value is CstNode => Boolean(value)).map(parseProperty)),
    edges: children(block, "statement").map((statement) => child(statement, "edgeCall")).filter((value): value is CstNode => Boolean(value)).map((edge) => parseArguments(child(edge, "arguments")))
  }));
  const errors: string[] = [];
  if (!graphId) errors.push("CGL document must declare `Graph <id>`.");
  if (!declarations.length) errors.push("CGL document must declare at least one node.");
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const nodes: IntuitionGraphNode[] = declarations.map((id) => {
    const block = blockById.get(id);
    if (!block) return { id, status: "stub", label: id, expandable: true, tags: [] };
    const level = asLevel(block.properties.level);
    const description = block.properties.description;
    if (level === undefined || typeof description !== "string" || typeof block.properties.kind !== "string") {
      errors.push(`Node '${id}' must provide kind, level, and description.`);
      return { id, status: "stub", label: typeof block.properties.label === "string" ? block.properties.label : id, expandable: true, tags: asStrings(block.properties.tags) };
    }
    return {
      id, status: "complete", kind: block.properties.kind as IntuitionGraphCompleteNode["kind"], baseLevel: level,
      label: typeof block.properties.label === "string" ? block.properties.label : id, summary: description,
      hover: typeof block.properties.hover === "string" ? { text: block.properties.hover } : undefined,
      evidenceIds: asStrings(block.properties.evidence), source: sourceFrom(block.properties.source),
      confidence: typeof block.properties.confidence === "number" ? block.properties.confidence : undefined,
      expandable: typeof block.properties.expandable === "boolean" ? block.properties.expandable : false,
      tags: asStrings(block.properties.tags)
    };
  });
  blocks.forEach((block) => { if (!declarations.includes(block.id)) errors.push(`Node block '${block.id}' has no matching declaration.`); });
  const edges: IntuitionGraphEdge[] = blocks.flatMap((block) => block.edges.map((edge, index) => ({
    id: typeof edge.id === "string" ? edge.id : `${block.id}-${String(edge.target ?? "edge")}-${index}`,
    sourceNodeId: block.id, targetNodeId: typeof edge.target === "string" ? edge.target : "",
    kind: typeof edge.kind === "string" ? edge.kind as IntuitionGraphEdge["kind"] : "expands",
    label: typeof edge.description === "string" ? edge.description : undefined,
    hover: typeof edge.hover === "string" ? edge.hover : undefined, evidenceIds: asStrings(edge.evidence)
  })));
  const graph: IntuitionGraphDocument = {
    version: "liteasy-intuition-graph/v1", id: graphId ?? "invalid", workId: typeof metadata.work === "string" ? metadata.work : "",
    rootNodeId: typeof metadata.root === "string" ? metadata.root : declarations[0] ?? "", revision: 1, nodes, edges,
    provenance: { createdAt: new Date(0).toISOString(), generatedBy: "rule", analysisRunId: typeof metadata.analysisRun === "string" ? metadata.analysisRun : undefined }
  };
  const validation = validateIntuitionGraph(graph);
  errors.push(...validation.errors);
  return errors.length === 0 ? { ok: true, graph } : { ok: false, errors: [...new Set(errors)] };
}
