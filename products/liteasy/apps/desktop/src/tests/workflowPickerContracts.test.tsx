import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { WorkflowBindingEditor } from "../app/features/workflow-studio/WorkflowBindingEditor";
import { WorkflowInvocation } from "../app/features/workflows/WorkflowViews";
import { researchTemplateWorkflow } from "../app/features/workflows/researchTemplates";
import type { WorkflowDefinition } from "../app/features/workflows/workflowDefinition";
import type { ExtensionWorkflowModel } from "../app/features/workflows/extensionWorkflowModel";
import { SchemaFields } from "../app/features/extensions/SchemaFields";
import type { DataSchema, JsonObject } from "../app/features/extensions/extensionSchema";

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option, exact: true }));
}

test("binding pickers preserve literal null and other nodes until a chosen source is committed", async () => {
  const base = researchTemplateWorkflow("evidence-audit");
  const workflow = { ...base, nodes: [
    { id: "source", title: "固定来源", operation: { id: "core.value", version: "1.0.0" }, input: { value: { source: "literal", value: null } }, retries: 0, breakpoint: false },
    { id: "target", title: "输出", operation: { id: "core.end", version: "1.0.0" }, input: { value: { source: "node", nodeId: "source", path: "" } }, retries: 0, breakpoint: false }
  ], edges: [{ from: "source", to: "target" }], layout: {} } as WorkflowDefinition;
  const change = vi.fn();
  function Fixture() {
    const [value, setValue] = useState(workflow);
    return <WorkflowBindingEditor workflow={value} selected="target" onChange={(next) => { change(next); setValue(next); }} />;
  }
  render(<Fixture />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "value 值来源" }));
  await user.keyboard("{Escape}");
  expect(change).not.toHaveBeenCalled();
  await choose("value 值来源", "固定值");
  const json = screen.getByRole("textbox", { name: "固定 JSON 值" });
  await user.clear(json); await user.type(json, "null");
  expect(change.mock.calls.at(-1)?.[0].nodes[1].input.value).toEqual({ source: "literal", value: null });
  expect(change.mock.calls.at(-1)?.[0].nodes[0]).toEqual(workflow.nodes[0]);
  await choose("value 值来源", "未设置（采用默认值）");
  expect(change.mock.calls.at(-1)?.[0].nodes[1].input).toEqual({});
  expect(change.mock.calls.at(-1)?.[0].edges).toEqual(workflow.edges);
});

test("schema enum pickers serialize string, number, boolean and null without coercion", async () => {
  const schema = { type: "object", properties: { mode: { type: "string", title: "选择值", enum: ["", "1", 1, false, null] } } } as DataSchema;
  const change = vi.fn();
  function Fixture() { const [value, setValue] = useState<JsonObject>({ mode: null, untouched: "keep" }); return <SchemaFields schema={schema} value={value} onChange={(next) => { change(next); setValue(next); }} />; }
  render(<Fixture />);
  expect(screen.getByRole("combobox", { name: "选择值" })).toHaveTextContent("null");
  await choose("选择值", "false");
  expect(change).toHaveBeenLastCalledWith({ mode: false, untouched: "keep" });
  await userEvent.click(screen.getByRole("combobox", { name: "选择值" }));
  const ones = screen.getAllByRole("option", { name: "1", exact: true });
  await userEvent.click(ones[1]);
  expect(change).toHaveBeenLastCalledWith({ mode: 1, untouched: "keep" });
  await userEvent.click(screen.getByRole("combobox", { name: "选择值" }));
  await userEvent.click(screen.getAllByRole("option", { name: "1", exact: true })[0]);
  expect(change).toHaveBeenLastCalledWith({ mode: "1", untouched: "keep" });
});

test("workflow approval keeps resource writes, external recipient and budget outside collapsed details", () => {
  const definition = researchTemplateWorkflow("evidence-audit");
  const model = { pending: { definition: { ...definition, budget: { ...definition.budget, maxModelCalls: 3, maxTokens: 12000 } }, input: {}, selection: [], capabilities: ["resources.content.read", "resources.write", "model.invoke"] }, assets: { search: vi.fn(async () => []) }, connection: "用户选定连接", close: vi.fn(), start: vi.fn() } as unknown as ExtensionWorkflowModel;
  render(<WorkflowInvocation model={model} />);
  const scope = screen.getByRole("region", { name: "操作范围与预算" });
  expect(within(scope).getByText(/读取选中资料正文、修改资料、向当前模型发送任务内容/)).toBeVisible();
  expect(within(scope).getByText("外发对象：用户选定连接 · 最多 3 次调用 · 12000 tokens")).toBeVisible();
  expect(within(scope).getByRole("button", { name: "预算详情" })).toHaveAttribute("aria-expanded", "false");
  expect(model.start).not.toHaveBeenCalled();
});
