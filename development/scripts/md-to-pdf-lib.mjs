import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const developmentRoot = path.dirname(scriptDir);
const repoRoot = path.dirname(developmentRoot);
const toolPackageDir = path.join(developmentRoot, "tools", "md-to-pdf");

const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkd"]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function escapeScriptString(value) {
  return JSON.stringify(String(value));
}

function renderInline(markdown) {
  let html = escapeHtml(markdown);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeAttribute(href)}">${label}</a>`;
  });
  return html;
}

function isFenceStart(line) {
  return line.trimStart().startsWith("```");
}

function getFenceLanguage(line) {
  return line.trim().slice(3).trim().split(/\s+/)[0].toLowerCase();
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function renderTable(lines) {
  const [headerLine, _dividerLine, ...bodyLines] = lines;
  const headers = splitTableRow(headerLine);
  const bodyRows = bodyLines.map(splitTableRow);

  return [
    "<table>",
    "<thead>",
    `<tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr>`,
    "</thead>",
    "<tbody>",
    ...bodyRows.map((row) => {
      return `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`;
    }),
    "</tbody>",
    "</table>"
  ].join("\n");
}

function renderFence(language, content) {
  if (language === "mermaid") {
    return `<div class="mermaid">${escapeHtml(content.trim())}</div>`;
  }

  const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : "";
  return `<pre><code${languageClass}>${escapeHtml(content.replace(/\n$/, ""))}</code></pre>`;
}

function renderMarkdownBody(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraphLines = [];
  let listType = null;
  let inFence = false;
  let fenceLanguage = "";
  let fenceLines = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }
    html.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  }

  function closeList() {
    if (!listType) {
      return;
    }
    html.push(`</${listType}>`);
    listType = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (inFence) {
      if (isFenceStart(line)) {
        html.push(renderFence(fenceLanguage, fenceLines.join("\n")));
        inFence = false;
        fenceLanguage = "";
        fenceLines = [];
        continue;
      }
      fenceLines.push(line);
      continue;
    }

    if (isFenceStart(line)) {
      flushParagraph();
      closeList();
      inFence = true;
      fenceLanguage = getFenceLanguage(line);
      fenceLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    if (
      trimmed.includes("|") &&
      index + 1 < lines.length &&
      isTableDivider(lines[index + 1])
    ) {
      flushParagraph();
      closeList();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(renderTable(tableLines));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const blockquote = /^>\s?(.+)$/.exec(trimmed);
    if (blockquote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInline(blockquote[1])}</blockquote>`);
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") {
        closeList();
      }
      if (!listType) {
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") {
        closeList();
      }
      if (!listType) {
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    paragraphLines.push(trimmed);
  }

  if (inFence) {
    html.push(renderFence(fenceLanguage, fenceLines.join("\n")));
  }
  flushParagraph();
  closeList();

  return html.join("\n");
}

function extractTitle(markdown, inputPath) {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading) {
    return heading[1].trim();
  }
  return path.basename(inputPath);
}

export function getDefaultOutputPath(inputPath) {
  const extension = path.extname(inputPath);
  if (markdownExtensions.has(extension.toLowerCase())) {
    return path.join(path.dirname(inputPath), `${path.basename(inputPath, extension)}.pdf`);
  }
  return `${inputPath}.pdf`;
}

export function parseCliArgs(args) {
  let inputPath = null;
  let outputPath = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--output" || arg === "-o") {
      outputPath = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`未知参数：${arg}`);
    }
    if (inputPath) {
      throw new Error(`只能传入一个 Markdown 文件；多余参数：${arg}`);
    }
    inputPath = arg;
  }

  if (!inputPath) {
    return { help: true };
  }

  return {
    inputPath,
    outputPath: outputPath ?? getDefaultOutputPath(inputPath)
  };
}

export function buildPrintableHtml({ inputPath, markdown, mermaidModuleUrl }) {
  const title = extractTitle(markdown, inputPath);
  const body = renderMarkdownBody(markdown);
  const mermaidScript = mermaidModuleUrl
    ? `
<script src="${escapeAttribute(mermaidModuleUrl)}"></script>
<script>
  window.__liteasyMermaidReady = (async () => {
    try {
      const mermaid = window.mermaid;
      if (!mermaid) {
        throw new Error("Mermaid browser bundle was not loaded.");
      }
      mermaid.initialize({
        flowchart: { htmlLabels: true, useMaxWidth: true },
        securityLevel: "strict",
        startOnLoad: false,
        theme: "default"
      });
      await mermaid.run({ querySelector: ".mermaid" });
      document.documentElement.classList.add("mermaid-ready");
    } catch (error) {
      document.documentElement.classList.add("mermaid-error");
      const message = document.createElement("pre");
      message.className = "render-error";
      message.textContent = String(error && error.message ? error.message : error);
      document.body.prepend(message);
      throw error;
    }
  })();
</script>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    margin: 16mm 14mm;
    size: A4;
  }

  * {
    box-sizing: border-box;
  }

  body {
    color: #1f2933;
    font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.62;
    margin: 0;
  }

  h1, h2, h3, h4, h5, h6 {
    color: #111827;
    line-height: 1.28;
    margin: 1.35em 0 0.55em;
    page-break-after: avoid;
  }

  h1 {
    border-bottom: 1px solid #d8dee9;
    font-size: 26px;
    padding-bottom: 8px;
  }

  h2 {
    border-bottom: 1px solid #e5e7eb;
    font-size: 20px;
    padding-bottom: 5px;
  }

  h3 {
    font-size: 16px;
  }

  p {
    margin: 0.55em 0;
  }

  a {
    color: #0f5ea8;
    text-decoration: none;
  }

  code {
    background: #f3f4f6;
    border-radius: 4px;
    color: #111827;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.92em;
    padding: 0.12em 0.32em;
  }

  pre {
    background: #f7f8fa;
    border: 1px solid #d8dee9;
    border-radius: 6px;
    overflow-wrap: anywhere;
    padding: 10px 12px;
    white-space: pre-wrap;
  }

  pre code {
    background: transparent;
    padding: 0;
  }

  table {
    border-collapse: collapse;
    margin: 0.9em 0;
    page-break-inside: avoid;
    width: 100%;
  }

  th, td {
    border: 1px solid #d8dee9;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }

  th {
    background: #eef2f7;
    color: #111827;
    font-weight: 700;
  }

  blockquote {
    border-left: 4px solid #93a4b8;
    color: #52606d;
    margin: 0.8em 0;
    padding-left: 12px;
  }

  ul, ol {
    margin: 0.45em 0 0.8em 1.4em;
    padding: 0;
  }

  li {
    margin: 0.25em 0;
  }

  .mermaid {
    background: #ffffff;
    border: 1px solid #d8dee9;
    border-radius: 6px;
    margin: 14px 0 18px;
    overflow: visible;
    padding: 12px;
    page-break-inside: avoid;
    text-align: center;
  }

  .mermaid svg {
    height: auto !important;
    max-width: 100% !important;
  }

  .render-error {
    background: #fff1f2;
    border: 1px solid #fda4af;
    color: #9f1239;
  }
</style>
</head>
<body>
${body}
${mermaidScript}
</body>
</html>`;
}

function candidatePackageBaseDirs(extraBaseDirs = []) {
  return [
    ...extraBaseDirs,
    process.cwd(),
    toolPackageDir,
    developmentRoot,
    path.join(repoRoot, "products", "liteasy", "apps", "desktop"),
    scriptDir,
    repoRoot
  ];
}

function packageJsonPath(packageName, baseDir) {
  return path.join(baseDir, "node_modules", ...packageName.split("/"), "package.json");
}

export function findNodePackageRoot(packageName, extraBaseDirs = []) {
  const visited = new Set();

  for (const baseDir of candidatePackageBaseDirs(extraBaseDirs)) {
    let current = path.resolve(baseDir);
    while (!visited.has(`${packageName}:${current}`)) {
      visited.add(`${packageName}:${current}`);
      const packagePath = packageJsonPath(packageName, current);
      if (fs.existsSync(packagePath)) {
        return path.dirname(packagePath);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return null;
}

export function getToolInstallCommand() {
  const relativeToolDir = path.relative(repoRoot, toolPackageDir) || ".";
  return `npm install --prefix ${relativeToolDir} --registry=https://registry.npmjs.org`;
}

export function getMissingDependencyMessage(missing) {
  return [
    `缺少 Markdown 转 PDF 依赖：${missing.join(", ")}。`,
    `请先运行：${getToolInstallCommand()}`,
    "如果 Chromium 不存在，再运行：npx playwright install chromium"
  ].join("\n");
}

export function resolveMermaidModuleUrl(extraBaseDirs = []) {
  const mermaidRoot = findNodePackageRoot("mermaid", extraBaseDirs);
  if (!mermaidRoot) {
    return null;
  }

  const candidates = [
    path.join(mermaidRoot, "dist", "mermaid.min.js"),
    path.join(mermaidRoot, "dist", "mermaid.js"),
    path.join(mermaidRoot, "dist", "mermaid.esm.min.mjs"),
    path.join(mermaidRoot, "dist", "mermaid.esm.mjs")
  ];
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate));
  return modulePath ? pathToFileURL(modulePath).href : null;
}

