import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { WorkflowStudio } from "../app/features/workflow-studio/WorkflowStudio";
import { ExtensionWorkbenchContext, type ExtensionWorkbench } from "../app/features/extensions/extensionWorkbenchContext";
import { selectPickerValue } from "./helpers/selectPickerValue";

async function fixture() {
  const draft = { id: "private-draft-id", title: "阅读整理流程", files: {}, revision: "private-revision", updatedAt: "2026-10-15", description: "", schema: "liteasy.extension-draft/v1" };
  const trial = vi.fn(), publish = vi.fn(async () => ({ manifest: { version: "1.0.2" } }));
  const host = { studio: { drafts: { list: async () => [draft], subscribe: () => () => {}, get: async () => draft, history: async () => [], publish }, service: { call: trial } }, packages: { store: {} } } as unknown as ExtensionWorkbench;
  render(<ExtensionWorkbenchContext.Provider value={host}><WorkflowStudio /></ExtensionWorkbenchContext.Provider>);
  await selectPickerValue(screen.getByRole("combobox", { name: "选择扩展草稿" }), draft.id);
  await screen.findByRole("heading", { name: draft.title });
  return { trial, publish, draft };
}

test("studio failures and failed trial cases expose raw identifiers only through technical details", async () => {
  const f = await fixture();
  f.trial.mockRejectedValueOnce(new Error("failed plugin.private-id node.private-id token=private-credential"));
  fireEvent.click(screen.getByRole("button", { name: "隔离样例试跑" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("制作操作未完成");
  expect(screen.getByText(/failed plugin.private-id/)).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "技术详情" }));
  expect(screen.getByText(/failed plugin.private-id/)).toBeVisible();
  expect(document.body).not.toHaveTextContent("private-credential");
  f.trial.mockResolvedValueOnce({ passed: false, cases: [{ name: "核对来源", passed: false, error: "trial-node-private-id" }] });
  fireEvent.click(screen.getByRole("button", { name: "隔离样例试跑" }));
  expect(await screen.findByRole("heading", { name: "样例报告 · 未通过" })).toBeVisible();
  expect(screen.getByText("核对来源 · 未通过")).toBeVisible();
  expect(screen.getByText("trial-node-private-id")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "技术详情" }));
  expect(screen.getByText("trial-node-private-id")).toBeVisible();
});

test("successful publication remains a success message and uses the selected draft identity", async () => {
  const f = await fixture();
  f.trial.mockResolvedValueOnce({ passed: true, cases: [{ name: "核对来源", passed: true }] });
  fireEvent.click(screen.getByRole("button", { name: "隔离样例试跑" }));
  await screen.findByRole("heading", { name: "样例报告 · 通过" });
  await userEvent.click(screen.getByRole("button", { name: "更多制作操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "发布本地版本" }));
  await waitFor(() => expect(f.publish).toHaveBeenCalledWith(f.draft.id, expect.anything()));
  expect(await screen.findByText("已发布 1.0.2；请在扩展中检查新增入口并启用。")).toHaveAttribute("role", "status");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
