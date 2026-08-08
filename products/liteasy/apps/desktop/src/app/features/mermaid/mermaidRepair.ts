function balance(value: string, open: string, close: string) {
  const missing = Math.max(0, [...value].filter((character) => character === open).length - [...value].filter((character) => character === close).length);
  return `${value}${close.repeat(missing)}`;
}

/** Conservative, deterministic repairs for syntax defects common in small-model output. */
export function autoRepairMermaid(code: string) {
  let repaired = code.trim()
    .replace(/^\s*graph\s+/im, "flowchart ")
    .replace(/(^|\n)\s*([A-Za-z0-9_:-]+)\s*->\s*/g, "$1$2 --> ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  if (!/^\s*(flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt)\b/im.test(repaired)) {
    repaired = `flowchart TD\n${repaired}`;
  }
  return balance(balance(balance(repaired, "[", "]"), "(", ")"), "{", "}");
}

export function buildMermaidRepairInstruction(code: string, diagnostic: string) {
  return [
    "你是 Mermaid 语法修复器。只返回可直接渲染的 Mermaid 源码，不要 Markdown 围栏、解释或新事实。",
    "保留原图的对象和关系；节点改为短文本。首行用 flowchart TD 或 flowchart LR，连线用 -->，所有括号必须成对。",
    `解析器诊断：${diagnostic}`,
    "待修复源码：",
    code
  ].join("\n");
}
