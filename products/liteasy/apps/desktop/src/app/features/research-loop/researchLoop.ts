import { z } from "zod";

export const researchReviewSchema = z.strictObject({
  plan: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  gaps: z.array(z.strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    kind: z.enum(["missing_source", "conflicting_evidence", "unsupported_claim", "user_constraint"]),
    question: z.string().trim().min(1).max(600),
    status: z.enum(["open", "addressed", "blocked"]),
    evidencePaths: z.array(z.string().max(8192)).max(12),
    resolution: z.string().max(1200)
  })).max(16)
}).superRefine((value, context) => {
  if (new Set(value.gaps.map((gap) => gap.id)).size !== value.gaps.length) context.addIssue({ code: "custom", message: "缺口 ID 不得重复" });
});

export type EvidenceGap = z.infer<typeof researchReviewSchema>["gaps"][number];
export type ResearchDecision = "retrieve_more" | "compare" | "revise" | "abstain" | "request_user";
export type ResearchStopReason = "task_completed" | "needs_review" | "loop_exhausted" | "context_exhausted" | "request_user" | "waiting_confirmation" | "interrupted";
export type ResearchTask = {
  schema: "liteasy.research-loop/v1";
  task: { id: string; goal: string };
  plan: string[];
  gaps: EvidenceGap[];
  decision?: ResearchDecision;
  stopReason?: ResearchStopReason;
  status: "running" | "completed" | "needs_review" | "exhausted" | "waiting_user" | "interrupted";
  semanticStatus: "unverified";
  reviewRounds: number;
  stagnantRounds: number;
  checkpoint: {
    readAssets: Array<{ path: string; revision?: string; offset: number; includedCharacters: number }>;
    mutations: "confirmation_required";
  };
};

export function startResearchTask(id: string, goal: string): ResearchTask {
  return { schema: "liteasy.research-loop/v1", task: { id, goal: goal.slice(0, 4000) }, plan: [], gaps: [], status: "running", semanticStatus: "unverified", reviewRounds: 0, stagnantRounds: 0, checkpoint: { readAssets: [], mutations: "confirmation_required" } };
}

const savedTaskSchema = z.strictObject({
  schema: z.literal("liteasy.research-loop/v1"),
  task: z.strictObject({ id: z.string().max(200), goal: z.string().max(4000) }),
  plan: z.array(z.string().max(300)).max(8),
  gaps: researchReviewSchema.shape.gaps,
  decision: z.enum(["retrieve_more", "compare", "revise", "abstain", "request_user"]).optional(),
  stopReason: z.enum(["task_completed", "needs_review", "loop_exhausted", "context_exhausted", "request_user", "waiting_confirmation", "interrupted"]).optional(),
  status: z.enum(["running", "completed", "needs_review", "exhausted", "waiting_user", "interrupted"]),
  semanticStatus: z.literal("unverified"),
  reviewRounds: z.number().int().min(0).max(16),
  stagnantRounds: z.number().int().min(0).max(16),
  checkpoint: z.strictObject({
    readAssets: z.array(z.strictObject({ path: z.string().max(8192), revision: z.string().max(512).optional(), offset: z.number().int().min(0), includedCharacters: z.number().int().min(0) })).max(50),
    mutations: z.literal("confirmation_required")
  })
});

/** Restored planning snapshots are display/history only; they never replay tools or authority. */
export function parseResearchTask(raw: unknown): ResearchTask | undefined {
  const parsed = savedTaskSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const task = parsed.data;
  if (task.stopReason === "task_completed" && task.gaps.some((gap) => gap.status !== "addressed")) return stopResearchTask(task, "needs_review");
  return task.stopReason ? stopResearchTask(task, task.stopReason) : stopResearchTask(task, "interrupted");
}

/** A model's gap assessment is planning data, never a semantic-verification receipt.
 * The host only validates actual reads and budgets; it does not claim to judge truth. */
