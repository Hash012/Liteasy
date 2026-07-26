import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantContextPanel } from "../app/features/assistant/AssistantContextPanel";
import { buildIntentRuntimeContexts } from "../app/features/agent-runtime/contextBuilder";
import type { AgentRuntimeContextView } from "../app/features/agent-runtime/agentRuntime.types";

function createContext(overrides: Partial<AgentRuntimeContextView> = {}): AgentRuntimeContextView {
  return {
    cloud: {
      connected: true,
      organizationName: "Liteasy AI Reading Lab"
    },
    profile: { enabled: false, requiresConfirmation: true },
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
    screen.getByText("上下文 · 选中 3 篇 · 已锁定 · 已导入 2/3 · 云账号已连接 · 用户画像已关闭")
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
  expect(within(panel).getByText("待补充学科或研究阶段")).toBeInTheDocument();
});

test("renders the same context view produced for planner and policy contexts", async () => {
  const user = userEvent.setup();
  const bundle = buildIntentRuntimeContexts({
    contextView: createContext({
      cloud: {
        connected: false
      },
      profile: {
        enabled: true,
        personalizationSummary: "研究阶段：博士研究生"
      },
      selection: {
        importedCount: 0,
        issues: ["selection_empty", "selection_unlocked", "workspace_unknown"],
        locked: false,
        ready: false,
        selectedCount: 0
      },
      workspace: {
        type: "unknown"
      }
    })
  });

  render(<AssistantContextPanel context={bundle.contextView!} />);

  await user.click(screen.getByRole("button", { name: /运行时上下文/ }));

  const panel = screen.getByLabelText("运行时上下文详情");
  expect(within(panel).getByText("0 篇 · 未锁定 · 已导入 0/0")).toBeInTheDocument();
  expect(within(panel).getByText("未选择")).toBeInTheDocument();
  expect(within(panel).getByText("需锁定")).toBeInTheDocument();
  expect(within(panel).getByText("工作区未知")).toBeInTheDocument();
  expect(within(panel).getByText("未知工作区")).toBeInTheDocument();
  expect(within(panel).getByText("未连接")).toBeInTheDocument();
  expect(within(panel).getByText("已应用学术档案")).toBeInTheDocument();
});
