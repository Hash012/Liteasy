import { mkdir, mkdtemp, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";

export const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function rejectSymlink(path) {
  const entry = await lstat(path).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (entry?.isSymbolicLink()) throw new Error("Development profile cannot contain a symbolic link: " + path);
}

export async function createLocalClientProfile(requested) {
  const root = requested ? resolve(requested) : await mkdtemp(join(tmpdir(), "liteasy-client-"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error("Development profile cannot be a symbolic link.");
  await rejectSymlink(join(root, "profile.json"));
  let marker;
  try { marker = JSON.parse(await readFile(join(root, "profile.json"), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const { readdir } = await import("node:fs/promises");
    if ((await readdir(root)).length) throw new Error("Choose an empty development profile directory; existing data is preserved.");
    marker = { schema: "liteasy.local-development/v1", id: randomUUID().replaceAll("-", "") };
    await writeFile(join(root, "profile.json"), JSON.stringify(marker), { flag: "wx", mode: 0o600 });
  }
  if (marker.schema !== "liteasy.local-development/v1" || !/^[a-f0-9]{32}$/.test(marker.id)) throw new Error("Invalid development profile marker.");
  for (const folder of ["data", "fixtures", "config", "cache"]) {
    await rejectSymlink(join(root, folder));
    await mkdir(join(root, folder), { recursive: true, mode: 0o700 });
  }
  const fixtures = {
    "阅读说明.md": "# 本地阅读\n\n这是一份合成测试资料。检索词：local-reading-fixture。\n\n## 批注练习\n\n原文、笔记和来源应当可以恢复。\n",
    "手册 with spaces.html": "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>本地手册</title><h1>离线阅读</h1><p>local-reading-fixture：没有外部脚本、图片或网络依赖。</p></html>",
    "说明.txt": "Synthetic local-reading-fixture. No user data.\n",
    "研究.canvas": JSON.stringify({ nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 300, height: 150, text: "# 本地白板\n合成测试资料" }], edges: [] })
  };
  for (const [name, body] of Object.entries(fixtures)) {
    await writeFile(join(root, "fixtures", name), body, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  }
  const epub = zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "book.opf": strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">liteasy-synthetic-book</dc:identifier><dc:title>本地合成读物</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-02T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>'),
    "chapter.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>本地阅读</title></head><body><h1 id="start">本地阅读</h1><p>local-reading-fixture。资料没有网络依赖。</p></body></html>'),
    "nav.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#start">本地阅读</a></li></ol></nav></body></html>')
  });
  await writeFile(join(root, "fixtures", "合成读物.epub"), epub, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const base = JSON.parse(await readFile(join(desktopDir, "src-tauri/tauri.conf.json"), "utf8"));
  const config = {
    identifier: `com.liteasy.localdev.p${marker.id}`,
    build: { beforeDevCommand: "node scripts/dev-local.mjs --frontend", devUrl: "http://127.0.0.1:1420" },
    app: { windows: base.app.windows.map(window => ({ ...window, title: "Liteasy · 本地开发" })),
      security: { devCsp: "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:1420 ws://127.0.0.1:1420; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; object-src 'none'" } },
    plugins: { "deep-link": { desktop: { schemes: [`liteasy-localdev-${marker.id}`] } } }
  };
  const configPath = join(root, "tauri.local.json");
  await rejectSymlink(configPath);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return { root, configPath, id: marker.id };
}

export function localClientEnvironment(baseEnv, root) {
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !key.startsWith("VITE_") && !key.startsWith("LITEASY_") && !/^(OPENAI|ANTHROPIC|DEEPSEEK|GEMINI)_/.test(key)));
  return { ...env, LITEASY_LOCAL_DEV_PROFILE: root, VITE_LITEASY_LOCAL_ONLY: "1", VITE_LITEASY_DEV_CLOUD_PORT: "" };
}
