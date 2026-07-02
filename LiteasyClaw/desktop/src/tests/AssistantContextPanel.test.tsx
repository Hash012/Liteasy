import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantContextPanel } from "../app/features/assistant/AssistantContextPanel";
import type { AgentRuntimeContextView } from "../app/features/agent-runtime/agentRuntime.types";

function createContext(overrides: Partial<AgentRuntimeContextView> = {}): AgentRuntimeContextView {
  return {
    cloud: {
      connected: true,
      organizationName: "Liteasy AI Reading Lab"
    },
    profile: {
      enabled: false,
      requiresConfirmation: true
    },
    selection: {
      importedCount: 2,
      issues: ["documents_not_imported"],
      locked: true,
      ready: false,
      selectedCount: 3
    },
    workspace: {
      rootPath: "/tmp/LiteasyLibrary",
      type: "local_library"
    },
    ...overrides
  };
}

test("renders a collapsed runtime context summary by default", () => {
  render(<AssistantContextPanel context={createContext()} />);

  expect(screen.getByRole("button", { name: /运行时上下文/ })).toBeInTheDocument();
  expect(
    screen.getByText("上下文 · 选中 3 篇 · 已锁定 · 已导入 2/3 · 云账号已连接 · 画像关闭")
  ).toBeInTheDocument();
  expect(screen.queryByText("Selection")).not.toBeInTheDocument();
});

test("expands grouped context details", async () => {
  const user = userEvent.setup();

  render(<AssistantContextPanel context={createContext()} />);

  await user.click(screen.getByRole("button", { name: /运行时上下文/ }));

  const panel = screen.getByLabelText("运行时上下文详情");
  expect(within(panel).getByText("Selection")).toBeInTheDocument();
  expect(within(panel).getByText("3 篇 · 已锁定 · 已导入 2/3")).toBeInTheDocument();
  expect(within(panel).getByText("需导入")).toBeInTheDocument();
  expect(within(panel).getByText("Workspace")).toBeInTheDocument();
  expect(within(panel).getByText("本地文献库 · /tmp/LiteasyLibrary")).toBeInTheDocument();
  expect(within(panel).getByText("Cloud")).toBeInTheDocument();
  expect(within(panel).getByText("已连接 · Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(panel).getByText("Profile")).toBeInTheDocument();
  expect(within(panel).getByText("画像关闭 · 命令需确认")).toBeInTheDocument();
});
