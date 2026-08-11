import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../../../..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return resolve(process.cwd(), index >= 0 ? process.argv[index + 1] : fallback);
}

function valueArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : "";
}

const datasetPath = argument(
  "--dataset",
  resolve(repositoryRoot, "development/test-data/thin-reading-multimodal/planner-decision-evaluation.v2.json")
);
const checklistPath = argument(
  "--checklist",
  resolve(repositoryRoot, "development/test-data/thin-reading-multimodal/planner-decision-expert-review.md")
);
const casesPath = argument(
  "--cases",
  resolve(repositoryRoot, "development/test-data/thin-reading-multimodal/planner-decision-cases.v1.json")
);

function mark(decision, expected) {
  return decision === expected ? "x" : " ";
}

function writeChecklist() {
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const caseDefinitions = JSON.parse(readFileSync(casesPath, "utf8"));
  const translations = new Map((caseDefinitions.cases ?? []).map((item) => [item.id, item.reviewZh]));
  const lines = [
    "# 多模态生成决策盲审清单",
    "",
    "判据：只根据输入判断，一张受控生成图是否比正文显著改善结构、过程、几何、比较或证据关系的理解。不要查看供应商录制字段或模型实际决策。",
    "",
    "以下内容是与原始英文输入逐条绑定的审核用中文翻译；模型输入、响应和哈希均未改变。",
    "",
    "每条必须且只能勾选一个选项，并在同一行 `理由：` 后填写至少 12 个字符的判断理由。完成后由领域专家运行清单中最后给出的命令。",
    ""
  ];
  for (const record of dataset.records ?? []) {
    const translation = translations.get(record.caseId);
    const evidenceTranslations = new Map((translation?.evidence ?? []).map((item) => [item.id, item.text]));
    const evidenceIds = record.input.evidence.map((item) => item.id);
    if (!translation?.title || !translation.question || evidenceTranslations.size !== evidenceIds.length ||
      evidenceIds.some((id) => !evidenceTranslations.has(id))) {
      throw new Error(`缺少完整中文审核翻译：${record.caseId}`);
    }
    lines.push(
      `## ${record.caseId}`,
      "",
      `标题：${translation.title}`,
      "",
      `任务：${translation.question}`,
      "",
      "证据："
    );
    for (const evidence of record.input.evidence ?? []) {
      lines.push(`> 第 ${evidence.page} 页 [${evidence.id}] ${evidenceTranslations.get(evidence.id)}`);
    }
    lines.push(
      "",
      `- [${mark(record.review?.decision, "generate")}] 生成`,
      `- [${mark(record.review?.decision, "omit")}] 省略`,
      `理由：${record.review?.rationale ?? ""}`,
      ""
    );
  }
  lines.push(
    "完成后运行：",
    "",
    "```bash",
    "npm run label:multimodal-decisions -- --apply --reviewer-id <domain-expert-id>",
    "```",
    ""
  );
  writeFileSync(checklistPath, lines.join("\n"), "utf8");
  process.stdout.write(`Wrote blind expert checklist for ${dataset.records?.length ?? 0} cases: ${checklistPath}\n`);
}

function parseChecklist(content) {
  const labels = new Map();
  let current;
  for (const line of content.split(/\r?\n/u)) {
    const heading = line.match(/^##\s+([a-z0-9][a-z0-9-]{2,79})$/u);
    if (heading) {
      current = { decisions: [], rationale: "" };
      labels.set(heading[1], current);
      continue;
    }
    if (!current) continue;
    const decision = line.match(/^- \[([xX ])\] (生成|省略)$/u);
    if (decision?.[1].toLowerCase() === "x") current.decisions.push(decision[2] === "生成" ? "generate" : "omit");
    const rationale = line.match(/^理由：\s*(.*)$/u);
    if (rationale) current.rationale = rationale[1].trim();
  }
  return labels;
}

function applyChecklist() {
  const reviewerId = valueArgument("--reviewer-id");
  if (!/^[A-Za-z0-9._:@-]{3,160}$/u.test(reviewerId)) {
    throw new Error("A stable --reviewer-id for the domain expert is required");
  }
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const labels = parseChecklist(readFileSync(checklistPath, "utf8"));
  const errors = [];
  for (const record of dataset.records ?? []) {
    const label = labels.get(record.caseId);
    if (!label || label.decisions.length !== 1) errors.push(`${record.caseId}: select exactly one decision`);
    if (!label || label.rationale.length < 12) errors.push(`${record.caseId}: rationale must be at least 12 characters`);
  }
  if (errors.length > 0) throw new Error(`Expert review is incomplete:\n${errors.join("\n")}`);

  const reviewedAt = new Date().toISOString();
  for (const record of dataset.records) {
    const label = labels.get(record.caseId);
    record.review = {
      decision: label.decisions[0],
      rationale: label.rationale,
      reviewedAt,
      reviewerId,
      reviewerRole: "domain_expert"
    };
  }
  writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  process.stdout.write(`Applied ${dataset.records.length} domain-expert labels to ${datasetPath}\n`);
}

if (process.argv.includes("--apply")) applyChecklist();
else writeChecklist();
