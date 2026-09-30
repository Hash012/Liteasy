import { readFile, access } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export async function verifyUpstream(upstream, lock, requiredFiles = ["build.sh", "package-lock.json"]) {
  let gitCheckout = true;
  try { await access(join(upstream, ".git")); } catch { gitCheckout = false; }
  if (gitCheckout) {
    for (const [path, sha] of [["", lock.commit], ...Object.entries(lock.submodules || {})]) {
      const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(upstream, path), encoding: "utf8" }).trim();
      if (actual !== sha) throw new Error(`上游版本不匹配：${path || "zotero-connectors"}`);
    }
    if (execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: upstream, encoding: "utf8" }).trim()) throw new Error("上游存在修改；构建要求使用锁定、未修改的源码。");
    return;
  }
  // Corresponding-source ZIPs omit Git internals but carry per-file integrity
  // metadata, so recipients can build them without reconstructing a checkout.
  const provenance = JSON.parse(await readFile(join(upstream, "upstream-source.json"), "utf8"));
  if (provenance.commit !== lock.commit || requiredFiles.some(path => !provenance.files?.[path])) throw new Error("对应源码包来源标记不正确。");
  for (const [path, expected] of Object.entries(provenance.files)) {
    const absolute = resolve(upstream, path);
    if (!absolute.startsWith(resolve(upstream) + sep)) throw new Error("对应源码包路径无效。");
    const actual = createHash("sha256").update(await readFile(absolute)).digest("hex");
    if (actual !== expected) throw new Error(`对应源码包文件发生变化：${path}`);
  }
}