export function loadPlaywrightCore(extraBaseDirs = []) {
  const packageRoot = findNodePackageRoot("playwright-core", extraBaseDirs);
  if (!packageRoot) {
    return null;
  }
  const require = createRequire(path.join(packageRoot, "package.json"));
  return require("playwright-core");
}

function executableCandidatesFromPlaywrightCache() {
  const cacheRoot = path.join(os.homedir(), ".cache", "ms-playwright");
  if (!fs.existsSync(cacheRoot)) {
    return [];
  }

  return fs.readdirSync(cacheRoot)
    .filter((entry) => entry.startsWith("chromium"))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .flatMap((entry) => [
      path.join(cacheRoot, entry, "chrome-linux64", "chrome"),
      path.join(cacheRoot, entry, "chrome-linux", "chrome"),
      path.join(cacheRoot, entry, "chrome-linux", "headless_shell")
    ]);
}

export function findChromiumExecutable() {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ].filter(Boolean);
  const candidates = [
    ...envCandidates,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...executableCandidatesFromPlaywrightCache()
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function hasMermaidFence(markdown) {
  return /^```mermaid\s*$/im.test(markdown);
}

export async function renderMarkdownFileToPdf({ inputPath, outputPath }) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath ?? getDefaultOutputPath(inputPath));
  const markdown = fs.readFileSync(resolvedInput, "utf8");
  const missing = [];
  const playwright = loadPlaywrightCore([path.dirname(resolvedInput)]);
  const mermaidModuleUrl = hasMermaidFence(markdown)
    ? resolveMermaidModuleUrl([path.dirname(resolvedInput)])
    : null;

  if (!playwright) {
    missing.push("playwright-core");
  }
  if (hasMermaidFence(markdown) && !mermaidModuleUrl) {
    missing.push("mermaid");
  }
  if (missing.length > 0) {
    throw new Error(getMissingDependencyMessage(missing));
  }

  const chromiumExecutable = findChromiumExecutable();
  if (!chromiumExecutable) {
    throw new Error(
      [
        "未找到 Chromium/Chrome 可执行文件，无法导出 PDF。",
        "请安装 Chromium/Chrome，或运行：npx playwright install chromium",
        "也可以设置 CHROME_PATH 指向浏览器可执行文件。"
      ].join("\n")
    );
  }

  const html = buildPrintableHtml({
    inputPath: resolvedInput,
    markdown,
    mermaidModuleUrl
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-md-pdf-"));
  const tempHtmlPath = path.join(tempDir, "document.html");
  fs.writeFileSync(tempHtmlPath, html, "utf8");
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

  const browser = await playwright.chromium.launch({
    executablePath: chromiumExecutable,
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        height: 1123,
        width: 794
      }
    });
    await page.goto(pathToFileURL(tempHtmlPath).href, {
      waitUntil: "load"
    });

    if (hasMermaidFence(markdown)) {
      await page.waitForFunction(() => window.__liteasyMermaidReady, null, {
        timeout: 30000
      });
      await page.evaluate(() => window.__liteasyMermaidReady);
    }

    await page.emulateMedia({ media: "print" });
    await page.pdf({
      format: "A4",
      margin: {
        bottom: "16mm",
        left: "14mm",
        right: "14mm",
        top: "16mm"
      },
      path: resolvedOutput,
      printBackground: true
    });
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { force: true, recursive: true });
  }

  return resolvedOutput;
}
