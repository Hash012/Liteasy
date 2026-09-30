import { useEffect, useState } from "react";
import { Field, Input, Select, Textarea } from "@fluentui/react-components";
import { operationCatalog } from "../workflows/operationCatalog";
import { compileWorkflow, type WorkflowBinding, type WorkflowDefinition } from "../workflows/workflowDefinition";

function LiteralEditor({ binding, onChange }: { binding: WorkflowBinding; onChange(value: WorkflowBinding): void }) {
  const value = binding.source === "literal" ? JSON.stringify(binding.value, null, 2) : "null";
  const [text, setText] = useState(value), [error, setError] = useState("");
  useEffect(() => { setText(value); }, [value]);
  return <><Textarea aria-label="固定 JSON 值" value={text} onChange={(_, data) => { setText(data.value); try { onChange({ source: "literal", value: JSON.parse(data.value) }); setError(""); } catch { setError("请补全有效 JSON；未完成的输入不会替换已保存绑定。"); } }} />{error ? <span role="alert">{error}</span> : null}</>;
}
export function WorkflowBindingEditor({ workflow, selected, onChange }: { workflow: WorkflowDefinition; selected: string; onChange(value: WorkflowDefinition): void }) {
  const node = workflow.nodes.find((item) => item.id === selected);
  if (!node || !operationCatalog[node.operation.id]) return null;
  const fields = operationCatalog[node.operation.id].input.shape;
  const update = (key: string, binding?: WorkflowBinding) => { const input = { ...node.input }; if (binding) input[key] = binding; else delete input[key]; onChange({ ...workflow, nodes: workflow.nodes.map((item) => item.id === node.id ? { ...item, input } : item) }); };
  let validation = "输入与依赖校验通过";
  try { compileWorkflow(workflow); } catch (error) { validation = error instanceof Error ? error.message : String(error); }
  return <section className="studio-binding-editor" aria-label="步骤参数绑定"><h3>{node.title} · 参数</h3><p role="status">{validation}</p>{Object.entries(fields).map(([key, schema]) => {
    const binding = node.input[key];
    return <Field key={key} label={key} required={!schema.isOptional()}>
      <Select aria-label={`${key} 值来源`} value={binding?.source ?? "unset"} onChange={(_, data) => update(key, data.value === "unset" ? undefined : data.value === "literal" ? { source: "literal", value: "" } : data.value === "node" ? { source: "node", nodeId: workflow.nodes.find((item) => item.id !== node.id)?.id ?? node.id, path: "" } : { source: data.value as "input" | "settings", path: "" })}>
        <option value="unset">未设置（采用默认值）</option><option value="literal">固定值</option><option value="input">流程输入</option><option value="settings">扩展设置</option><option value="node">其他步骤的输出</option>
      </Select>
      {binding?.source === "literal" ? <LiteralEditor binding={binding} onChange={(value) => update(key, value)} /> : binding ? <>
        {binding.source === "node" ? <Select aria-label={`${key} 来源步骤`} value={binding.nodeId} onChange={(_, data) => update(key, { ...binding, nodeId: data.value })}>{workflow.nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.title} · {operationCatalog[item.operation.id]?.outputType ?? "object"}</option>)}</Select> : null}
        <Input aria-label={`${key} 字段路径`} placeholder="留空使用完整值，如 asset.path / selection.0" value={binding.path} onChange={(_, data) => update(key, { ...binding, path: data.value })} />
      </> : null}
    </Field>;
  })}</section>;
}
