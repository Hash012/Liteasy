import { useEffect, useState } from "react";
import { Checkbox, Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { DataSchema, JsonObject, JsonValue } from "./extensionSchema";

function JsonField({ schema, value, onChange, onValidityChange }: { schema: DataSchema; value: JsonValue; onChange(value: JsonValue): void; onValidityChange(valid: boolean): void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(""); }, [value]);
  return <><Textarea aria-label={schema.title || "结构化字段"} resize="vertical" value={text} onChange={(_, data) => { setText(data.value); try { const value: JsonValue = JSON.parse(data.value); onChange(value); setError(""); onValidityChange(true); } catch { setError("请补全有效 JSON 后保存。"); onValidityChange(false); } }} />{error ? <span role="alert">{error}</span> : null}</>;
}
export function SchemaFields({ schema, value, onChange, onValidityChange }: { schema: DataSchema; value: JsonObject; onChange(value: JsonObject): void; onValidityChange?(valid: boolean): void }) {
  const [invalid, setInvalid] = useState<string[]>([]);
  return <div className="extension-schema-fields">{Object.entries(schema.properties ?? {}).map(([key, field]) => {
    const current = value[key] ?? field.default ?? (field.type === "string" ? "" : field.type === "array" ? [] : field.type === "object" ? {} : field.type === "boolean" ? false : 0);
    const change = (next: JsonValue) => onChange({ ...value, [key]: next });
    const label = field.title || key;
    return <Field key={key} label={label} hint={field.description} required={schema.required?.includes(key)}>
      {field.enum ? <Select aria-label={label} value={JSON.stringify(current)} onChange={(_, data) => change(JSON.parse(data.value) as JsonValue)}>{field.enum.map((option) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{typeof option === "string" ? option : JSON.stringify(option)}</option>)}</Select>
        : field.type === "boolean" ? <Checkbox aria-label={label} checked={current === true} onChange={(_, data) => change(!!data.checked)} />
        : field.type === "string" ? <Textarea aria-label={label} resize="vertical" value={String(current)} onChange={(_, data) => change(data.value)} />
        : field.type === "number" || field.type === "integer" ? <Input aria-label={label} type="number" min={field.minimum} max={field.maximum} step={field.type === "integer" ? 1 : "any"} value={String(current)} onChange={(_, data) => change(Number(data.value))} />
        : <JsonField schema={{ ...field, title: label }} value={current} onChange={change} onValidityChange={(valid) => { const next = valid ? invalid.filter((item) => item !== key) : [...new Set([...invalid, key])]; setInvalid(next); onValidityChange?.(!next.length); }} />}
    </Field>;
  })}</div>;
}
