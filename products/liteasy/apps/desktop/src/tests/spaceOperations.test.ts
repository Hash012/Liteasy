import { expect, test } from "vitest";
import { projectPdfPublication, projectTransfer, operationRecovery } from "../app/features/spaces/spaceOperations";
const actor = { endpoint: "https://forum.example.test", issuer: "https://identity.example.test", subject: "synthetic-a", scopeType: "user" as const, scopeId: "synthetic-a", sessionGeneration: "one" };
test("public non-plaza copies, unknown outcomes and retracts remain distinct and actor scoped", () => {
  const publication = { actorBinding: actor, desiredVisibility: "public" as const, state: "published" as const, remoteAnnotationId: "annotation-a" };
  const input = { id: "operation-a", title: "Selected annotation", actor, publication };
  expect(projectPdfPublication(input)).toMatchObject({ status: "已发布", audience: expect.stringContaining("不进入广场仍可被公开访问") });
  expect(projectPdfPublication({ ...input, publication: { ...publication, outcome: "unknown" } })).toMatchObject({ status: "待核实", actionLabel: "打开批注核实" });
  expect(projectPdfPublication({ ...input, publication: { ...publication, state: "pending_retract", outcome: "unknown" } })).toMatchObject({ status: "待撤回", detail: expect.stringContaining("尚未确认") });
  expect(projectPdfPublication({ ...input, actor: { ...actor, subject: "b", scopeId: "b" } })).toBeNull();
});
test("staging and cancellation never claim a readable object or a remote retract", () => {
  const transfer = { id: "upload", generation: "one", title: "Upload", target: { scopeType: "user" as const, scopeId: "synthetic-a" } };
  expect(projectTransfer({ ...transfer, phase: "running" })).toMatchObject({ status: "正在处理", detail: expect.stringContaining("不代表已可读取") });
  expect(projectTransfer({ ...transfer, phase: "cancelled" })).toMatchObject({ status: "已取消本次转移", detail: expect.stringContaining("不会撤回已有远端副本") });
  expect(operationRecovery({ status: 409 })).toContain("冲突");
  expect(operationRecovery({ status: 401 })).toContain("重新登录");
  expect(operationRecovery({ status: 403 })).toContain("权限");
  expect(operationRecovery({ code: "quota_exceeded" })).toContain("配额");
});
