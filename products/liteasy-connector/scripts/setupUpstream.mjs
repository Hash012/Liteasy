import { readFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { root, upstream, translators } from "./paths.mjs";

const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: upstream, stdio: "inherit" });
try { await access(join(upstream, ".git")); }
catch {
  await mkdir(dirname(upstream), { recursive: true });
  execFileSync("git", ["clone", "--filter=blob:none", lock.repository, upstream], { stdio: "inherit" });
}
const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: upstream, encoding: "utf8" });
if (changes.trim()) throw new Error("上游目录有修改，请保留修改后使用另一个 LITEASY_CONNECTOR_UPSTREAM 目录。");
git("fetch", "--depth=1", "origin", lock.commit);
git("checkout", "--detach", lock.commit);
git("submodule", "update", "--init", "--depth=1");
for (const [path, sha] of Object.entries(lock.submodules)) {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(upstream, path), encoding: "utf8" }).trim();
  if (actual !== sha) throw new Error(`上游子模块不匹配：${path}`);
}
execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: upstream, stdio: "inherit", env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true" }
});
console.log(`Pinned Zotero Connector source ready: ${upstream}`);
try { await access(join(translators, ".git")); }
catch {
  await mkdir(dirname(translators), { recursive: true });
  execFileSync("git", ["clone", "--filter=blob:none", lock.translators.repository, translators], { stdio: "inherit" });
}
if (execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: translators, encoding: "utf8" }).trim()) throw new Error("站点规则目录有修改，请使用未修改的目录。");
execFileSync("git", ["fetch", "--depth=1", "origin", lock.translators.commit], { cwd: translators, stdio: "inherit" });
execFileSync("git", ["checkout", "--detach", lock.translators.commit], { cwd: translators, stdio: "inherit" });
console.log(`Pinned translator source ready: ${translators}`);