export function reviewResearchTask(task: ResearchTask, raw: unknown, readAssets: ResearchTask["checkpoint"]["readAssets"], remainingOperations: number): ResearchTask {
  const review = researchReviewSchema.parse(raw);
  const paths = new Set(readAssets.filter((asset) => asset.includedCharacters > 0).map((asset) => asset.path));
  const gaps = review.gaps.map((gap): EvidenceGap => {
    const previous = task.gaps.find((item) => item.id === gap.id);
    if (previous && previous.kind !== gap.kind) throw new Error("已有缺口的类别不能更改；请保留原问题并单独记录新的缺口。");
    const evidencePaths = [...new Set(gap.evidencePaths)].filter((path) => paths.has(path));
    const minimum = gap.kind === "conflicting_evidence" ? 2 : 1;
    // User constraints can only be clarified by another user turn, never resolved by a model assertion.
    const addressed = gap.status === "addressed" && gap.kind !== "user_constraint" && evidencePaths.length >= minimum && !!gap.resolution.trim();
    return { ...gap, evidencePaths, status: addressed ? "addressed" : gap.status === "blocked" ? "blocked" : "open" };
  });
  // Do not let a subsequent planning response silently erase an unresolved question.
  for (const old of task.gaps) if (old.status !== "addressed" && !gaps.some((gap) => gap.id === old.id)) gaps.push(old);
  if (!paths.size && !gaps.some((gap) => gap.status !== "addressed")) gaps.push({ id: "source-required", kind: "missing_source", question: "尚未读取任何实际依据，请先读取与研究问题有关的来源。", status: "open", evidencePaths: [], resolution: "" });
  if (gaps.length > 16) throw new Error("研究最多跟踪 16 个缺口；先处理已有问题再扩大范围。");
  const identical = JSON.stringify(gaps) === JSON.stringify(task.gaps) && JSON.stringify(readAssets) === JSON.stringify(task.checkpoint.readAssets);
  const stagnantRounds = identical ? task.stagnantRounds + 1 : 0;
  const open = gaps.filter((gap) => gap.status !== "addressed");
  let decision: ResearchDecision | undefined;
  if (open.some((gap) => gap.kind === "user_constraint")) decision = "request_user";
  else if (open.length && (open.some((gap) => gap.status === "blocked") || stagnantRounds >= 2 || remainingOperations <= 1)) decision = "abstain";
  else if (open.some((gap) => gap.kind === "missing_source")) decision = "retrieve_more";
  else if (open.some((gap) => gap.kind === "conflicting_evidence")) decision = "compare";
  else if (open.some((gap) => gap.kind === "unsupported_claim")) decision = "revise";
  const next: ResearchTask = { ...task, plan: review.plan, gaps, decision, reviewRounds: task.reviewRounds + 1, stagnantRounds, checkpoint: { readAssets, mutations: "confirmation_required" } };
  if (decision === "request_user") return stopResearchTask(next, "request_user");
  if (decision === "abstain") return stopResearchTask(next, remainingOperations <= 1 ? "loop_exhausted" : "needs_review");
  return next;
}

export function stopResearchTask(task: ResearchTask, stopReason: ResearchStopReason): ResearchTask {
  return { ...task, stopReason, status: stopReason === "task_completed" ? "completed" : stopReason === "loop_exhausted" || stopReason === "context_exhausted" ? "exhausted" : stopReason === "request_user" || stopReason === "waiting_confirmation" ? "waiting_user" : stopReason === "interrupted" ? "interrupted" : "needs_review" };
}

const decisionLabels: Record<ResearchDecision, string> = { retrieve_more: "补充来源", compare: "对照分歧", revise: "修订缺少依据的结论", abstain: "保留未解决问题", request_user: "请补充研究条件" };
const stopLabels: Record<ResearchStopReason, string> = { task_completed: "研究步骤已完成，结论仍未经独立语义核验", needs_review: "研究已暂停，仍有问题需要复核", loop_exhausted: "操作预算已用完，研究尚未完成", context_exhausted: "上下文预算已用完，研究尚未完成", request_user: "需要你补充研究条件", waiting_confirmation: "等待确认修改，尚未写入", interrupted: "连接中断，研究尚未完成" };
export function researchTaskSummary(task: ResearchTask): string {
  const heading = task.stopReason ? stopLabels[task.stopReason] : task.decision ? decisionLabels[task.decision] : "整理研究计划";
  const questions = task.gaps.filter((gap) => gap.status !== "addressed").map((gap) => `- ${gap.question}`);
  return [heading, questions.length ? `待解决问题：\n${questions.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

export const researchToolInstruction = "证据密集的比较、综合或研究任务可用 action=research, text=JSON 提交计划及缺口；简单问答无需调用。格式 {plan:[步骤],gaps:[{id,kind:missing_source/conflicting_evidence/unsupported_claim/user_constraint,question,status:open/addressed/blocked,evidencePaths:[实际已读的完整路径],resolution}]}。宿主返回 retrieve_more/compare/revise/abstain/request_user；按该决定补充读取、对照实际段落或删改无依据的结论，再 research 更新同一缺口，不可直接消失。addressed 只是你的判断，不能称为独立核验；冲突至少读取两个不同来源。需要用户选择范围时用 user_constraint。";
