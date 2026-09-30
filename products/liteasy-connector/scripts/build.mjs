import { build } from "esbuild";
import { readFile, writeFile, cp, mkdir, rm, access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { root, upstream, translators, dist } from "./paths.mjs";
import { verifyUpstream } from "./verifyUpstream.mjs";

const require = createRequire(import.meta.url);
const { ArrowUndo20Regular, ArrowRedo20Regular, Add20Regular, Subtract20Regular, Dismiss20Regular, QuestionCircle20Regular, Note20Regular, Whiteboard20Regular, ReOrderDotsVertical20Regular } = require("@fluentui/react-icons");

const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
try { await access(join(upstream, "node_modules")); }
catch { throw new Error("请先运行 npm run setup:upstream（或设置 LITEASY_CONNECTOR_UPSTREAM 指向准备好的上游源码）。"); }
await verifyUpstream(upstream, lock);
await verifyUpstream(translators, lock.translators, ["arXiv.org.js"]);
execFileSync("bash", ["build.sh", "-p", "b", "-v", pkg.version], { cwd: upstream, stdio: "inherit" });
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(upstream, "build/manifestv3"), dist, { recursive: true });
// Parse only the JSON header; never execute translator source at build time.
const catalogue = [];
await mkdir(join(dist, "translators"), { recursive: true });
for (const name of (await readdir(translators)).filter(name => name.endsWith(".js")).sort()) {
  const code = (await readFile(join(translators, name), "utf8")).replace(/^\uFEFF/, "");
  let depth = 0, quoted = false, escaped = false, end = -1;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { end = i + 1; break; }
  }
  const header = JSON.parse(code.slice(0, end));
  // A few official legacy identifiers contain spaces or non-hex letters.
  // Preserve their identity while disallowing paths and case-only collisions.
  if (typeof header.translatorID !== "string" || !/^[a-z0-9 -]{20,64}$/i.test(header.translatorID) || catalogue.some(t => t.translatorID.toLowerCase() === header.translatorID.toLowerCase())) throw new Error(`站点规则 ID 无效或重复：${name}`);
  catalogue.push(header);
  await writeFile(join(dist, "translators", `${header.translatorID}.js`), code);
}
await writeFile(join(dist, "translators/catalogue.json"), JSON.stringify({ version: lock.translators.commit, translators: catalogue }) + "\n");
console.log(`Bundled ${catalogue.length} pinned translators`);
await cp(join(root, "src/reading"), dist, { recursive: true, filter: path => !path.endsWith("package.json") });
// Preserve upstream's background.js. The reader is its own worker module.
await cp(join(upstream, "build/manifestv3/background.js"), join(dist, "background.js"));
await cp(join(root, "src/background/upstreamRuntime.js"), join(dist, "liteasy-runtime.js"));
let upstreamWorker = await readFile(join(dist, "background-worker.js"), "utf8");
upstreamWorker = upstreamWorker.replace('"background.js"', '"liteasy-runtime.js", "background.js"');
await writeFile(join(dist, "background-worker.js"), upstreamWorker);
let config = await readFile(join(dist, "zotero_config.js"), "utf8");
config = config.replace("CLIENT_NAME: 'Zotero'", "CLIENT_NAME: 'Liteasy'")
  .replace("ALWAYS_FETCH_FROM_REPOSITORY: false", "ALWAYS_FETCH_FROM_REPOSITORY: true");
