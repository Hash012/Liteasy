import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { autoRepairMermaid, buildMermaidRepairInstruction } from "./mermaidRepair";

export { autoRepairMermaid, buildMermaidRepairInstruction } from "./mermaidRepair";

export type MermaidValidation = {
  code: string;
  error?: string;
  isValidating: boolean;
  repaired: boolean;
  repairInstruction?: string;
  suggestions: string[];
};

function repairSuggestions(code: string, error: string) {
  const suggestions: string[] = [];
  if (!/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt)\b/im.test(code)) {
    suggestions.push("第一行需要声明图类型，例如：flowchart TD 或 flowchart LR。");
  }
  if (/parse error|expecting|got/i.test(error)) {
    suggestions.push("逐行检查箭头两侧是否都有节点；流程图可使用 A[节点文字] --> B[节点文字]。");
  }
  if (/bracket|parenthesis|end of input/i.test(error) || /[\[\](){}]/.test(code)) {
    suggestions.push("检查方括号、圆括号和花括号是否成对；节点中的复杂标点可改为短文本。");
  }
  if (/undefined|unknown|diagram/i.test(error)) {
    suggestions.push("确认图类型拼写，并使用 Mermaid 支持的语法；不确定时先改成 flowchart TD。");
  }
  return suggestions.length > 0 ? suggestions : ["从报错行开始逐步简化：先保留图类型和一条 A --> B 连线，再逐项加回节点和标签。"];
}

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const line = raw.match(/(?:line|on line)\s+(\d+)/i)?.[1];
  const concise = raw.replace(/\s+/g, " ").slice(0, 360);
  return line ? `第 ${line} 行附近：${concise}` : concise;
}


/**
 * Keeps Mermaid validation independent of rendering so editors, thin reading and
 * other visual surfaces can use the same error interception and repair guidance.
 */
export function useMermaidValidation(code: string): MermaidValidation {
  const [validation, setValidation] = useState<MermaidValidation>({
    code,
    isValidating: Boolean(code.trim()),
    repaired: false,
    suggestions: []
  });

  useEffect(() => {
    const normalized = code.trim();
    let cancelled = false;
    if (!normalized) {
      setValidation({ code: "", isValidating: false, repaired: false, suggestions: [] });
      return () => { cancelled = true; };
    }
    setValidation({ code: normalized, isValidating: true, repaired: false, suggestions: [] });
    void mermaid.parse(normalized, { suppressErrors: true })
      .then((valid) => {
        if (cancelled) return;
        if (valid) setValidation({ code: normalized, isValidating: false, repaired: false, suggestions: [] });
        else {
          const error = "Mermaid 无法解析此图形。";
          return tryRepair(normalized, error, cancelled, setValidation);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const message = readableError(error);
        void tryRepair(normalized, message, cancelled, setValidation);
      });
    return () => { cancelled = true; };
  }, [code]);

  return validation;
}

async function tryRepair(
  original: string,
  diagnostic: string,
  cancelled: boolean,
  setValidation: (next: MermaidValidation) => void
) {
  const repaired = autoRepairMermaid(original);
  try {
    const valid = await mermaid.parse(repaired, { suppressErrors: true });
    if (cancelled) return;
    if (valid) {
      setValidation({ code: repaired, isValidating: false, repaired: true, suggestions: [] });
      return;
    }
  } catch {
    // The fallback below intentionally hides parser internals from readers.
  }
  if (!cancelled) {
    setValidation({
      code: repaired,
      error: diagnostic,
      isValidating: false,
      repaired: true,
      repairInstruction: buildMermaidRepairInstruction(original, diagnostic),
      suggestions: repairSuggestions(original, diagnostic)
    });
  }
}
