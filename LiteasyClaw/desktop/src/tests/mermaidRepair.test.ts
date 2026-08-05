import { describe, expect, test } from "vitest";
import { autoRepairMermaid, buildMermaidRepairInstruction } from "../app/features/mermaid/mermaidRepair";

describe("Mermaid repair helpers", () => {
  test("repairs common small-model flowchart mistakes before rendering", () => {
    expect(autoRepairMermaid("graph LR\nA -> B[输出")).toBe("flowchart LR\nA --> B[输出]");
  });

  test("gives a constrained repair task to a lightweight model", () => {
    const prompt = buildMermaidRepairInstruction("A -> B", "第 1 行箭头无效");
    expect(prompt).toContain("只返回可直接渲染的 Mermaid 源码");
    expect(prompt).toContain("第 1 行箭头无效");
    expect(prompt).toContain("A -> B");
  });
});