await writeFile(join(dist, "zotero_config.js"), config);
let readingWorker = await readFile(join(root, "src/reading/background.js"), "utf8");
const actionStart = readingWorker.indexOf("  chrome.sidePanel?.setPanelBehavior");
if (actionStart < 0) throw new Error("Reader action integration point changed.");
readingWorker = readingWorker.slice(0, actionStart) + "})();\n";
// Reader gestures set the panel path before opening, retaining the immediate open call.
readingWorker = readingWorker.replace("const opened=chrome.sidePanel?.open", "void chrome.sidePanel?.setOptions({path:'sidebar.html',enabled:true});\n        const opened=chrome.sidePanel?.open");
await writeFile(join(dist, "reading-background.js"), readingWorker);
const bundle = (entry, outfile, extra = {}) => build({
  absWorkingDir: root, entryPoints: [entry], outfile: join(dist, outfile), bundle: true,
  format: "iife", target: "chrome120", minify: true, legalComments: "linked", ...extra
});
await Promise.all([
  bundle("src/background/connector.ts", "liteasy-background.js"),
  bundle("src/content/collector.ts", "liteasy-collector.js"),
  bundle("src/ui/main.tsx", "liteasy-ui.js"),
  bundle("src/ui/exportWorker.ts", "liteasy-export-worker.js"),
  bundle("src/ui/readingShell.tsx", "liteasy-reading-shell.js")
]);
await writeFile(join(dist, "liteasy-worker.js"), 'importScripts("background-worker.js", "reading-background.js", "liteasy-background.js");\n');
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
manifest.name = "Liteasy Connector";
manifest.description = "采集论文、PDF 与网页快照，分段阅读、Markdown 批注与知识白板。";
manifest.version = pkg.version;
manifest.minimum_chrome_version = "120";
manifest.background.service_worker = "liteasy-worker.js";
manifest.permissions = [...new Set([...manifest.permissions, "sidePanel", "unlimitedStorage"])];
manifest.action.default_popup = "popup.html";
manifest.action.default_title = "Liteasy Connector";
manifest.icons = { "16": "Icon-32.png", "32": "Icon-32.png", "128": "Icon-128.png" };
manifest.action.default_icon = manifest.icons;
manifest.side_panel = { default_path: "panel.html" };
manifest.options_ui.page = "options.html";
// Account-specific Docs integration and CSL installation have no Liteasy
// receiver. Keep them out of the extension's active permissions and pages.
manifest.content_scripts = manifest.content_scripts.filter(script => !script.matches.some(match => match.startsWith("https://docs.google.com/")));
manifest.declarative_net_request.rule_resources.forEach(rule => { rule.enabled = false; });
delete manifest.homepage_url;
delete manifest.update_url;
const injectIndex = manifest.content_scripts[0].js.indexOf("inject/inject.js");
if (injectIndex < 0) throw new Error("上游页面初始化入口发生变化。");
manifest.content_scripts[0].js.splice(injectIndex, 0, "liteasy-collector.js");
manifest.content_scripts.push({ matches: ["https://chatgpt.com/*"], js: ["shared.js", "markdown-clip.js", "content.js"], css: ["styles.css", "reading-content-theme.css"], run_at: "document_idle", world: "ISOLATED" });
await writeFile(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
let readerContent = await readFile(join(dist, "content.js"), "utf8");
const noteIcon = renderToStaticMarkup(createElement(Note20Regular, { "aria-hidden": true }));
const boardIcon = renderToStaticMarkup(createElement(ReOrderDotsVertical20Regular, { "aria-hidden": true }));
const svgElement = markup => `new DOMParser().parseFromString(${JSON.stringify(markup.includes("xmlns=") ? markup : markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}, 'image/svg+xml').documentElement`;
readerContent = readerContent.replace(/    const icon = document.createElementNS\('http:\/\/www.w3.org\/2000\/svg', 'svg'\);[\s\S]+?    icon.append\(line\); note.append\(icon\);/, `    const icon = ${svgElement(noteIcon)}; note.append(icon);`)
  .replace("button.textContent='⠿';", `button.append(${svgElement(boardIcon)});`);
await writeFile(join(dist, "content.js"), readerContent);
for (const name of ["popup", "panel"]) {
  await writeFile(join(dist, `${name}.html`), `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Liteasy Connector</title><link rel="stylesheet" href="liteasy-ui.css"></head><body><div id="root"></div><script src="liteasy-ui.js"></script></body></html>\n`);
}
for (const name of ["sidebar", "options"]) {
  let html = await readFile(join(dist, `${name}.html`), "utf8");
  html = html.replace("</head>", '<link rel="stylesheet" href="liteasy-reading-shell.css"></head>')
    .replace("<body>", `<body class="reading-shell ${name === "options" ? "options-shell" : ""}">`)
    .replace("</body>", '<script src="liteasy-reading-shell.js"></script></body>')
    .replace("阅读批注 · ChatGPT", "阅读批注 · Liteasy")
    .replace("READ · REFLECT · REMEMBER", "LITEASY · 阅读工作区")
    .replace("CHATGPT READING PROGRESS · v0.5.0", "LITEASY CONNECTOR · 设置与备份")
    .replace("不读取账户令牌，不上传批注或聊天内容，也不自动跨设备同步。", "阅读进度、批注和白板保存在本地，不自动跨设备同步。")
    .replace(/无远程脚本 · 无云端同步 · 本地 Markdown 依赖 · storage \/ sidePanel 权限 · 仅注入 chatgpt.com/, "阅读功能仅用于 chatgpt.com · 文献采集用于普通网页")
    .replace("未打开预览时，不加载 Markdown 解析器。", "支持 Markdown、公式和代码块。")
    .replace("Whiteboard · 白板", "知识白板");
  const icon = Component => renderToStaticMarkup(createElement(Component, { "aria-hidden": true }));
  for (const [id, Component, title] of [["wb-undo", ArrowUndo20Regular, "撤销"], ["wb-redo", ArrowRedo20Regular, "重做"], ["wb-zoom-out", Subtract20Regular, "缩小"], ["wb-zoom-in", Add20Regular, "放大"], ["help-toggle", QuestionCircle20Regular, "Markdown 帮助"], ["wb-help", QuestionCircle20Regular, "白板帮助"], ["clear-section", Dismiss20Regular, "取消章节筛选"]]) {
    html = html.replace(new RegExp(`<button id="${id}"[^>]*>[^<]*</button>`), `<button id="${id}" title="${title}" aria-label="${title}">${icon(Component)}</button>`);
  }
  html = html.replace('class="empty-glyph" aria-hidden="true">✎', `class="empty-glyph" aria-hidden="true">${icon(Note20Regular)}`)
    .replace("<span>✦</span>", `<span>${icon(Whiteboard20Regular)}</span>`);
  if (name === "options") html = html.replace('<section><h2>批注管理', '<section><h2>文献采集</h2><p>文献保存在浏览器本地，可导出含快照和 PDF 的归档。将归档中的 PDF 导入 Liteasy 桌面文献库，批注和白板可导出为 Markdown 与 Canvas 文件。</p></section><section><h2>批注管理');
  await writeFile(join(dist, `${name}.html`), html);
  // Keep provenance visible; do not replace Zotero trademarks inside its own integration UI.
}
await cp(join(root, "assets"), dist, { recursive: true });
await writeFile(join(dist, "preferences/preferences.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Liteasy 设置</title><body><a href="../options.html">打开 Liteasy 设置与备份</a></body></html>\n');
// The native batch selector is still upstream behavior, with Fluent surfaces.
const selector = join(dist, "itemSelector/itemSelector.html");
await writeFile(selector, (await readFile(selector, "utf8")).replace("</head>", '<link rel="stylesheet" href="../liteasy-ui.css"></head>'));
await cp(join(root, "LICENSE"), join(dist, "LICENSE"));
await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(dist, "THIRD_PARTY_NOTICES.md"));
await cp(join(root, "upstream.lock.json"), join(dist, "upstream.lock.json"));
await mkdir(join(dist, "licenses"), { recursive: true });
for (const dependency of Object.keys(pkg.dependencies)) {
  const directory = join(root, "node_modules", dependency);
  let copied = false;
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    try {
      await cp(join(directory, file), join(dist, "licenses", dependency.replaceAll("/", "-") + ".txt"));
      copied = true; break;
    } catch { /* next conventional license filename */ }
  }
  if (!copied && dependency === "@fluentui/react-icons") {
    await cp(join(root, "assets/licenses/fluent-icons.txt"), join(dist, "licenses/@fluentui-react-icons.txt"));
    copied = true;
  }
  if (!copied) throw new Error(`未找到依赖许可证：${dependency}`);
}
console.log(`Load unpacked extension: ${dist}`);
