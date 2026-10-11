import { parseResearchTask, reviewResearchTask, startResearchTask, stopResearchTask } from "../app/features/research-loop/researchLoop";
import { parseAssistantHistory } from "../app/features/assistant/assistantHistoryPersistence";

const initial = () => startResearchTask("run-1", "比较两篇论文的证据与反例");
const read = (path: string) => ({ path, revision: "v1", offset: 0, includedCharacters: 120 });
const gap = (overrides: Record<string, unknown> = {}) => ({ id: "gap-1", kind: "missing_source", question: "是否存在相反证据？", status: "open", evidencePaths: [], resolution: "", ...overrides });
const review = (gaps: unknown[]) => ({ plan: ["读取来源", "检索反例", "对照并修订结论"], gaps });

test("a claimed complete plan without actual reads requests evidence", () => {
  const next = reviewResearchTask(initial(), review([]), [], 10);
  expect(next.decision).toBe("retrieve_more");
  expect(next.gaps[0].id).toBe("source-required");
  expect(next.semanticStatus).toBe("unverified");
});

test("a fabricated evidence path cannot resolve a missing-source gap", () => {
  const next = reviewResearchTask(initial(), review([gap({ status: "addressed", evidencePaths: ["not-read"], resolution: "the source agrees" })]), [read("actual-read")], 10);
  expect(next.gaps[0]).toMatchObject({ status: "open", evidencePaths: [] });
  expect(next.decision).toBe("retrieve_more");
});

test("conflicting evidence requires at least two distinct actual sources", () => {
  const proposed = review([gap({ kind: "conflicting_evidence", status: "addressed", resolution: "两个实验条件不同", evidencePaths: ["paper-1", "paper-2"] })]);
  expect(reviewResearchTask(initial(), proposed, [read("paper-1")], 10).decision).toBe("compare");
  const next = reviewResearchTask(initial(), proposed, [read("paper-1"), read("paper-2")], 10);
  expect(next.gaps[0].status).toBe("addressed");
  expect(next.decision).toBeUndefined();
  expect(stopResearchTask(next, "task_completed")).toMatchObject({ status: "completed", semanticStatus: "unverified" });
  expect(reviewResearchTask(next, proposed, [read("paper-1"), read("paper-2")], 1).stopReason).toBeUndefined();
});

test("unresolved gaps cannot disappear on a later planning round", () => {
  const first = reviewResearchTask(initial(), review([gap()]), [read("paper-1")], 10);
  const next = reviewResearchTask(first, review([]), [read("paper-1")], 9);
  expect(next.gaps).toEqual(first.gaps);
  expect(next.decision).toBe("retrieve_more");
});

test("user constraints stop for clarification and cannot be self-resolved", () => {
  const next = reviewResearchTask(initial(), review([gap({ kind: "user_constraint", status: "addressed", evidencePaths: ["paper-1"], resolution: "I guessed the user preference" })]), [read("paper-1")], 8);
  expect(next).toMatchObject({ decision: "request_user", stopReason: "request_user", status: "waiting_user" });
});

test("unsupported claims request revision, blocked evidence requests review", () => {
  expect(reviewResearchTask(initial(), review([gap({ kind: "unsupported_claim" })]), [read("p")], 8).decision).toBe("revise");
  expect(reviewResearchTask(initial(), review([gap({ status: "blocked" })]), [read("p")], 8)).toMatchObject({ decision: "abstain", stopReason: "needs_review" });
});

test("exhaustion and repeated no-progress are not task completion", () => {
  expect(reviewResearchTask(initial(), review([gap()]), [], 1)).toMatchObject({ stopReason: "loop_exhausted", status: "exhausted" });
  let task = reviewResearchTask(initial(), review([gap()]), [], 10);
  task = reviewResearchTask(task, review([gap()]), [], 9);
  task = reviewResearchTask(task, review([gap()]), [], 8);
  expect(task).toMatchObject({ stopReason: "needs_review", status: "needs_review" });
  expect(stopResearchTask(task, "interrupted").status).toBe("interrupted");
});

test("research checkpoints survive chat history while invalid optional state is discarded", () => {
  const task = stopResearchTask(reviewResearchTask(initial(), review([gap()]), [read("paper-1")], 10), "interrupted");
  const parsed = parseAssistantHistory({ version: "liteasy.assistant-history/v1", activeSessionId: "s", sessions: [{ id: "s", title: "research", mode: "qa", messages: [
    { id: "a", role: "assistant", content: "未完成的研究", researchLoop: task },
    { id: "b", role: "assistant", content: "旧消息", researchLoop: { ...task, semanticStatus: "verified" } }
  ] }] });
  expect(parsed?.sessions[0].messages[0].researchLoop).toEqual(task);
  expect(parsed?.sessions[0].messages[1].researchLoop).toBeUndefined();
  expect(parseResearchTask({ ...task, status: "completed", stopReason: "task_completed" })?.status).toBe("needs_review");
});
