import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { OperationFailureNotice } from "../app/features/local-diagnostics/OperationFailureNotice";
import { ComponentTreeView } from "../app/features/visual-blocks/ComponentTreeView";
import { VisualPreviewContext } from "../app/features/visual-blocks/visualPreviewContext";
import { ExtensionLibrary } from "../app/features/extensions/ExtensionViews";
import { ExtensionWorkbenchContext, type ExtensionWorkbench } from "../app/features/extensions/extensionWorkbenchContext";
import { WorkflowRuns } from "../app/features/workflows/WorkflowViews";
import { researchTemplateWorkflow } from "../app/features/workflows/researchTemplates";
import type { WorkflowRun } from "../app/features/workflows/workflowRunner";
import { selectPickerValue } from "./helpers/selectPickerValue";

test("opaque failures become guidance with deliberately opened and redacted diagnostics", () => {
  render(<OperationFailureNotice error={new Error("revision_conflict object-secret-id api_key=credential-secret")} fallback="保存未完成，请重试。" />);
  expect(screen.getByRole("alert")).toHaveTextContent("内容已被其他操作更新");
  expect(screen.getByText(/revision_conflict object-secret-id/)).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "技术详情" }));
  expect(screen.getByText(/revision_conflict object-secret-id/)).toBeVisible();
  expect(document.body).not.toHaveTextContent("credential-secret");
});

test("resource previews hide internal locators and keep real links and user paths", () => {
  const card = (path: string) => <VisualPreviewContext.Provider value><ComponentTreeView tree={{ component: "ResourceCard", props: { path, title: "引用研究" } }} data={{}} /></VisualPreviewContext.Provider>;
  const view = render(card("liteasy://scope-secret/object-secret"));
  expect(screen.getByText("引用研究")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("scope-secret");
  view.rerender(card("https://example.org/research"));
  expect(screen.getByText("https://example.org/research")).toBeInTheDocument();
  view.rerender(card("C:\\Users\\Research\\paper.pdf"));
  expect(screen.getByText("C:\\Users\\Research\\paper.pdf")).toBeInTheDocument();
});

test("resource navigation retains exact identity and authored table values remain intact", async () => {
  const openPath = vi.fn(async () => {}), path = "liteasy://private-scope/object-private";
  const view = render(<ComponentTreeView tree={{ component: "ResourceCard", props: { path, title: "引用研究" } }} data={{}} openPath={openPath} />);
  fireEvent.click(screen.getByRole("button", { name: "引用研究" }));
  await waitFor(() => expect(openPath).toHaveBeenCalledWith(path));
  expect(document.body).not.toHaveTextContent(path);
  view.rerender(<ComponentTreeView tree={{ component: "Table", props: { rows: [["作者讨论 revision-aabb 与 model-x"]] } }} data={{}} />);
  expect(screen.getByText("作者讨论 revision-aabb 与 model-x")).toBeInTheDocument();
});

test("unavailable extensions use a readable version control name but roll back the exact extension", async () => {
  const id = "plugin.opaque-private-id", revision = "storage-revision-secret", rollback = vi.fn(async () => {});
  const state = { schema: "liteasy.extension-installation/v1", id, version: "1.0.1", revision, digest: "digest", enabled: false, installedAt: "2026-10-15" };
  const host = { packages: { store: { list: async () => [state], get: async () => { throw new Error(`missing package ${id}`); }, versions: async () => ["1.0.0", "1.0.1"], rollback }, snapshot: { packages: [] } }, error: "", openStudio: vi.fn(), openRuns: vi.fn() } as unknown as ExtensionWorkbench;
  render(<ExtensionWorkbenchContext.Provider value={host}><ExtensionLibrary /></ExtensionWorkbenchContext.Provider>);
  expect(await screen.findByRole("heading", { name: "不可用扩展" })).toBeInTheDocument();
  expect(screen.getByText(`Error: missing package ${id}`)).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "管理与版本" }));
  const picker = screen.getByRole("combobox", { name: "切换 不可用扩展 的版本" });
  expect(picker).not.toHaveAccessibleName(expect.stringContaining(id));
  await selectPickerValue(picker, "1.0.0");
  await waitFor(() => expect(rollback).toHaveBeenCalledWith(id, "1.0.0", revision));
  fireEvent.click(screen.getByRole("button", { name: "技术详情" }));
  expect(screen.getByText(`Error: missing package ${id}`)).toBeVisible();
});

test.each(["failed", "waiting_input"] as const)("workflow %s displays useful status without losing prompts or diagnostic evidence", async (status) => {
  const definition = researchTemplateWorkflow("evidence-audit"), node = definition.nodes[0];
  const error = status === "waiting_input" ? "请解释论文中的 revision-aabb 这一术语" : "node-opaque-failure: internal-source-id token=credential-secret";
  const run = { schema: "liteasy.workflow-run/v2", id: "internal-run-id", owner: "plugin.paper-lens", digest: "fixture", workflowDigest: "fixture", grantId: "fixture", definition, input: {}, settings: {}, status, createdAt: "2026-10-13", updatedAt: "2026-10-13", error, elapsedMs: 0, operations: 0, modelCalls: 0, tokens: 0, estimatedTokens: false, revision: "r1", nodes: Object.fromEntries(definition.nodes.map(item => [item.id, { status: "pending", attempts: 0, operations: [] }])) } as WorkflowRun;
  const host = { workflows: { runner: { list: async () => [run], subscribe: () => () => {}, replay: async () => ({ run, nodes: { [node.id]: { objectId: "internal-output-id" } }, receipts: {}, missing: ["missing-node-opaque"] }) }, triggers: { list: async () => [] }, error: "" }, openLink: vi.fn() } as unknown as ExtensionWorkbench;
  render(<ExtensionWorkbenchContext.Provider value={host}><WorkflowRuns /></ExtensionWorkbenchContext.Provider>);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(definition.title) }));
  expect(await screen.findByText("缺少 1 项运行快照，无法完整回放。")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("missing-node-opaque");
  expect(document.body).not.toHaveTextContent("internal-run-id");
  if (status === "waiting_input") expect(screen.getByRole("status")).toHaveTextContent(error);
  else {
    expect(screen.getByRole("alert")).toHaveTextContent("本次运行未完成");
    expect(screen.getByText(/node-opaque-failure: internal-source-id/)).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "技术详情", exact: true }));
    expect(screen.getByText(/node-opaque-failure: internal-source-id/)).toBeVisible();
    expect(document.body).not.toHaveTextContent("credential-secret");
  }
  fireEvent.click(screen.getByRole("button", { name: new RegExp(node.title) }));
  expect(screen.getByText(/"objectId": "internal-output-id"/)).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "技术详情：结构化输出" }));
  expect(screen.getByText(/"objectId": "internal-output-id"/)).toBeVisible();
});
