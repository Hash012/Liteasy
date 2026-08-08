/**
 * Turns the retrieval gate worksheet into a readable checklist and back again, so the
 * judging happens in prose rather than in JSON.
 *
 *   node scripts/retrieval-gate-label.mjs            写出 retrieval-gate-labels.md
 *   node scripts/retrieval-gate-label.mjs --apply    把清单里的判断写回 worksheet JSON
 *   node scripts/retrieval-gate-label.mjs --worksheet <path> --checklist <path>
 *   node scripts/retrieval-gate-label.mjs --worksheet <path> --carry-forward <old worksheet>
 *
 * In the checklist, mark each line by replacing the space in the box:
 *   [y] 相关    [n] 不相关    [ ] 还没判断（按不相关计，且验证门会提示未完成）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolvedArgumentPath(flag, fallback) {
  const value = argumentValue(flag);
  return value ? path.resolve(process.cwd(), value) : fallback;
}

const worksheetPath = resolvedArgumentPath(
  "--worksheet",
  path.join(scriptDir, "retrieval-gate-worksheet.json")
);
const checklistPath = resolvedArgumentPath(
  "--checklist",
  path.join(scriptDir, "retrieval-gate-labels.md")
);
const carryForwardPath = resolvedArgumentPath("--carry-forward", undefined);

const domainLabel = { humanities: "人文社科", stem: "理工" };
const languageLabel = { en: "英文", zh: "中文" };
const queryPathLabel = { direct: "直接检索", translated: "先译成英文" };

function relationNote(relation) {
  // relationToTarget(): cited_by_target means the paper being read lists this source in its
  // own references; cites_target means this source cites the paper being read.
  if (relation === "cited_by_target") return "本文的参考文献";
  if (relation === "cites_target") return "它引用了本文";
  if (relation === "co_cited") return "常与本文一同被引";
  if (relation === "bibliographic_coupling") return "与本文引用了同一批文献";
  if (relation === "related") return "被标注为相关";
  return "主题检索命中";
}

function markBox(relevant) {
  if (relevant === true) return "y";
  if (relevant === false) return "n";
  return " ";
}

function normalizeLabelIdentity(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function carryForwardExactLabels(worksheet, previousWorksheet) {
  const previousLabels = new Map();
  for (const anchor of previousWorksheet.anchors ?? []) {
    for (const result of anchor.results ?? []) {
      if (typeof result.relevant !== "boolean") continue;
      const key = [anchor.anchorId, result.sourceId, normalizeLabelIdentity(result.title)].join("\u0000");
      previousLabels.set(key, result.relevant);
    }
  }

  let carried = 0;
  for (const anchor of worksheet.anchors ?? []) {
    for (const result of anchor.results ?? []) {
      const key = [anchor.anchorId, result.sourceId, normalizeLabelIdentity(result.title)].join("\u0000");
      if (!previousLabels.has(key)) continue;
      result.relevant = previousLabels.get(key);
      result.labelProvenance = "carried_forward_exact_identity";
      carried += 1;
    }
  }
  worksheet.labelCarryForward = {
    carried,
    sourceGeneratedAt: previousWorksheet.generatedAt ?? null,
    sourcePath: path.basename(carryForwardPath)
  };
  return carried;
}

function writeChecklist() {
  const worksheet = JSON.parse(fs.readFileSync(worksheetPath, "utf8"));
  let carried = 0;
  if (carryForwardPath) {
    const previousWorksheet = JSON.parse(fs.readFileSync(carryForwardPath, "utf8"));
    carried = carryForwardExactLabels(worksheet, previousWorksheet);
    fs.writeFileSync(worksheetPath, `${JSON.stringify(worksheet, null, 2)}\n`, "utf8");
  }
  const lines = [
    "# 检索精度验证门 · 打标清单",
    "",
    "判据：**这条文献是否真的在解释那个锚点**。不是「同一领域」，也不是「标题里出现了那个词」。",
    "",
    "把方框里的空格改成 `y`（相关）或 `n`（不相关）。留空表示还没判断，会按不相关计。",
    `改完运行：\`node scripts/retrieval-gate-label.mjs --apply --worksheet "${worksheetPath}" --checklist "${checklistPath}"\``,
    "",
    `采样时间：${worksheet.generatedAt ?? "未知"}　活跃来源：${(worksheet.activeSources ?? []).join(" / ")}`,
    ""
  ];

  for (const anchor of worksheet.anchors ?? []) {
    const tags = [
      domainLabel[anchor.domain] ?? anchor.domain,
      languageLabel[anchor.language] ?? anchor.language,
      anchor.queryPath ? queryPathLabel[anchor.queryPath] ?? anchor.queryPath : null
    ].filter(Boolean).join(" · ");
    lines.push(`## ${anchor.anchorId}`, `${tags}　　查询：${anchor.query ?? ""}`, "");
    if (anchor.error) {
      lines.push(`> 检索失败：${anchor.error}`, "");
    }
    if ((anchor.results ?? []).length === 0) {
      lines.push("> 这个锚点没有任何结果，自动按 0 分计，不需要打标。", "");
      continue;
    }
    anchor.results.forEach((result, index) => {
      lines.push(`- [${markBox(result.relevant)}] ${index + 1}. ${result.title || "(无标题)"}`);
      lines.push(`      ${relationNote(result.relation)}${result.openAccessFullText ? " · 有开放全文" : ""}`);
      if (result.url) {
        lines.push(`      ${result.url}`);
      }
    });
    lines.push("");
  }

  fs.writeFileSync(checklistPath, `${lines.join("\n")}\n`, "utf8");
  const total = (worksheet.anchors ?? []).reduce((sum, anchor) => sum + (anchor.results?.length ?? 0), 0);
  const pending = (worksheet.anchors ?? []).reduce(
    (sum, anchor) => sum + (anchor.results ?? []).filter((result) => typeof result.relevant !== "boolean").length,
    0
  );
  process.stdout.write(
    `已写出清单：${checklistPath}\n共 ${total} 条；沿用严格身份匹配标签 ${carried} 条，仍待判断 ${pending} 条。\n`
  );
}

function applyChecklist() {
  const worksheet = JSON.parse(fs.readFileSync(worksheetPath, "utf8"));
  const content = fs.readFileSync(checklistPath, "utf8");
  const byAnchor = new Map();
  let current = "";
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(\S+)/u);
    if (heading) {
      current = heading[1];
      byAnchor.set(current, []);
      continue;
    }
    const item = line.match(/^-\s+\[([yYnN ])\]\s+(\d+)\./u);
    if (item && current) {
      const mark = item[1].toLowerCase();
      byAnchor.get(current).push({
        index: Number(item[2]) - 1,
        relevant: mark === "y" ? true : mark === "n" ? false : null
      });
    }
  }

  let judged = 0;
  let pending = 0;
  for (const anchor of worksheet.anchors ?? []) {
    const marks = byAnchor.get(anchor.anchorId) ?? [];
    for (const mark of marks) {
      const result = anchor.results?.[mark.index];
      if (!result) {
        continue;
      }
      result.relevant = mark.relevant;
      if (mark.relevant === null) {
        pending += 1;
      } else {
        judged += 1;
      }
    }
  }

  fs.writeFileSync(worksheetPath, `${JSON.stringify(worksheet, null, 2)}\n`, "utf8");
  process.stdout.write(`已写回 ${worksheetPath}\n已判断 ${judged} 条，未判断 ${pending} 条。\n`);
  if (pending === 0) {
    process.stdout.write(
      `\n现在出结果：\n  LITEASY_RETRIEVAL_GATE_WORKSHEET="${worksheetPath}" npm run gate:retrieval-report\n`
    );
  }
}

if (process.argv.includes("--apply")) {
  applyChecklist();
} else {
  writeChecklist();
}
