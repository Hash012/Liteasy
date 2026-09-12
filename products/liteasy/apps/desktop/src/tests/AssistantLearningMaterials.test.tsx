import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { runAgentArtifactAnalysis } from "../app/controllers/agent/runAgentArtifactAnalysis";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import type { ArtifactType } from "../app/features/artifacts/artifact.types";

const paper = { id: "material-paper", title: "Learning Materials Paper" };
function client() {
  const send = vi.fn<FrontendAgentClient["send"]>(async (input) => ({ ok: true, data: {
    apiVersion: "liteasy.agent/v1", createdAt: "2026-09-12T00:00:00Z", events: [],
    idempotencyKey: "materials-test", input, runId: "materials-run", sessionId: "materials-session", status: "completed"
  } }));
  return { send, subscribe: vi.fn(() => vi.fn()), connect: vi.fn(async () => {}),
    getSession: () => ({ sessionId: "materials-session", status: "active" }),
    close: vi.fn(), cancel: vi.fn(), confirm: vi.fn()
  } as unknown as FrontendAgentClient & { send: typeof send };
}
afterEach(() => localStorage.clear());

test.each([
  ["制作PPT", "ppt"], ["制作提纲", "tree"], ["生成思维导图", "mindmap"],
  ["生成对比表", "comparison_table"], ["生成分层关系图", "layered_graph"]
] as const)("selects /%s and submits the scoped workflow through the public Agent bridge", async (label, type) => {
  const user = userEvent.setup();
  const agentClient = client();
  let generation: Promise<unknown> | undefined;
  const onGenerateArtifact = vi.fn((artifactType: ArtifactType, paperIds?: string[], context?: string) => {
    generation = runAgentArtifactAnalysis(agentClient, artifactType, undefined, {
      sourcePaperIds: paperIds, supplementalContext: context
    });
    return "正在生成学习资料";
  });
  render(<AssistantPane agentClient={agentClient} availablePapers={[paper]} selectedPapers={[paper]}
    onGenerateArtifact={onGenerateArtifact}
    selectedSetStatus={{ importedCount: 1, selectedCount: 1, selectionLocked: true }} />);
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(input, "/");
  const menu = screen.getByLabelText("输入候选");
  // Adding materials must not make the existing commands after the eighth item unreachable.
  expect(within(menu).getByRole("button", { name: /把 AI 助手放到下栏/ })).toBeInTheDocument();
  await user.click(within(menu).getByRole("button", { name: new RegExp(label) }));
  expect(input).toHaveValue(`/${label} `);
  expect(document.querySelector(".assistant-command-chip")).toHaveTextContent(`/${label}`);
  expect(onGenerateArtifact).not.toHaveBeenCalled();
  await user.type(input, "面向初学者，包含对比表");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(onGenerateArtifact).toHaveBeenCalledWith(type, [paper.id], expect.stringContaining("面向初学者，包含对比表")));
  await generation;
  expect(agentClient.send).toHaveBeenCalledTimes(1);
  expect(agentClient.send).toHaveBeenCalledWith(expect.objectContaining({
    artifactType: type, mode: "qa", message: expect.stringContaining("面向初学者，包含对比表")
  }), expect.objectContaining({
    attachments: [expect.objectContaining({ source: "selection", metadata: { paperIds: [paper.id] } })],
    idempotencyKey: expect.stringContaining(`artifact:${type}:`)
  }));
});

test("keeps @ paper scope and requirements when starting an outline without a locked selection", async () => {
  const user = userEvent.setup();
  const onGenerateArtifact = vi.fn(() => "正在生成学习资料");
  render(<AssistantPane agentClient={client()} availablePapers={[paper]} onGenerateArtifact={onGenerateArtifact}
    selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} />);
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(input, "@");
  await user.click(within(screen.getByLabelText("输入候选")).getByRole("button", { name: /Learning Materials Paper 整篇论文/ }));
  await user.type(input, "/制作提纲 讲清方法与局限");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(onGenerateArtifact).toHaveBeenCalledWith("tree", [paper.id], expect.stringContaining("讲清方法与局限")));
  expect(onGenerateArtifact.mock.calls[0][2]).toContain(paper.title);
});
