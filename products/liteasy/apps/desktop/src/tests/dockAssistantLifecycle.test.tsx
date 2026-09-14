import { useState } from "react";
import { createPortal } from "react-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DockSurfaceSlot } from "../app/features/dock/DockSurfaceSlot";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";

test("moving or hiding the chat surface keeps an active run alive and shows its completed answer on return", async () => {
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const api = createAgentApplicationService({
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async (input) => {
      signal = input.signal;
      await new Promise<void>((resolve) => { finish = resolve; });
      input.reportDelta("移动后仍在继续");
      return { message: "移动后完整回答已保留" };
    },
  });
  const cancel = vi.spyOn(api, "cancelRun");
  const client = createFrontendAgentClient(api);
  function Harness() {
    const [host] = useState(() => document.createElement("div"));
    const [location, setLocation] = useState("right");
    return <>
      <button onClick={() => setLocation("bottom")}>移至底栏</button>
      <button onClick={() => setLocation("hidden")}>关闭面板</button>
      <button onClick={() => setLocation("right")}>重新打开</button>
      <section aria-label="右栏">{location === "right" ? <DockSurfaceSlot host={host} /> : null}</section>
      <section aria-label="底栏">{location === "bottom" ? <DockSurfaceSlot host={host} /> : null}</section>
      {createPortal(<AssistantPane agentClient={client} onGenerateArtifact={() => "unused"}
        selectedSetStatus={{ selectedCount: 0, importedCount: 0, selectionLocked: false }} />, host)}
    </>;
  }
  const user = userEvent.setup();
  render(<Harness />);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "继续这个问题");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(signal).toBeDefined());
  await user.click(screen.getByRole("button", { name: "移至底栏" }));
  expect(screen.getByRole("region", { name: "底栏" }).querySelector(".assistant-pane")).toBeTruthy();
  expect(signal!.aborted).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "关闭面板" }));
  expect(signal!.aborted).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  await user.click(screen.getByRole("button", { name: "重新打开" }));
  expect(await screen.findByText("移动后完整回答已保留")).toBeInTheDocument();
  expect(cancel).not.toHaveBeenCalled();
});
