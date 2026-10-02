import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { WorkflowRuns } from "../app/features/workflows/WorkflowViews";
import { researchTemplateWorkflow } from "../app/features/workflows/researchTemplates";
import type { WorkflowRun } from "../app/features/workflows/workflowRunner";
import { ExtensionWorkbenchContext, type ExtensionWorkbench } from "../app/features/extensions/extensionWorkbenchContext";

test("exports the recorded Markdown snapshot and navigates to the previous run without rerunning tools", async () => {
  const definition = researchTemplateWorkflow("evidence-audit");
  const run = (id: string, title: string, parentRunId?: string): WorkflowRun => ({
    schema: "liteasy.workflow-run/v2", id, owner: "plugin.paper-lens", digest: "fixture", workflowDigest: "fixture", grantId: "fixture",
    definition: { ...definition, title }, input: {}, settings: {}, status: "succeeded", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
    elapsedMs: 1, operations: 1, modelCalls: 0, tokens: 0, estimatedTokens: false, revision: "r1", parentRunId,
    nodes: Object.fromEntries(definition.nodes.map((node) => [node.id, { status: "succeeded", attempts: 1, operations: [] }]))
  });
  const previous = run("old", "上轮证据审计"), current = run("new", "本轮证据审计", "old");
  const markdown = "# 本轮证据审计\n\n来源修订：revision-1\n\nPDF 物理页：3\n\n> Immutable source excerpt.";
  const execute = vi.fn();
  const replay = vi.fn(async (id: string) => ({ run: id === "old" ? previous : current, nodes: { worksheet: { text: markdown } }, receipts: {}, missing: [] }));
  // Runtime ports are injected; this UI case does not simulate native downloads or model calls.
  const host = { workflows: { runner: { list: async () => [current, previous], subscribe: () => () => {}, replay, execute }, triggers: { list: async () => [] }, error: "" }, openLink: vi.fn() } as unknown as ExtensionWorkbench;
  const created = Object.getOwnPropertyDescriptor(URL, "createObjectURL"), revoked = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createObjectURL = vi.fn((_blob: Blob) => "blob:template-snapshot"), revokeObjectURL = vi.fn();
  Object.defineProperties(URL, { createObjectURL: { configurable: true, value: createObjectURL }, revokeObjectURL: { configurable: true, value: revokeObjectURL } });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  let dispose = () => {};
  try {
    dispose = render(<ExtensionWorkbenchContext.Provider value={host}><WorkflowRuns /></ExtensionWorkbenchContext.Provider>).unmount;
    fireEvent.click(await screen.findByRole("button", { name: /本轮证据审计 · 完成/ }));
    fireEvent.click(await screen.findByRole("button", { name: "导出阅读模板快照" }));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0];
    expect(anchor.download).toBe("evidence-audit.md");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(text).toBe(markdown);
    fireEvent.click(screen.getByRole("button", { name: "查看上次运行" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "上轮证据审计" })).toBeInTheDocument());
    expect(replay).toHaveBeenCalledWith("old");
    expect(execute).not.toHaveBeenCalled();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:template-snapshot"), { timeout: 2000 });
  } finally {
    dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    click.mockRestore();
    if (created) Object.defineProperty(URL, "createObjectURL", created); else Reflect.deleteProperty(URL, "createObjectURL");
    if (revoked) Object.defineProperty(URL, "revokeObjectURL", revoked); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});
