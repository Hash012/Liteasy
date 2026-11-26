import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { skillPackageRoot } from "./skillAssets.mjs";
import { CliError } from "./cliError.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
async function hashes(directory, prefix = "") {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) throw new CliError("skill_path_unsafe", "Skill 目录含链接或特殊文件，已保留原文件。", 8);
    const relative = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await hashes(path.join(directory, item.name), `${relative}/`));
    else result[relative] = sha(await readFile(path.join(directory, item.name)));
  }
  return result;
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
async function rejectLinkedAncestors(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new CliError("skill_path_unsafe", "安装目录不能经过符号链接，原文件已保留。", 8); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (path.dirname(current) === current) break;
  }
}
export async function manageSkills(action, values, cwd, home = os.homedir()) {
  if (!["install", "status", "upgrade", "remove"].includes(action) || !["codex", "claude-code"].includes(values.agent) ||
    values.scope?.length !== 1 || !["user", "project"].includes(values.scope[0])) throw new CliError("skills_arguments_invalid", "请选择 --agent codex|claude-code 和 --scope user|project。", 2);
  const root = path.join(values.scope[0] === "user" ? home : cwd, values.agent === "codex" ? ".agents" : ".claude", "skills");
  await rejectLinkedAncestors(root);
  const manifestPath = path.join(root, ".liteasy-skills.json");
  const bundled = JSON.parse(await readFile(new URL("manifest.json", skillPackageRoot), "utf8"));
  let installed = { skills: {} };
  try {
    if ((await lstat(root)).isSymbolicLink() || (await lstat(manifestPath)).isSymbolicLink()) throw new CliError("skill_path_unsafe", "Skills 目录或清单不能是链接。", 8);
    installed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (installed.schemaVersion !== "liteasy.skills-install/v1" || !installed.skills || typeof installed.skills !== "object") throw new Error();
  } catch (error) { if (error.code !== "ENOENT") throw new CliError("skill_manifest_invalid", "安装清单无效，未修改任何 Skill。", 8); }
  const prefix = `adapters/${values.agent}/`;
  const desired = {};
  const verifiedFiles = new Map();
  for (const [file, hash] of Object.entries(bundled.files)) {
    if (!file.startsWith(prefix)) continue;
    const [name, ...rest] = file.slice(prefix.length).split("/");
    if (!/^liteasy-[a-z-]+$/.test(name) || !["SKILL.md", "agents/openai.yaml", "references/read-protocol.md", "references/write-protocol.md"].includes(rest.join("/"))) throw new CliError("skills_package_corrupt", "技能包路径无效。", 8);
    const source = await readFile(new URL(file, skillPackageRoot));
    if (sha(source) !== hash) throw new CliError("skills_package_corrupt", "技能包完整性校验失败，原文件已保留。", 8);
    verifiedFiles.set(file, source);
    (desired[name] ??= {})[rest.join("/")] = hash;
  }
  const states = [];
  const names = new Set([...Object.keys(desired), ...Object.keys(installed.skills)]);
  for (const name of names) {
    if (!/^liteasy-[a-z-]+$/.test(name)) throw new CliError("skill_manifest_invalid", "安装清单包含无效路径。", 8);
    let actual;
    try {
      if ((await lstat(path.join(root, name))).isSymbolicLink()) throw new CliError("skill_path_unsafe", "Skill 路径不能是链接。", 8);
      actual = await hashes(path.join(root, name));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const recorded = installed.skills[name] ?? {};
    const changedFiles = actual && installed.skills[name] ? [...new Set([...Object.keys(actual), ...Object.keys(recorded)])].filter((file) => actual[file] !== recorded[file]) : [];
    states.push({ name, status: !actual ? "absent" : !installed.skills[name] ? "unmanaged" : !same(actual, recorded) ? "modified" : "managed", changedFiles });
  }
  if (action === "status") return { version: installed.version ?? null, availableVersion: bundled.version, compatibleCliMajor: bundled.compatibleCliMajor, apiVersion: bundled.apiVersion, root, skills: states };
  const conflicts = states.filter((item) => ["unmanaged", "modified"].includes(item.status));
  if (conflicts.length) throw new CliError("skills_local_changes", "检测到同名或修改过的 Skill，已保留；请先手动整理后重试。", 6, { conflicts: conflicts.map((item) => item.name) });
  await mkdir(root, { recursive: true });
  for (const state of states) {
    if (state.status === "managed") await rm(path.join(root, state.name), { recursive: true });
    if (action === "remove" || !desired[state.name]) continue;
    for (const relative of Object.keys(desired[state.name])) {
      const source = verifiedFiles.get(`${prefix}${state.name}/${relative}`);
      const target = path.join(root, state.name, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source, { flag: "wx" });
    }
  }
  if (action === "remove") await rm(manifestPath, { force: true });
  else await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: "liteasy.skills-install/v1", version: bundled.version, skills: desired }, null, 2)}\n`);
  return { action, version: bundled.version, root, skills: states.map((item) => item.name) };
}
