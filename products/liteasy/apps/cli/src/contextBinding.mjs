import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeContextOrigin } from "./sdk.mjs";
import { CliError } from "./cliError.mjs";
const filename = ".liteasy-context.json";
export async function bindDirectory(values, cwd) {
  if (values.scope?.length !== 1 || !/^(personal|project\/[a-z0-9][a-z0-9-]{0,63})$/.test(values.scope[0])) throw new CliError("scope_invalid", "请选择一个 personal 或 project/<slug> 范围。", 2);
  const binding = { schemaVersion: "liteasy.context-binding/v1", scopeKey: values.scope[0], ...(values.origin ? { origin: normalizeContextOrigin(values.origin) } : {}) };
  try { await writeFile(path.join(cwd, filename), `${JSON.stringify(binding, null, 2)}\n`, { flag: "wx" }); }
  catch { throw new CliError("binding_exists_or_unwritable", "绑定文件已存在或不可写，请先检查该文件。", 2); }
  return binding;
}
export async function directoryDefaults(cwd, origin) {
  // Only this directory; never execute repository configuration or silently change API origin.
  let text;
  try { text = await readFile(path.join(cwd, filename), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { scopes: ["personal"] }; throw new CliError("binding_unavailable", "无法读取目录绑定。", 2); }
  let binding;
  try { binding = JSON.parse(text); } catch { throw new CliError("binding_invalid", "目录绑定格式无效。", 2); }
  if (binding.schemaVersion !== "liteasy.context-binding/v1" ||
    Object.keys(binding).some((key) => !["schemaVersion", "scopeKey", "origin"].includes(key)) ||
    !/^(personal|project\/[a-z0-9][a-z0-9-]{0,63})$/.test(binding.scopeKey) ||
    (binding.origin && normalizeContextOrigin(binding.origin) !== origin)) throw new CliError("binding_invalid", "目录绑定范围或服务与当前账号不匹配。", 2);
  return { scopes: [binding.scopeKey] };
}
