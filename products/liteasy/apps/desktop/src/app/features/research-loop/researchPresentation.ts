import type { ExperimentRun, ResearchTaskDetail } from "./researchHostClient";

export function researchRunLabel(detail: ResearchTaskDetail, run: ExperimentRun) {
  const spec = detail.records.find((record) => record.id === run.specId && record.hash === run.specHash);
  const candidate = spec?.body.candidate;
  const name = candidate === "sequential" ? "顺序预取" : candidate === "last_delta" ? "最近差值预测" : "实验";
  return `第 ${detail.runs.indexOf(run) + 1} 次实验 · ${name}`;
}
