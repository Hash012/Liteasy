import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";
import { dockItemMimeType } from "../app/features/dock/DockRegion";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function openSettingsPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "设置" }));
  return screen.getByLabelText("左边栏设置");
}

async function openOrganizationPanel(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByLabelText("左边栏组织")) {
    return screen.getByLabelText("左边栏组织");
  }
  await user.click(within(screen.getByLabelText("左边栏导航")).getByRole("button", { name: "组织" }));
  return screen.getByLabelText("左边栏组织");
}

async function openLibraryPanel(user: ReturnType<typeof userEvent.setup>) {
  const existingLibrary = screen.queryByLabelText("我的文献库投放区");
  if (existingLibrary && !existingLibrary.closest("[hidden]")) {
    return existingLibrary;
  }
  await user.click(screen.getByRole("button", { name: "文献库" }));
  return screen.getByLabelText("我的文献库投放区");
}

async function openProfilePanel(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByLabelText("左边栏个人中心")) {
    return screen.getByLabelText("左边栏个人中心");
  }
  await user.click(screen.getByRole("button", { name: "个人中心" }));
  return screen.getByLabelText("左边栏个人中心");
}

async function openLoginDialogFromPersonalCenter(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("dialog", { name: "轻量登录面板" })) {
    return screen.getByRole("dialog", { name: "轻量登录面板" });
  }

  await user.click(screen.getByRole("button", { name: "个人中心" }));
  const profileGate = screen.getByLabelText("左边栏个人能力说明");
  await user.click(within(profileGate).getByRole("button", { name: "登录后查看个人能力" }));
  return screen.getByRole("dialog", { name: "轻量登录面板" });
}

function getStoredAccountSession() {
  const rawSession = window.localStorage.getItem("liteasy.account.session.v1");
  return rawSession ? (JSON.parse(rawSession) as { name: string; sessionId: string }) : null;
}

async function expectStoredAccountSession(sessionId = "demo-session-1") {
  await waitFor(() => {
    expect(getStoredAccountSession()?.sessionId).toBe(sessionId);
  });
  expect(screen.queryByRole("button", { name: "已登录" })).not.toBeInTheDocument();
}

async function loginThroughDialog(user: ReturnType<typeof userEvent.setup>) {
  await openLoginDialogFromPersonalCenter(user);

  await user.click(screen.getByRole("button", { name: "一键 Demo 登录" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  });

  await expectStoredAccountSession();
}


function expectOrganizationActionFeedback(message: string) {
  const organizationPanel = screen.getByLabelText("左边栏组织");
  expect(within(organizationPanel).getByRole("status", { name: "组织操作反馈" })).toHaveTextContent(message);
  expect(screen.getAllByText(message).length).toBeGreaterThanOrEqual(1);
}

async function selectInitialAssistantMode(user: ReturnType<typeof userEvent.setup>, mode: "名词解释" | "命令" | "问答") {
  const launcher = screen.queryByLabelText("AI助手初始模式入口");
  if (launcher) {
    await user.click(within(launcher).getByRole("button", { name: `${mode}模式` }));
    return;
  }

  await user.click(screen.getByRole("button", { name: mode }));
}

test("grounds qa answers in the currently selected imported paper set", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("PDF 已就绪")).toBeInTheDocument();
  }, { timeout: 2500 });

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("总结这篇论文的核心方法")).toBeInTheDocument();
  expect(screen.getAllByText(/demo-2 · 第/).length).toBeGreaterThan(0);
}, 10000);

test("shows the unified lightweight login dialog on logged-out startup and respects suppress reminder", async () => {
  const user = userEvent.setup();

  const { rerender } = render(<AppShell />);

  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "登录云账号" })).not.toBeInTheDocument();

  await openLoginDialogFromPersonalCenter(user);
  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "不再提醒" }));
  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();

  rerender(<AppShell />);

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  });
});

test("opens the unified lightweight login dialog from the organization capability guide while logged out", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await openOrganizationPanel(user);

  expect(screen.getByRole("button", { name: "登录后查看组织能力" })).toHaveAttribute(
    "title",
    "当前已退化为本地阅读器，组织空间不可用。登录后可加入组织、创建组织、查看共享文献库和组织通知。"
  );

  await user.click(screen.getByRole("button", { name: "登录后查看组织能力" }));

  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();
});

test("applies a semantic command theme action to the workbench", async () => {
  const user = userEvent.setup();
  const { container } = render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "让 UI 变成卡通风格");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(container.querySelector(".app-frame")).toHaveClass("theme-playful");
  expect(screen.getAllByText("已应用卡通风格。").length).toBeGreaterThanOrEqual(1);
  const overlay = screen.getByLabelText("工作台状态投影");
  expect(within(overlay).getByText("已应用卡通风格。")).toBeInTheDocument();
  await user.click(within(overlay).getByRole("button", { name: "恢复默认" }));

  await waitFor(() => {
    expect(container.querySelector(".app-frame")).not.toHaveClass("theme-playful");
  });
});

test("applies a model-generated freeform theme to the workbench", async () => {
  const user = userEvent.setup();
  const modelTransport = vi.fn(async (request) => {
    const requestBody = JSON.parse(request.body) as { prompt?: string };
    const isPlannerRequest = requestBody.prompt?.includes("语义动作规划器");
    return {
      json: async () => ({
        answer: isPlannerRequest
          ? JSON.stringify({
              actions: [
                {
                  actionId: "theme.apply_generated",
                  input: {
                    buttons: {
                      borderWidth: 1,
                      fill: "solid",
                      hoverLift: 2,
                      radius: 4,
                      shadow: "crisp",
                      weight: "strong"
                    },
                    intent: "冷静的赛博实验室，按钮锐利一点",
                    name: "冷静赛博实验室",
                    palette: {
                      accent1: "#1B66B3",
                      accent2: "#2F8F61",
                      accent3: "#B06B19",
                      ink1: "#101820",
                      ink2: "#526071",
                      line1: "#C7D3DF",
                      line2: "#AEBCCD",
                      paper0: "#F8FBFC",
                      paper1: "#EEF5F8",
                      paper2: "#E2EDF3"
                    },
                    rationale: "冷色背景和硬朗按钮表达精密实验感。",
                    scope: ["global", "buttons"]
                  }
                }
              ],
              confidence: "high",
              intentId: "theme.apply",
              planId: "model-plan-generated-theme",
              requiredContext: [],
              requiresConfirmation: false,
              riskLevel: "low",
              summary: "生成冷静赛博实验室主题"
            })
          : JSON.stringify({
              summary: "生成主题 UI 已准备。",
              verdict: "pass"
            }),
        execution: {
          backend: "dev_cloud",
          mode: "live",
          provider: "openai"
        }
      }),
      ok: true,
      status: 200
    };
  });

  const { container } = render(
    <AppShell
      controlPlaneTransport={async () => ({
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      modelTransport={modelTransport}
    />
  );

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  });
  await selectInitialAssistantMode(user, "命令");
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), {
    target: {
      value: "把界面调成冷静的赛博实验室，按钮锐利一点"
    }
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(modelTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://liteasy.example.com/model-proxy/v1/model/generate"
      })
    );
  });
  await waitFor(() => {
    expect(container.querySelector(".app-frame")).toHaveStyle({
      "--button-background": "#1B66B3",
      "--button-font-weight": "850",
      "--generated-accent-1": "#1B66B3",
      "--button-radius": "4px"
    });
  });
  expect(container.querySelector(".app-frame")).toHaveAttribute("data-theme-scope", "global buttons");
  expect(screen.getAllByText("已根据命令生成冷静赛博实验室主题。").length).toBeGreaterThanOrEqual(1);
});

test("does not synthesize common generated themes when the model planner is unavailable", async () => {
  const user = userEvent.setup();
  const modelTransport = vi.fn(async () => {
    throw new Error("model offline");
  });

  const { container } = render(
    <AppShell
      initialSettings={{
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      modelTransport={modelTransport}
    />
  );

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "轻量登录面板" })).not.toBeInTheDocument();
  });
  await selectInitialAssistantMode(user, "命令");
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), {
    target: {
      value: "打开暗夜模式"
    }
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(modelTransport.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  expect(container.querySelector(".app-frame")).not.toHaveAttribute("data-theme-scope");
  expect(screen.getAllByText(/还没有对应到可执行对象或动作/).length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText("已根据命令生成暗夜研究模式主题。")).not.toBeInTheDocument();
});

test("executes a semantic command layout action against pane state", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  expect(screen.getByLabelText("我的文献库投放区")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把窗口切分成两个");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.queryByLabelText("我的文献库投放区")).not.toBeInTheDocument();
  expect(screen.getByLabelText("右栏AI助手")).toBeInTheDocument();
  expect(screen.getAllByText("已切换为双栏布局。").length).toBeGreaterThanOrEqual(1);
  const overlay = screen.getByLabelText("工作台状态投影");
  expect(within(overlay).getByText("已切换为双栏布局。")).toBeInTheDocument();
  await user.click(within(overlay).getByRole("button", { name: "恢复默认布局" }));

  await waitFor(() => {
    expect(screen.getByLabelText("我的文献库投放区")).toBeInTheDocument();
  });
});

test("executes a semantic command panel navigation action", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  expect(screen.getByLabelText("我的文献库投放区")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开设置面板");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByLabelText("左边栏设置")).toBeInTheDocument();
  expect(screen.getAllByText("已打开设置面板。").length).toBeGreaterThanOrEqual(1);
});

test("moves an explicit dock tab to the bottom from command mode", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  expect(screen.queryByLabelText("下栏 Dock 区域")).not.toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把 AI 助手放到下栏");
  await user.click(screen.getByRole("button", { name: "发送" }));

  const bottomRegion = await screen.findByLabelText("下栏 Dock 区域");
  expect(within(bottomRegion).getByRole("tab", { name: "Liteasy Chat" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.queryByLabelText("右栏AI助手")).not.toBeInTheDocument();
  expect(screen.getAllByText("已将 Liteasy Chat 移到下栏。").length).toBeGreaterThanOrEqual(1);
});

test("asks which tab should move when the command only opens the bottom region", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开下栏");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("要把哪个标签页放到下栏？例如：把 AI 助手放到下栏。")).toBeInTheDocument();
  expect(screen.queryByLabelText("下栏 Dock 区域")).not.toBeInTheDocument();
});

test("executes compound model-planned commands as ordered actions", async () => {
  const user = userEvent.setup();
  const modelFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/v1/model/generate")) {
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as { prompt?: string };
      const isPlannerRequest = requestBody.prompt?.includes("语义动作规划器");
      return {
        json: async () => ({
          answer: isPlannerRequest
            ? JSON.stringify({
                actions: [
                  {
                    actionId: "dock.move_item",
                    input: {
                      itemId: "organization",
                      targetRegion: "bottom"
                    }
                  },
                  {
                    actionId: "organization.open_shared_library",
                    input: {
                      source: "organization_space"
                    }
                  }
                ],
                confidence: "high",
                intentId: "dock.move_item",
                planId: "model-plan-compound-organization",
                requiredContext: [],
                requiresConfirmation: false,
                riskLevel: "low",
                summary: "将组织面板放到下栏后打开组织共享文献库"
              })
            : JSON.stringify({
                summary: "复合命令按顺序执行。",
                verdict: "pass"
              }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      } as Response;
    }

    return {
      json: async () => ({
        cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
        defaultProvider: "openai",
        localDirectEnabled: false,
        localDirectEndpoint: "mock://local-direct",
        modelAccessMode: "cloud_proxy",
        policyVersion: "policy-dev-cloud-live",
        syncedAt: "2026-05-14T09:30:00Z"
      }),
      ok: true,
      status: 200
    } as Response;
  });
  vi.stubGlobal("fetch", modelFetch);

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 1,
              documents: [
                {
                  id: "org-doc-seq-1",
                  sourcePath: "org://org-demo-1/shared-library/org-doc-seq-1.pdf",
                  title: "Sequential Organization Command Planning"
                }
              ],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 0,
              running: 0
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把组织面板打开到下栏后打开组织文库");
  await user.click(screen.getByRole("button", { name: "发送" }));

  const bottomRegion = await screen.findByLabelText("下栏 Dock 区域");
  expect(within(bottomRegion).getByRole("tab", { name: "组织" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await waitFor(() => {
    expect(screen.getAllByText("已打开组织共享文献库：组织共享文献库。").length).toBeGreaterThanOrEqual(1);
  });
  expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  expect(screen.getByText("Sequential Organization Command Planning")).toBeInTheDocument();
  const plannerCall = modelFetch.mock.calls.find(([input]) =>
    String(input).includes("/v1/model/generate")
  );
  expect(
    JSON.parse(String(plannerCall?.[1]?.body ?? "{}")).prompt
  ).toContain("复合命令必须拆成多个有序 actions[]");
}, 10000);

test("executes a semantic selected-set import action through the workspace handler", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "导入当前选中文献集");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("计划：导入当前选中文献集")).toBeInTheDocument();
  expect(screen.getAllByText("请先在工作区勾选文件，形成选中文献集。").length).toBeGreaterThanOrEqual(1);
});

test("registered personal accounts unlock organization creation", async () => {
  const user = userEvent.setup();
  const requestedUrls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      requestedUrls.push(String(input));

      if (String(input).includes("/v1/account/register")) {
        return {
          json: async () => ({
            session: {
              email: "tian@example.com",
              expiresAt: "2026-12-31T23:59:59.000Z",
              membershipTier: "pro",
              name: "Tian",
              sessionId: "account-session-tian-example-com"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 1,
              members: [{ id: "member-1", name: "Tian", role: "owner" }],
              myRole: "owner",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00.000Z",
                storageLimitGb: 100,
                storageUsedGb: 12
              },
              sharedLibrary: {
                documentCount: 1,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: { failed: 0, running: 0 }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          list: {
            activeOrganizationId: "org-demo-1",
            organizations: []
          }
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  const dialog = screen.getByRole("dialog", { name: "轻量登录面板" });
  await user.click(within(dialog).getByRole("button", { name: "创建账号" }));
  await user.type(within(dialog).getByLabelText("昵称"), "Tian");
  await user.type(within(dialog).getByLabelText("邮箱"), "tian@example.com");
  await user.type(
    within(dialog).getByLabelText("密码或密码短语（至少 12 位）"),
    "private-password-1"
  );
  await user.click(within(dialog).getByRole("button", { name: "注册并登录" }));

  await expectStoredAccountSession("account-session-tian-example-com");

  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "创建组织" })).toBeEnabled();
  });
  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/account/register");
});

test("does not expose the editable personal center while logged out", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await user.click(screen.getByRole("button", { name: "个人中心" }));

  expect(screen.queryByLabelText("左边栏个人中心")).not.toBeInTheDocument();
  const profileGate = screen.getByLabelText("左边栏个人能力说明");
  expect(within(profileGate).getByText("未登录")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登录后查看个人能力" })).toBeInTheDocument();
});

test("opens the unified lightweight login dialog from locked cloud sections in the library while logged out", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));
  await openLibraryPanel(user);

  await user.click(screen.getAllByRole("button", { name: "登录后可用" })[0]);

  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();
});

test("supports the confirmed workbench pane layout", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  const workbench = screen.getByTestId("workbench-layout");
  expect(workbench).toHaveStyle({
    "--left-pane-size": "minmax(220px, 24fr)",
    "--reader-artifact-row-size": "0px",
    "--right-pane-size": "minmax(220px, 24fr)"
  });

  const readerHeader = screen.getByLabelText("Reader 标题栏");
  const layoutControls = within(readerHeader).getByRole("toolbar", { name: "阅读区布局控制" });
  expect(within(layoutControls).getByRole("button", { name: "折叠左侧栏" })).toBeInTheDocument();
  expect(within(layoutControls).getByRole("button", { name: "展开下栏" })).toBeInTheDocument();
  expect(within(layoutControls).getByRole("button", { name: "折叠右侧栏" })).toBeInTheDocument();

  await user.click(within(layoutControls).getByRole("button", { name: "折叠左侧栏" }));

  expect(workbench).toHaveStyle({
    "--left-pane-size": "0px"
  });
  expect(within(screen.getByLabelText("Reader 标题栏")).getByRole("button", { name: "展开左侧栏" })).toBeInTheDocument();
  expect(screen.getByText("AI 对话", { selector: ".pane-header" })).toBeInTheDocument();

  await user.click(within(screen.getByLabelText("Reader 标题栏")).getByRole("button", { name: "展开左侧栏" }));

  expect(workbench).toHaveStyle({
    "--left-pane-size": "minmax(220px, 24fr)"
  });

  expect(screen.queryByLabelText("多模态产物区域")).not.toBeInTheDocument();
  expect(workbench).toHaveStyle({
    "--reader-artifact-row-size": "0px"
  });

  await user.click(within(screen.getByLabelText("Reader 标题栏")).getByRole("button", { name: "折叠右侧栏" }));

  expect(within(screen.getByLabelText("Reader 标题栏")).getByRole("button", { name: "展开右侧栏" })).toBeInTheDocument();
  expect(workbench).toHaveStyle({
    "--right-pane-size": "0px"
  });

  fireEvent.pointerDown(screen.getByLabelText("调整左栏宽度"), {
    clientX: 300
  });
  fireEvent.pointerMove(window, {
    clientX: 360
  });
  fireEvent.pointerUp(window);

  expect(workbench.style.getPropertyValue("--left-pane-size")).not.toBe("minmax(220px, 24fr)");
});

test("renders artifact content from imported selected-document chunks", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.hover(screen.getByRole("button", { name: "模态选择" }));
  await user.click(screen.getByRole("button", { name: "思维导图" }));

  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "Literature Mind Map" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  }, { timeout: 3000 });

  expect(
    screen.getAllByText("Survey of Vector Database Management Systems").length
  ).toBeGreaterThan(1);
  expect(screen.getByText("向量数据库管理系统")).toBeInTheDocument();
  expect(screen.getByText("向量索引")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "打开产物" }));

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "对比表" })).toHaveAttribute(
      "title",
      "已定位到中心产物：mindmap。"
    );
  });

  await user.click(screen.getByRole("button", { name: "关闭 Literature Mind Map" }));

  expect(screen.queryByRole("tab", { name: "Literature Mind Map" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Reader" })).toHaveAttribute("aria-selected", "true");
}, 10000);

test("collapses the left pane when clicking the active activity-bar item", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  const workbench = screen.getByTestId("workbench-layout");
  expect(workbench.style.getPropertyValue("--left-pane-size")).toBe("minmax(220px, 24fr)");

  await user.click(screen.getByRole("button", { name: "文献库" }));
  expect(workbench.style.getPropertyValue("--left-pane-size")).toBe("0px");
  expect(workbench.style.getPropertyValue("--left-pane-utility-size")).toBe("0px");
  expect(screen.queryByLabelText("展开左栏")).not.toBeInTheDocument();
  expect(within(screen.getByLabelText("Reader 标题栏")).getByText("Reader", { selector: ".reader-pane-title" })).toBeInTheDocument();
  expect(screen.getByText("AI 对话", { selector: ".pane-header" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "组织" }));
  expect(screen.getByLabelText("左边栏组织")).toBeInTheDocument();
  expect(workbench.style.getPropertyValue("--left-pane-size")).toBe("minmax(220px, 24fr)");
});

test("composes the primary workbench areas through Dock regions", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  const workbench = screen.getByTestId("workbench-layout");
  expect(within(workbench).getByLabelText("左栏 Dock 区域")).toBeInTheDocument();
  expect(within(workbench).getByLabelText("主内容区 Dock 区域")).toBeInTheDocument();
  expect(within(workbench).getByLabelText("右栏 Dock 区域")).toBeInTheDocument();
  expect(within(workbench).queryByLabelText("下栏 Dock 区域")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Reader" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.queryByRole("tab", { name: "多模态产物" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "模态选择" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "文献库" }));

  expect(workbench.querySelector(":scope > aside.pane-rail.left")).toBeNull();
  expect(screen.queryByLabelText("左栏 Dock 区域")).not.toBeInTheDocument();
  expect(screen.getByLabelText("主内容区 Dock 区域")).toBeInTheDocument();
  expect(screen.getByLabelText("右栏 Dock 区域")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "组织" }));

  const leftRegion = screen.getByLabelText("左栏 Dock 区域");
  expect(within(leftRegion).getByRole("tab", { name: "组织" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(within(leftRegion).queryByRole("tab", { name: "文献库" })).not.toBeInTheDocument();
});

test("drags a tool tab across Dock regions and leaves the source with the Logo empty state", () => {
  render(<AppShell />);

  const rightRegion = screen.getByLabelText("右栏 Dock 区域");
  const leftRegion = screen.getByLabelText("左栏 Dock 区域");
  const values = new Map<string, string>();
  const dataTransfer = {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData(type: string, value: string) {
      values.set(type, value);
      this.types = [...values.keys()];
    },
    types: [] as string[]
  };

  fireEvent.dragStart(within(rightRegion).getByRole("tab", { name: "Liteasy Chat" }), {
    dataTransfer
  });
  expect(dataTransfer.getData(dockItemMimeType)).toBe("assistant");
  fireEvent.dragOver(leftRegion, { dataTransfer });
  fireEvent.drop(leftRegion, { dataTransfer });

  expect(within(leftRegion).getByRole("tab", { name: "Liteasy Chat" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(within(rightRegion).getByRole("img", { name: "LiteasyClaw" })).toBeInTheDocument();
  expect(within(rightRegion).queryByText(/暂无|请选择/)).not.toBeInTheDocument();
  expect(window.localStorage.getItem("liteasy.ui.dock-layout.v1")).toContain("assistant");

  expect(screen.queryByLabelText("下栏 Dock 区域")).not.toBeInTheDocument();
  expect(screen.getByLabelText("主内容区 Dock 区域")).toBeInTheDocument();
});

test("does not restore legacy bottom artifact pane before any artifact is generated", () => {
  window.localStorage.setItem(
    "liteasy.ui.dock-layout.v1",
    JSON.stringify({
      regions: {
        bottom: {
          activeItemId: "artifacts",
          itemIds: ["artifacts"]
        },
        left: {
          activeItemId: "library",
          itemIds: ["library"]
        },
        main: {
          activeItemId: "reader",
          itemIds: ["reader"]
        },
        right: {
          activeItemId: "assistant",
          itemIds: ["assistant"]
        }
      },
      version: 1
    })
  );
  window.localStorage.setItem(
    "liteasy.ui.pane-layout.v1",
    JSON.stringify({
      collapsed: {
        bottom: false,
        left: false,
        right: false
      },
      layout: {
        bottom: 32,
        center: 52,
        left: 24,
        right: 24
      }
    })
  );

  render(<AppShell />);

  expect(screen.queryByLabelText("下栏 Dock 区域")).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "多模态产物" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Reader" })).toHaveAttribute("aria-selected", "true");
});

test("shows the unified cloud model capability in settings", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  const settingsPane = await openSettingsPanel(user);

  expect(within(settingsPane).getByText("云端模型能力")).toBeInTheDocument();
  expect(
    within(settingsPane).getByText("Liteasy 面向普通用户统一通过云端模型能力提供问答、解释和产物生成服务。")
  ).toBeInTheDocument();
  expect(within(settingsPane).queryByText(/本地直连/)).not.toBeInTheDocument();
});

test("shows the latest cloud model execution chain in the assistant message", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/model/generate")) {
        return {
          json: async () => ({
            answer: "真实服务回答",
            execution: {
              backend: "dev_cloud",
              mode: "live",
              provider: "openai"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("PDF 已就绪")).toBeInTheDocument();
  }, { timeout: 2500 });

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇综述如何定义向量数据库系统？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText("模型链路：云端模型能力 -> 云端服务 -> OpenAI")).toBeInTheDocument();
  });
}, 10000);

test("logs into the dev cloud account and restores the session on next render", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  const { unmount } = render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);
  expect(screen.queryByRole("button", { name: "登录云账号" })).not.toBeInTheDocument();

  const profilePanel = await openProfilePanel(user);
  expect(within(profilePanel).getByText("昵称：Liteasy Researcher")).toBeInTheDocument();
  unmount();

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await expectStoredAccountSession();
  const restoredProfilePanel = await openProfilePanel(user);
  expect(within(restoredProfilePanel).getByText("昵称：Liteasy Researcher")).toBeInTheDocument();
  await openSettingsPanel(user);
}, 10000);

test("shows cloud recommendations for the current selected document set after account login", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              },
              {
                discoveredAt: "2026-05-14T09:10:00Z",
                id: "rec-vdbms-2",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "medium",
                relevanceScore: 0.78,
                reason: "补充开源向量数据库系统实现，便于和综述框架对照。",
                source: "arXiv Watch",
                title: "Milvus: A Purpose-Built Vector Data Management System"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/get")) {
        return {
          json: async () => ({
            cacheHit: recommendationRequestCount > 0,
            recommendations:
              recommendationRequestCount > 0
                ? [
                    {
                      discoveredAt: "2026-05-14T08:15:00Z",
                      id: "rec-bert-1",
                      relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                      relevanceBand: "high",
                      relevanceScore: 0.92,
                      reason: "同样关注大规模预训练语言模型的迁移能力。",
                      source: "Semantic Scholar",
                      title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
                    }
                  ]
                : []
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/put")) {
        return {
          json: async () => ({
            cachedAt: "2026-05-14T08:15:00Z",
            ok: true
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/clear")) {
        return {
          json: async () => ({
            cleared: true
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);

  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));

  await waitFor(() => {
    expect(
      within(screen.getByLabelText("关联推荐列表")).getByText(
        "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      )
    ).toBeInTheDocument();
  });

  expect(within(screen.getByLabelText("关联推荐列表")).getByText("Semantic Scholar")).toBeInTheDocument();
  expect(
    within(screen.getByLabelText("关联推荐列表")).getByText("同样关注向量数据库系统架构与相似度检索能力。")
  ).toBeInTheDocument();
  expect(
    screen.getAllByText("关联：Survey of Vector Database Management Systems").length
  ).toBeGreaterThan(0);
  expect(screen.getByText("高关联")).toBeInTheDocument();
}, 10000);

test("reorders recommendations after assistant command switches to retrieval-time sort", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              },
              {
                discoveredAt: "2026-05-14T09:10:00Z",
                id: "rec-vdbms-2",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "medium",
                relevanceScore: 0.78,
                reason: "补充开源向量数据库系统实现，便于和综述框架对照。",
                source: "arXiv Watch",
                title: "Milvus: A Purpose-Built Vector Data Management System"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: []
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: []
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: []
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);
  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(screen.getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")).toBeInTheDocument();
  });

  const recommendationList = screen.getByLabelText("关联推荐列表");
  expect(within(recommendationList).getAllByRole("listitem")[0]).toHaveTextContent(
    "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "按检索时间排序推荐");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/已更新 推荐排序：按检索时间/)).toBeInTheDocument();
  });

  expect(within(recommendationList).getAllByRole("listitem")[0]).toHaveTextContent(
    "Milvus: A Purpose-Built Vector Data Management System"
  );
}, 10000);

test("drags a recommendation into local collection and restores it on next render", async () => {
  const user = userEvent.setup();
  let collectionItems: Array<{
    id: string;
    reason: string;
    savedAt: string;
    source: string;
    title: string;
  }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        const payload =
          typeof init?.body === "string" ? JSON.parse(init.body) : { item: null };
        if (payload.item) {
          collectionItems = [
            payload.item,
            ...collectionItems.filter((item) => item.id !== payload.item.id)
          ];
        }

        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  const { unmount } = render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);

  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));

  await waitFor(() => {
    expect(
      screen.getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });

  const dragPayload = new Map<string, string>();
  const dataTransfer = {
    getData(type: string) {
      return dragPayload.get(type) ?? "";
    },
    setData(type: string, value: string) {
      dragPayload.set(type, value);
    }
  };

  const recommendationCard = screen
    .getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    .closest("li");
  expect(recommendationCard).not.toBeNull();
  fireEvent.dragStart(recommendationCard!, { dataTransfer });

  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });

  await waitFor(() => {
    expect(
      within(collectionZone).getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });

  expect(within(collectionZone).getByText("来源：Semantic Scholar")).toBeInTheDocument();
  unmount();

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  const restoredCollectionZone = screen.getByLabelText("收藏投放区");
  await waitFor(() => {
    expect(
      within(restoredCollectionZone).getByText(
        "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      )
    ).toBeInTheDocument();
  });
}, 10000);

test("drags collected and recommended papers into the local library without duplicates", async () => {
  const user = userEvent.setup();
  let collectionItems: Array<{
    id: string;
    reason: string;
    savedAt: string;
    source: string;
    title: string;
  }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        const payload =
          typeof init?.body === "string" ? JSON.parse(init.body) : { item: null };
        if (payload.item) {
          collectionItems = [
            payload.item,
            ...collectionItems.filter((item) => item.id !== payload.item.id)
          ];
        }

        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);
  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(
      screen.getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });

  const dragPayload = new Map<string, string>();
  const dataTransfer = {
    getData(type: string) {
      return dragPayload.get(type) ?? "";
    },
    setData(type: string, value: string) {
      dragPayload.set(type, value);
    }
  };

  const recommendationCard = screen
    .getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    .closest("li");
  expect(recommendationCard).not.toBeNull();

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  fireEvent.dragStart(recommendationCard!, { dataTransfer });
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });

  await waitFor(() => {
    expect(
      within(libraryZone).getByLabelText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });

  expect(
    within(libraryZone).getAllByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
  ).toHaveLength(1);

  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });
  await waitFor(() => {
    expect(
      within(collectionZone).getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });
  const collectedCard = within(collectionZone)
    .getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    .closest("li");
  expect(collectedCard).not.toBeNull();

  fireEvent.dragStart(collectedCard!, { dataTransfer });
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });

  expect(
    within(libraryZone).getAllByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
  ).toHaveLength(1);
}, 10000);


test("clears visible recommendation cache on user request", async () => {
  const user = userEvent.setup();
  let recommendationRequestCount = 0;
  let recommendationCacheGetCount = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        recommendationRequestCount += 1;
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        return {
          json: async () => ({
            items: [
              {
                id: "rec-vdbms-1",
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                savedAt: "2026-05-14T10:30:00.000Z",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/get")) {
        recommendationCacheGetCount += 1;
        return {
          json: async () => ({
            cacheHit: recommendationRequestCount > 0,
            recommendations:
              recommendationRequestCount > 0
                ? [
                    {
                      discoveredAt: "2026-05-14T08:15:00Z",
                      id: "rec-bert-1",
                      relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                      relevanceBand: "high",
                      relevanceScore: 0.92,
                      reason: "同样关注大规模预训练语言模型的迁移能力。",
                      source: "Semantic Scholar",
                      title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
                    }
                  ]
                : []
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/put")) {
        return {
          json: async () => ({
            cachedAt: "2026-05-14T08:15:00Z",
            ok: true
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/clear")) {
        return {
          json: async () => ({
            cleared: true
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(screen.getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(1);

  await user.click(screen.getByRole("button", { name: "清理关联推荐" }));

  expect(screen.queryByLabelText("关联推荐列表")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "清理关联推荐" })).toHaveAttribute(
    "title",
    "已清理当前工作区的关联推荐缓存。"
  );
  expect(recommendationRequestCount).toBe(1);
  expect(recommendationCacheGetCount).toBeGreaterThanOrEqual(1);
});

test("reuses cached recommendations until a collected paper is added to the library", async () => {
  const user = userEvent.setup();
  let recommendationRequestCount = 0;
  let recommendationCacheGetCount = 0;
  let recommendationCachePutCount = 0;
  let recommendationCacheClearCount = 0;
  let collectionItems: Array<{
    id: string;
    reason: string;
    savedAt: string;
    source: string;
    title: string;
  }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendations")) {
        recommendationRequestCount += 1;
        return {
          json: async () => ({
            recommendations: [
              {
                discoveredAt: "2026-05-14T08:15:00Z",
                id: "rec-vdbms-1",
                relatedDocumentTitle: "Survey of Vector Database Management Systems",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注向量数据库系统架构与相似度检索能力。",
                source: "Semantic Scholar",
                title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/items")) {
        const payload =
          typeof init?.body === "string" ? JSON.parse(init.body) : { item: null };
        if (payload.item) {
          collectionItems = [
            payload.item,
            ...collectionItems.filter((item) => item.id !== payload.item.id)
          ];
        }

        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/collection/list")) {
        return {
          json: async () => ({
            items: collectionItems
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/get")) {
        recommendationCacheGetCount += 1;
        return {
          json: async () => ({
            cacheHit: recommendationRequestCount > 0,
            recommendations:
              recommendationRequestCount > 0
                ? [
                    {
                      discoveredAt: "2026-05-14T08:15:00Z",
                      id: "rec-bert-1",
                      relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                      relevanceBand: "high",
                      relevanceScore: 0.92,
                      reason: "同样关注大规模预训练语言模型的迁移能力。",
                      source: "Semantic Scholar",
                      title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
                    }
                  ]
                : []
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/put")) {
        recommendationCachePutCount += 1;
        return {
          json: async () => ({
            cachedAt: "2026-05-14T08:15:00Z",
            ok: true
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/recommendation-cache/clear")) {
        recommendationCacheClearCount += 1;
        return {
          json: async () => ({
            cleared: true
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);
  await openLibraryPanel(user);

  await loginThroughDialog(user);
  await expectStoredAccountSession();

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(
      within(screen.getByLabelText("关联推荐列表")).getByText(
        "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      )
    ).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(1);

  const dragPayload = new Map<string, string>();
  const dataTransfer = {
    getData(type: string) {
      return dragPayload.get(type) ?? "";
    },
    setData(type: string, value: string) {
      dragPayload.set(type, value);
    }
  };

  const recommendationCard = screen
    .getByLabelText("关联推荐列表")
    .querySelector("li");
  expect(recommendationCard).not.toBeNull();
  expect(within(recommendationCard!).getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")).toBeInTheDocument();
  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragStart(recommendationCard!, { dataTransfer });
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });

  await waitFor(() => {
    expect(
      within(collectionZone).getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
    ).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(screen.queryByLabelText("关联推荐列表")).not.toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("Survey of Vector Database Management Systems"));
  await waitFor(() => {
    expect(screen.getByText("已显示当前选中文献集的缓存推荐。")).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(1);
  expect(recommendationCacheGetCount).toBeGreaterThanOrEqual(2);
  expect(recommendationCachePutCount).toBe(1);


  const restoredCollectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragStart(
    within(restoredCollectionZone)
      .getByText("VBASE: Unifying Online Vector Similarity Search and Relational Queries")
      .closest("li")!,
    { dataTransfer }
  );
  const libraryZone = screen.getByLabelText("我的文献库投放区");
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });

  await user.click(screen.getByLabelText("VBASE: Unifying Online Vector Similarity Search and Relational Queries"));
  await waitFor(() => {
    expect(screen.getByText("已显示当前选中文献集的缓存推荐。")).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(1);
  expect(recommendationCacheGetCount).toBeGreaterThanOrEqual(3);
  expect(recommendationCacheClearCount).toBe(0);
}, 10000);


test("restored cloud account session uses local dev-cloud defaults for metadata sync", async () => {
  const user = userEvent.setup();
  const requestedUrls: string[] = [];

  window.localStorage.setItem(
    "liteasy.account.session.v1",
    JSON.stringify({
      email: "researcher@liteasy.dev",
      expiresAt: "2026-05-15T09:30:00Z",
      name: "Liteasy Researcher",
      sessionId: "demo-session-1"
    })
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      requestedUrls.push(String(input));

      if (String(input).includes("/v1/documents/metadata-sync")) {
        return {
          json: async () => ({
            result: {
              acceptedCount: 3,
              rejectedCount: 0,
              syncId: "metadata-restored-session",
              syncedAt: "2026-05-14T10:20:00Z"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "http://127.0.0.1:8787",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "dev-policy-v1",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  const settingsPane = await openSettingsPanel(user);

  await waitFor(() => {
    expect(within(settingsPane).getByText("文献同步：已同步 3 篇")).toBeInTheDocument();
  });

  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/documents/metadata-sync");
  expect(requestedUrls.some((url) => url.startsWith("mock://"))).toBe(false);
});

test("retries document metadata sync from settings after a failed attempt", async () => {
  const user = userEvent.setup();
  let metadataAttempts = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/documents/metadata-sync")) {
        metadataAttempts += 1;

        if (metadataAttempts === 1) {
          throw new TypeError("Failed to fetch");
        }

        return {
          json: async () => ({
            result: {
              acceptedCount: 3,
              rejectedCount: 0,
              syncId: "metadata-retry-success",
              syncedAt: "2026-05-14T10:25:00Z"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  const settingsPane = await openSettingsPanel(user);

  await waitFor(() => {
    expect(within(settingsPane).getByText("文献同步：失败")).toBeInTheDocument();
  });

  await user.click(within(settingsPane).getByRole("button", { name: "重新同步文献元数据" }));

  await waitFor(() => {
    expect(within(settingsPane).getByText("文献同步：已同步 3 篇")).toBeInTheDocument();
  });

  expect(within(settingsPane).getByText("同步批次：metadata-retry-success")).toBeInTheDocument();
  expect(metadataAttempts).toBe(2);
}, 10000);

test("syncs visible workspace document metadata after cloud account login", async () => {
  const user = userEvent.setup();
  const metadataRequests: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/documents/metadata-sync")) {
        metadataRequests.push(String(init?.body));

        return {
          json: async () => ({
            result: {
              acceptedCount: 3,
              rejectedCount: 0,
              syncId: "metadata-sync-1",
              syncedAt: "2026-05-14T10:20:00Z"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openSettingsPanel(user);

  expect(screen.getByText("文献同步：当前已退化为本地阅读器")).toHaveAttribute(
    "title",
    "当前已退化为本地阅读器，文献元数据同步不可用。联网并登录后，将自动恢复云端能力。"
  );

  await loginThroughDialog(user);

  await waitFor(() => {
    expect(screen.getByText("文献同步：已同步 3 篇")).toBeInTheDocument();
  });

  expect(screen.getByText("最近同步：2026-05-14T10:20:00Z")).toBeInTheDocument();
  expect(screen.getByText("同步批次：metadata-sync-1")).toBeInTheDocument();
  expect(JSON.parse(metadataRequests[0])).toEqual({
    documents: [
      {
        id: "demo-1",
        sourcePath: "/papers/colbert-late-interaction.pdf",
        title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
      },
      {
        id: "demo-2",
        sourcePath: "/papers/survey-vector-database-management-systems.pdf",
        title: "Survey of Vector Database Management Systems"
      },
      {
        id: "demo-3",
        sourcePath: "/papers/acorn-vector-search.pdf",
        title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
      }
    ],
    sessionId: "demo-session-1",
    workspaceRevision: 0
  });
}, 10000);

test("loads the Liteasy local library root on startup", async () => {
  render(
    <AppShell
      localLibraryLoader={async () => ({
        entries: [],
        rootPath: "/tmp/LiteasyLibrary"
      })}
    />
  );

  expect(await screen.findByText(/当前工作区：.*LiteasyLibrary/)).toBeInTheDocument();
}, 10000);

test("loads organization space from local dev cloud defaults after connecting", async () => {
  const user = userEvent.setup();
  const requestedUrls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      requestedUrls.push(String(input));

      if (String(input).includes("/v1/admin/model-policy")) {
        return {
          json: async () => ({
            cloudProxyEndpoint: "http://127.0.0.1:8787",
            defaultProvider: "openai",
            localDirectEnabled: false,
            localDirectEndpoint: "mock://local-direct",
            modelAccessMode: "cloud_proxy",
            policyVersion: "dev-policy-v1",
            syncedAt: "2026-05-14T09:30:00Z"
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/list")) {
        return {
          json: async () => ({
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "管理员",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: { highRisk: 1, pendingReview: 3 },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [],
              runningTasks: []
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/documents/metadata-sync")) {
        return {
          json: async () => ({
            result: {
              acceptedCount: 3,
              rejectedCount: 0,
              syncId: "metadata-sync-1",
              syncedAt: "2026-05-14T10:20:00Z"
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({}),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/account/demo-login");
  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/org/summary");
  expect(requestedUrls.some((url) => url.startsWith("mock://"))).toBe(false);
}, 10000);

test("aligns model endpoints to the injected dev cloud port before policy sync", async () => {
  const requestedUrls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      requestedUrls.push(String(input));

      if (String(input).includes("/v1/admin/model-policy")) {
        return {
          json: async () => ({
            cloudProxyEndpoint: "http://127.0.0.1:8790",
            defaultProvider: "deepseek",
            localDirectEnabled: false,
            localDirectEndpoint: "mock://local-direct",
            modelAccessMode: "cloud_proxy",
            policyVersion: "dev-policy-v1",
            syncedAt: "2026-05-14T09:30:00Z"
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({}),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.cloud_proxy_endpoint": "http://127.0.0.1:8787",
        "models.control_plane_endpoint": "http://127.0.0.1:8787",
        "models.default_provider": "openai"
      }}
      localDevCloudEnv={{
        VITE_LITEASY_DEV_CLOUD_PORT: "8790"
      }}
    />
  );

  await waitFor(() => {
    expect(requestedUrls).toContain("http://127.0.0.1:8790/v1/admin/model-policy");
  });

  expect(requestedUrls).not.toContain("http://127.0.0.1:8787/v1/admin/model-policy");
}, 10000);

test("shows organization space summary after cloud account login", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [
                {
                  actor: "Admin",
                  description: "更新共享文献库上传权限",
                  id: "audit-1",
                  occurredAt: "2026-05-14T10:30:00Z"
                }
              ],
              memberCount: 12,
              members: [
                {
                  id: "member-1",
                  name: "Liteasy Researcher",
                  role: "研究员"
                },
                {
                  id: "member-2",
                  name: "Admin",
                  role: "管理员"
                }
              ],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [
                {
                  id: "notice-1",
                  message: "管理员发布了本周阅读主题。",
                  type: "announcement"
                },
                {
                  id: "notice-2",
                  message: "成员上传了 Graph Neural Networks 综述。",
                  type: "document_upload"
                },
                {
                  id: "notice-3",
                  message: "共享文献库结构新增 RAG 目录。",
                  type: "library_change"
                }
              ],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  },
                  {
                    id: "org-doc-2",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
                    title: "Team Notes on Long-Context Evaluation"
                  }
                ],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await openOrganizationPanel(user);
  expect(screen.getByText("当前已退化为本地阅读器，组织空间不可用。联网并登录后，将自动恢复云端能力。")).toBeInTheDocument();

  await loginThroughDialog(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  expect(screen.getByText("角色：研究员 · 成员 12 人")).toBeInTheDocument();
  expect(screen.getByText("共享文献库：组织共享文献库 · 48 篇")).toBeInTheDocument();
  expect(screen.getByText("通知：管理员发布了本周阅读主题。")).toBeInTheDocument();
  expect(screen.getByText("配额：38 / 100 GB，到期 2026-06-01T00:00:00Z")).toBeInTheDocument();
  expect(screen.getByText("治理：运行任务 2 个，失败任务 1 个")).toBeInTheDocument();
  expect(screen.getByText("最近审计：Admin 更新共享文献库上传权限")).toBeInTheDocument();
}, 10000);

test("does not open the organization shared library just by connecting", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/list")) {
        return {
          json: async () => ({
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "管理员",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  }
                ],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "http://127.0.0.1:8787",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await openLibraryPanel(user);
  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(within(libraryZone).getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
  expect(within(libraryZone).getByText("Survey of Vector Database Management Systems")).toBeInTheDocument();
  expect(
    within(libraryZone).queryByText("Organization Reading List: Retrieval-Augmented Generation")
  ).not.toBeInTheDocument();
}, 10000);

test("opens the organization shared library in the local workspace", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [
                {
                  actor: "Admin",
                  description: "更新共享文献库上传权限",
                  id: "audit-1",
                  occurredAt: "2026-05-14T10:30:00Z"
                }
              ],
              memberCount: 12,
              members: [
                {
                  id: "member-1",
                  name: "Liteasy Researcher",
                  role: "研究员"
                },
                {
                  id: "member-2",
                  name: "Admin",
                  role: "管理员"
                }
              ],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [
                {
                  id: "notice-1",
                  message: "管理员发布了本周阅读主题。",
                  type: "announcement"
                },
                {
                  id: "notice-2",
                  message: "成员上传了 Graph Neural Networks 综述。",
                  type: "document_upload"
                },
                {
                  id: "notice-3",
                  message: "共享文献库结构新增 RAG 目录。",
                  type: "library_change"
                }
              ],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  },
                  {
                    id: "org-doc-2",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
                    title: "Team Notes on Long-Context Evaluation"
                  }
                ],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "打开共享文献库" }));
  await openLibraryPanel(user);

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  const workspaceSwitcher = within(libraryZone).getByRole("group", { name: "文献视图切换" });
  expect(within(workspaceSwitcher).getByRole("button", { name: "组织" })).toHaveAttribute("aria-pressed", "true");
  expect(within(workspaceSwitcher).getByRole("button", { name: "本地" })).toHaveAttribute("aria-pressed", "false");
  expect(
    within(libraryZone).getByText("Organization Reading List: Retrieval-Augmented Generation")
  ).toBeInTheDocument();
  expect(within(libraryZone).getByText("Team Notes on Long-Context Evaluation")).toBeInTheDocument();
  expect(within(libraryZone).queryByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).not.toBeInTheDocument();
  expect(
    within(libraryZone).queryByText("Survey of Vector Database Management Systems")
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Reader 空状态")).toBeInTheDocument();
}, 10000);


test("returns from an organization shared library to the local library workspace", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 1, pendingReview: 3 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "管理员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [
                {
                  id: "org-doc-1",
                  sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                  title: "Organization Reading List: Retrieval-Augmented Generation"
                }
              ],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "打开共享文献库" }));
  await waitFor(() => {
    expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  });

  let libraryZone = screen.getByLabelText("我的文献库投放区");
  const organizationSwitcher = within(libraryZone).getByRole("group", { name: "文献视图切换" });
  await user.click(within(organizationSwitcher).getByRole("button", { name: "本地" }));

  libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();
  expect(within(libraryZone).getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
  expect(
    within(libraryZone).getByText("Survey of Vector Database Management Systems")
  ).toBeInTheDocument();
  expect(
    within(libraryZone).queryByText("Organization Reading List: Retrieval-Augmented Generation")
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Reader 空状态")).toBeInTheDocument();

  const localSwitcher = within(libraryZone).getByRole("group", { name: "文献视图切换" });
  await user.click(within(localSwitcher).getByRole("button", { name: "组织" }));

  await waitFor(() => {
    expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  });
  expect(
    within(screen.getByLabelText("我的文献库投放区")).getByText("Organization Reading List: Retrieval-Augmented Generation")
  ).toBeInTheDocument();
}, 10000);


test("shows organization members and notification details", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [
                {
                  actor: "Admin",
                  description: "更新共享文献库上传权限",
                  id: "audit-1",
                  occurredAt: "2026-05-14T10:30:00Z"
                }
              ],
              memberCount: 12,
              members: [
                {
                  id: "member-1",
                  name: "Liteasy Researcher",
                  role: "研究员"
                },
                {
                  id: "member-2",
                  name: "Admin",
                  role: "管理员"
                }
              ],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [
                {
                  id: "notice-1",
                  message: "管理员发布了本周阅读主题。",
                  type: "announcement"
                },
                {
                  id: "notice-2",
                  message: "成员上传了 Graph Neural Networks 综述。",
                  type: "document_upload"
                },
                {
                  id: "notice-3",
                  message: "共享文献库结构新增 RAG 目录。",
                  type: "library_change"
                }
              ],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  }
                ],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织成员：Liteasy Researcher（研究员）、Admin（管理员）")).toBeInTheDocument();
  });

  expect(screen.getByText("通知：公告 · 管理员发布了本周阅读主题。")).toBeInTheDocument();
  expect(screen.getByText("通知：文献上传 · 成员上传了 Graph Neural Networks 综述。")).toBeInTheDocument();
  expect(screen.getByText("通知：文献库变更 · 共享文献库结构新增 RAG 目录。")).toBeInTheDocument();
}, 10000);


test("marks organization notifications as read in the organization page", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 1, pendingReview: 3 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "管理员",
            name: "Liteasy AI Reading Lab",
            notifications: [
              {
                id: "notice-1",
                message: "管理员发布了本周阅读主题。",
                type: "announcement"
              },
              {
                id: "notice-2",
                message: "成员上传了 Graph Neural Networks 综述。",
                type: "document_upload"
              }
            ],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  const organizationPane = screen.getByLabelText("左边栏组织");
  expect(within(organizationPane).getByText("未读通知：2 条")).toBeInTheDocument();
  expect(
    within(organizationPane).getByText("通知状态：管理员发布了本周阅读主题。 · 未读")
  ).toBeInTheDocument();

  await user.click(within(organizationPane).getByRole("button", { name: "全部标记已读" }));

  expect(within(organizationPane).getByText("未读通知：0 条")).toBeInTheDocument();
  expect(
    within(organizationPane).getByText("通知状态：管理员发布了本周阅读主题。 · 已读")
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Reader 空状态")).toBeInTheDocument();
}, 10000);


test("shows organization governance summary after cloud account login", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: {
                highRisk: 1,
                pendingReview: 3
              },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [
                {
                  id: "audit-1",
                  label: "Admin 更新共享文献库上传权限",
                  risk: "medium"
                }
              ],
              runningTasks: [
                {
                  id: "task-1",
                  label: "组织共享文献库索引刷新",
                  status: "running"
                }
              ]
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [
                {
                  actor: "Admin",
                  description: "更新共享文献库上传权限",
                  id: "audit-1",
                  occurredAt: "2026-05-14T10:30:00Z"
                }
              ],
              memberCount: 12,
              members: [
                {
                  id: "member-1",
                  name: "Liteasy Researcher",
                  role: "研究员"
                }
              ],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [
                {
                  id: "notice-1",
                  message: "管理员发布了本周阅读主题。",
                  type: "announcement"
                }
              ],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("治理后台：待复核 3 项，高风险 1 项")).toBeInTheDocument();
  });

  expect(screen.getByText("组织配额：存储 38 / 100 GB，模型调用 4200 / 10000")).toBeInTheDocument();
  expect(screen.getByText("后台任务：组织共享文献库索引刷新（running）")).toBeInTheDocument();
  expect(screen.getByText("审计队列：Admin 更新共享文献库上传权限（medium）")).toBeInTheDocument();
}, 10000);


test("explains organization shared-library command prerequisites before login", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开组织共享文献库");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(
    screen.getByText("请先登录云账号，并在左边栏组织页加载组织空间后再打开共享文献库。")
  ).toBeInTheDocument();
  expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(within(libraryZone).getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
  expect(
    within(within(libraryZone).getByRole("group", { name: "文献视图切换" })).getByRole("button", { name: "组织" })
  ).toBeDisabled();
});


test("does not let assistant commands open an unavailable organization shared library", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: { highRisk: 0, pendingReview: 0 },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [],
              runningTasks: []
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  }
                ],
                name: "组织共享文献库",
                status: "unavailable"
              },
              taskSummary: {
                failed: 0,
                running: 0
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "打开共享文献库" })).toBeDisabled();

  await openLibraryPanel(user);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开组织共享文献库");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("组织共享文献库当前不可用，请稍后在左边栏组织页查看状态。"))
    .toBeInTheDocument();
  expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(within(libraryZone).getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
  expect(within(libraryZone).queryByText("Organization Reading List: Retrieval-Augmented Generation"))
    .not.toBeInTheDocument();
}, 10000);


test("does not let assistant commands open an empty organization shared library", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: { highRisk: 0, pendingReview: 0 },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [],
              runningTasks: []
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 0,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 0,
                running: 0
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await openLibraryPanel(user);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开组织共享文献库");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("组织共享文献库尚未下发可打开文献，请稍后在左边栏组织页查看同步状态。"))
    .toBeInTheDocument();
  expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(within(libraryZone).getByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).toBeInTheDocument();
}, 10000);


test("opens the organization shared library through a registered assistant command", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: { highRisk: 1, pendingReview: 3 },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [],
              runningTasks: []
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [
                  {
                    id: "org-doc-1",
                    sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
                    title: "Organization Reading List: Retrieval-Augmented Generation"
                  }
                ],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({
          cloudProxyEndpoint: "https://liteasy.example.com/model-proxy",
          defaultProvider: "openai",
          localDirectEnabled: false,
          localDirectEndpoint: "mock://local-direct",
          modelAccessMode: "cloud_proxy",
          policyVersion: "policy-dev-cloud-live",
          syncedAt: "2026-05-14T09:30:00Z"
        }),
        ok: true,
        status: 200
      };
    })
  );

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "打开组织共享文献库");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getAllByText("已打开组织共享文献库：组织共享文献库。").length).toBeGreaterThanOrEqual(1);
  });

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  expect(
    within(libraryZone).getByText("Organization Reading List: Retrieval-Augmented Generation")
  ).toBeInTheDocument();
  expect(within(libraryZone).queryByText("ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT")).not.toBeInTheDocument();
  expect(
    within(within(libraryZone).getByRole("group", { name: "文献视图切换" })).getByRole("button", { name: "组织" })
  ).toHaveAttribute("aria-pressed", "true");
}, 10000);


test("clears organization notification read state after cloud account logout", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(
    "liteasy.organization.notifications.read.v1",
    JSON.stringify(["org-demo-1:notice-1"])
  );

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await loginThroughDialog(user);
  await expectStoredAccountSession();

  const profilePanel = await openProfilePanel(user);
  await user.click(within(profilePanel).getByRole("button", { name: "退出登录" }));

  expect(window.localStorage.getItem("liteasy.organization.notifications.read.v1")).toBeNull();
}, 10000);


test("restores organization notification read state from local storage", async () => {
  const user = userEvent.setup();
  const accountTransport = async () => ({
    json: async () => ({
      session: {
        email: "researcher@liteasy.dev",
        expiresAt: "2026-05-15T09:30:00Z",
        name: "Liteasy Researcher",
        sessionId: "demo-session-1"
      }
    }),
    ok: true,
    status: 200
  });
  const organizationGovernanceTransport = async () => ({
    json: async () => ({
      summary: {
        auditQueue: { highRisk: 1, pendingReview: 3 },
        quota: {
          modelCallsLimit: 10000,
          modelCallsUsed: 4200,
          storageLimitGb: 100,
          storageUsedGb: 38
        },
        recentAuditEvents: [],
        runningTasks: []
      }
    }),
    ok: true,
    status: 200
  });
  const organizationListTransport = async () => ({
    json: async () => ({
      activeOrganizationId: "org-demo-1",
      organizations: [
        {
          memberCount: 12,
          myRole: "研究员",
          name: "Liteasy AI Reading Lab",
          organizationId: "org-demo-1",
          sharedLibraryName: "组织共享文献库"
        }
      ]
    }),
    ok: true,
    status: 200
  });
  const organizationTransport = async () => ({
    json: async () => ({
      summary: {
        auditEvents: [],
        memberCount: 12,
        members: [],
        myRole: "研究员",
        name: "Liteasy AI Reading Lab",
        notifications: [
          {
            id: "notice-1",
            message: "管理员发布了本周阅读主题。",
            type: "announcement"
          }
        ],
        organizationId: "org-demo-1",
        quota: {
          periodEndsAt: "2026-06-01T00:00:00Z",
          storageLimitGb: 100,
          storageUsedGb: 38
        },
        sharedLibrary: {
          documentCount: 48,
          documents: [],
          name: "组织共享文献库",
          status: "available"
        },
        taskSummary: {
          failed: 1,
          running: 2
        }
      }
    }),
    ok: true,
    status: 200
  });

  const { unmount } = render(
    <AppShell
      accountTransport={accountTransport}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={organizationGovernanceTransport}
      organizationListTransport={organizationListTransport}
      organizationTransport={organizationTransport}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("未读通知：1 条")).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: "全部标记已读" }));
  expect(screen.getByText("未读通知：0 条")).toBeInTheDocument();

  unmount();
  render(
    <AppShell
      accountTransport={accountTransport}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={organizationGovernanceTransport}
      organizationListTransport={organizationListTransport}
      organizationTransport={organizationTransport}
    />
  );

  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });
  expect(screen.getByText("未读通知：0 条")).toBeInTheDocument();
  expect(screen.getByText("通知状态：管理员发布了本周阅读主题。 · 已读")).toBeInTheDocument();
}, 10000);


test("keeps notification read state isolated per organization", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            },
            {
              memberCount: 4,
              myRole: "管理员",
              name: "Liteasy Literature Ops",
              organizationId: "org-demo-2",
              sharedLibraryName: "文献运营共享库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async (request) => {
        const body = JSON.parse(request.body);
        const isOpsOrganization = body.organizationId === "org-demo-2";

        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: isOpsOrganization ? 4 : 12,
              members: [],
              myRole: isOpsOrganization ? "管理员" : "研究员",
              name: isOpsOrganization ? "Liteasy Literature Ops" : "Liteasy AI Reading Lab",
              notifications: [
                {
                  id: "notice-1",
                  message: isOpsOrganization
                    ? "文献运营共享库新增 QA 目录。"
                    : "管理员发布了本周阅读主题。",
                  type: isOpsOrganization ? "library_change" : "announcement"
                }
              ],
              organizationId: isOpsOrganization ? "org-demo-2" : "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: isOpsOrganization ? 50 : 100,
                storageUsedGb: isOpsOrganization ? 12 : 38
              },
              sharedLibrary: {
                documentCount: isOpsOrganization ? 16 : 48,
                documents: [],
                name: isOpsOrganization ? "文献运营共享库" : "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 0,
                running: 1
              }
            }
          }),
          ok: true,
          status: 200
        };
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: "全部标记已读" }));
  expect(screen.getByText("通知状态：管理员发布了本周阅读主题。 · 已读")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "查看 Liteasy Literature Ops" }));

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy Literature Ops")).toBeInTheDocument();
  });
  expect(screen.getByText("未读通知：1 条")).toBeInTheDocument();
  expect(screen.getByText("通知状态：文献运营共享库新增 QA 目录。 · 未读")).toBeInTheDocument();
}, 10000);


test("switches organization detail from the joined organization list", async () => {
  const user = userEvent.setup();
  const organizationListRequests: string[] = [];
  const organizationSummaryRequests: string[] = [];

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async (request) => ({
        json: async () => ({
          summary: JSON.parse(request.body).organizationId === "org-demo-2"
            ? {
                auditQueue: { highRisk: 0, pendingReview: 1 },
                quota: {
                  modelCallsLimit: 5000,
                  modelCallsUsed: 900,
                  storageLimitGb: 50,
                  storageUsedGb: 12
                },
                recentAuditEvents: [],
                runningTasks: []
              }
            : {
                auditQueue: { highRisk: 1, pendingReview: 3 },
                quota: {
                  modelCallsLimit: 10000,
                  modelCallsUsed: 4200,
                  storageLimitGb: 100,
                  storageUsedGb: 38
                },
                recentAuditEvents: [],
                runningTasks: []
              }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async (request) => {
        organizationListRequests.push(request.body);

        return {
          json: async () => ({
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "研究员",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              },
              {
                memberCount: 4,
                myRole: "管理员",
                name: "Liteasy Literature Ops",
                organizationId: "org-demo-2",
                sharedLibraryName: "文献运营共享库"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }}
      organizationTransport={async (request) => {
        organizationSummaryRequests.push(request.body);
        const body = JSON.parse(request.body);
        const isOpsOrganization = body.organizationId === "org-demo-2";

        return {
          json: async () => ({
            summary: isOpsOrganization
              ? {
                  auditEvents: [],
                  memberCount: 4,
                  members: [
                    {
                      id: "member-ops-1",
                      name: "Liteasy Researcher",
                      role: "管理员"
                    }
                  ],
                  myRole: "管理员",
                  name: "Liteasy Literature Ops",
                  notifications: [
                    {
                      id: "ops-notice-1",
                      message: "文献运营共享库新增 QA 目录。",
                      type: "library_change"
                    }
                  ],
                  organizationId: "org-demo-2",
                  quota: {
                    periodEndsAt: "2026-06-01T00:00:00Z",
                    storageLimitGb: 50,
                    storageUsedGb: 12
                  },
                  sharedLibrary: {
                    documentCount: 16,
                    documents: [
                      {
                        id: "org-ops-doc-1",
                        sourcePath: "org://org-demo-2/shared-library/org-ops-doc-1.pdf",
                        title: "Organization Ops Handbook"
                      }
                    ],
                    name: "文献运营共享库",
                    status: "available"
                  },
                  taskSummary: {
                    failed: 0,
                    running: 1
                  }
                }
              : {
                  auditEvents: [],
                  memberCount: 12,
                  members: [],
                  myRole: "研究员",
                  name: "Liteasy AI Reading Lab",
                  notifications: [],
                  organizationId: "org-demo-1",
                  quota: {
                    periodEndsAt: "2026-06-01T00:00:00Z",
                    storageLimitGb: 100,
                    storageUsedGb: 38
                  },
                  sharedLibrary: {
                    documentCount: 48,
                    documents: [],
                    name: "组织共享文献库",
                    status: "available"
                  },
                  taskSummary: {
                    failed: 1,
                    running: 2
                  }
                }
          }),
          ok: true,
          status: 200
        };
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("已加入组织：Liteasy AI Reading Lab、Liteasy Literature Ops")).toBeInTheDocument();
  });

  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(organizationListRequests.map((body) => JSON.parse(body))).toEqual([
    { sessionId: "demo-session-1" }
  ]);

  await user.click(screen.getByRole("button", { name: "查看 Liteasy Literature Ops" }));

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy Literature Ops")).toBeInTheDocument();
  });

  expect(screen.getByText("角色：管理员 · 成员 4 人")).toBeInTheDocument();
  expect(screen.getByText("共享文献库：文献运营共享库 · 16 篇")).toBeInTheDocument();
  expect(screen.getByText("治理后台：待复核 1 项，高风险 0 项")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建组织" })).toHaveAttribute(
    "title",
    expect.stringContaining("当前账号权限：可创建组织，也可加入已有组织。")
  );
  expect(organizationSummaryRequests.map((body) => JSON.parse(body))).toContainEqual({
    organizationId: "org-demo-2",
    sessionId: "demo-session-1"
  });
}, 10000);

test("cancels the demo organization invite confirmation without side effects", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "管理员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  const dialog = screen.getByRole("dialog", { name: "邀请成员确认" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "邀请成员确认" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已创建面向 Liteasy AI Reading Lab 的邀请，当前为演示环境记录。")
  ).not.toBeInTheDocument();
}, 10000);


test("opens a confirmation seam before sending an organization invite", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "管理员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "管理员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "邀请成员" }));

  const dialog = screen.getByRole("dialog", { name: "邀请成员确认" });
  expect(within(dialog).getByText("邀请成员确认")).toBeInTheDocument();
  expect(within(dialog).getByText("组织：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(dialog).queryByText("当前演示环境会记录邀请动作，但不会真正发送邀请。正式版本将在此接入成员权限与邀请生命周期。"))
    .not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "发送邀请" })).toHaveAttribute("title");

  await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));

  expect(screen.queryByRole("dialog", { name: "邀请成员确认" })).not.toBeInTheDocument();
  expectOrganizationActionFeedback("已创建面向 Liteasy AI Reading Lab 的邀请，当前为演示环境记录。");
}, 10000);


test("cancels the demo organization leave confirmation without side effects", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "管理员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "退出组织" }));
  const dialog = screen.getByRole("dialog", { name: "退出组织确认" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "退出组织确认" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已提交退出 Liteasy AI Reading Lab 的请求，当前为演示环境记录。")
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a confirmation seam before submitting an organization leave request", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "退出组织" }));

  const dialog = screen.getByRole("dialog", { name: "退出组织确认" });
  expect(within(dialog).getByText("退出组织确认")).toBeInTheDocument();
  expect(within(dialog).getByText("组织：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(dialog).queryByText("当前演示环境会记录退出组织请求，但不会真正变更成员关系。正式版本将在此接入二次确认、权限校验与成员关系变更。"))
    .not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "提交退出组织请求" })).toHaveAttribute("title");

  await user.click(within(dialog).getByRole("button", { name: "提交退出组织请求" }));

  expect(screen.queryByRole("dialog", { name: "退出组织确认" })).not.toBeInTheDocument();
  expectOrganizationActionFeedback("已提交退出 Liteasy AI Reading Lab 的请求，当前为演示环境记录。");
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("cancels the demo organization creation without side effects", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "创建组织" }));
  const dialog = screen.getByRole("dialog", { name: "创建组织" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "创建组织" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。")
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a creation seam before submitting an organization creation request", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "创建组织" }));

  const dialog = screen.getByRole("dialog", { name: "创建组织" });
  expect(within(dialog).getByText("创建组织"));
  expect(within(dialog).getByLabelText("组织名称")).toHaveValue("Liteasy Demo Organization");
  expect(within(dialog).queryByText("当前演示环境会记录创建组织请求，但不会真正开通组织空间。正式版本将在此接入会员权限、套餐与组织开通流程。"))
    .not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "提交创建组织申请" })).toHaveAttribute("title");

  await user.click(within(dialog).getByRole("button", { name: "提交创建组织申请" }));

  expect(screen.queryByRole("dialog", { name: "创建组织" })).not.toBeInTheDocument();
  expectOrganizationActionFeedback("已提交创建组织“Liteasy Demo Organization”的申请，当前为演示环境记录。");
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("cancels the demo organization join request without side effects", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "加入组织" }));
  const dialog = screen.getByRole("dialog", { name: "加入组织" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "加入组织" })).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "已提交加入组织的邀请码 LITEASY-DEMO-JOIN，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。"
    )
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a join seam before submitting an organization join request", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 0, pendingReview: 1 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "加入组织" }));

  const dialog = screen.getByRole("dialog", { name: "加入组织" });
  expect(within(dialog).getByText("加入组织")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("组织邀请码")).toHaveValue("LITEASY-DEMO-JOIN");
  expect(within(dialog).queryByText("当前演示环境会记录加入组织请求，但不会真正变更成员关系。正式版本将在此接入邀请码校验、组织审批与成员权限。"))
    .not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "提交加入组织请求" })).toHaveAttribute("title");

  await user.click(within(dialog).getByRole("button", { name: "提交加入组织请求" }));

  expect(screen.queryByRole("dialog", { name: "加入组织" })).not.toBeInTheDocument();
  expectOrganizationActionFeedback(
    "已提交加入组织的邀请码 LITEASY-DEMO-JOIN，当前为演示环境记录；你的组织角色与成员关系暂不会立即变更。"
  );
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens the organization entry dialog and shows selected organization details", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationGovernanceTransport={async (request) => ({
        json: async () => ({
          summary: JSON.parse(request.body).organizationId === "org-demo-2"
            ? {
                auditQueue: { highRisk: 0, pendingReview: 1 },
                quota: {
                  modelCallsLimit: 5000,
                  modelCallsUsed: 900,
                  storageLimitGb: 50,
                  storageUsedGb: 12
                },
                recentAuditEvents: [],
                runningTasks: []
              }
            : {
                auditQueue: { highRisk: 1, pendingReview: 3 },
                quota: {
                  modelCallsLimit: 10000,
                  modelCallsUsed: 4200,
                  storageLimitGb: 100,
                  storageUsedGb: 38
                },
                recentAuditEvents: [],
                runningTasks: []
              }
        }),
        ok: true,
        status: 200
      })}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            },
            {
              memberCount: 4,
              myRole: "管理员",
              name: "Liteasy Literature Ops",
              organizationId: "org-demo-2",
              sharedLibraryName: "文献运营共享库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async (request) => {
        const body = JSON.parse(request.body);
        const isOpsOrganization = body.organizationId === "org-demo-2";

        return {
          json: async () => ({
            summary: isOpsOrganization
              ? {
                  auditEvents: [
                    {
                      actor: "Ops Admin",
                      description: "新增 QA 目录",
                      id: "audit-ops-1",
                      occurredAt: "2026-05-14T11:00:00Z"
                    }
                  ],
                  memberCount: 4,
                  members: [
                    {
                      id: "member-ops-1",
                      name: "Liteasy Researcher",
                      role: "管理员"
                    },
                    {
                      id: "member-ops-2",
                      name: "Ops Reviewer",
                      role: "审核员"
                    }
                  ],
                  myRole: "管理员",
                  name: "Liteasy Literature Ops",
                  notifications: [
                    {
                      id: "ops-notice-1",
                      message: "文献运营共享库新增 QA 目录。",
                      type: "library_change"
                    }
                  ],
                  organizationId: "org-demo-2",
                  quota: {
                    periodEndsAt: "2026-06-01T00:00:00Z",
                    storageLimitGb: 50,
                    storageUsedGb: 12
                  },
                  sharedLibrary: {
                    documentCount: 16,
                    documents: [
                      {
                        id: "org-ops-doc-1",
                        sourcePath: "org://org-demo-2/shared-library/org-ops-doc-1.pdf",
                        title: "Organization Ops Handbook"
                      }
                    ],
                    name: "文献运营共享库",
                    status: "available"
                  },
                  taskSummary: {
                    failed: 0,
                    running: 1
                  }
                }
              : {
                  auditEvents: [],
                  memberCount: 12,
                  members: [],
                  myRole: "研究员",
                  name: "Liteasy AI Reading Lab",
                  notifications: [],
                  organizationId: "org-demo-1",
                  quota: {
                    periodEndsAt: "2026-06-01T00:00:00Z",
                    storageLimitGb: 100,
                    storageUsedGb: 38
                  },
                  sharedLibrary: {
                    documentCount: 48,
                    documents: [],
                    name: "组织共享文献库",
                    status: "available"
                  },
                  taskSummary: {
                    failed: 1,
                    running: 2
                  }
                }
          }),
          ok: true,
          status: 200
        };
      }}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "打开组织窗口" }));

  const dialog = screen.getByRole("dialog", { name: "组织窗口" });
  expect(within(dialog).getByText("组织列表")).toBeInTheDocument();
  expect(within(dialog).getByText("Liteasy AI Reading Lab · 研究员 · 12 人 · 组织共享文献库")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "打开 Liteasy Literature Ops 详情" }));

  await waitFor(() => {
    expect(within(dialog).getByText("组织详情：Liteasy Literature Ops")).toBeInTheDocument();
  });

  expect(within(dialog).getByText("成员：Liteasy Researcher（管理员）、Ops Reviewer（研究员）")).toBeInTheDocument();
  expect(within(dialog).getByText("通知：文献库变更 · 文献运营共享库新增 QA 目录。")).toBeInTheDocument();
  expect(within(dialog).getByText("共享文献库：文献运营共享库 · 16 篇" )).toBeInTheDocument();
}, 10000);


test("keeps assistant profile commands behind runtime confirmation before personal center changes", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            membershipTier: "pro",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "开启用户画像");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(
    await screen.findByText("用户画像会影响个性化采样与后续回答策略，请确认后再开启。")
  ).toBeInTheDocument();

  const leftPane = await openProfilePanel(user);

  expect(within(leftPane).getByText("用户画像：已关闭")).toBeInTheDocument();
  expect(within(leftPane).getByRole("button", { name: "开启用户画像" })).toBeInTheDocument();
});

test("opens the personal center in the left rail and toggles user profile sampling", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 1, pendingReview: 3 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  const leftPane = await openProfilePanel(user);
  expect(within(leftPane).getByText("个人中心")).toBeInTheDocument();
  expect(within(leftPane).getByText("昵称：Liteasy Researcher")).toBeInTheDocument();
  expect(within(leftPane).getByText("用户 ID：demo-session-1")).toBeInTheDocument();
  expect(within(leftPane).getByText("所在团队：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(leftPane).getByText("画像配置：性别 未设置 · 年龄 未设置 · 学段 未设置")).toBeInTheDocument();
  expect(within(leftPane).getByText("用户画像：已关闭" )).toBeInTheDocument();

  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));

  expect(within(leftPane).getByText("用户画像：已开启")).toBeInTheDocument();
  expect(within(leftPane).getByText("已阅读论文数：3")).toBeInTheDocument();
  expect(within(leftPane).getByText("学术人格：跨学科综述型" )).toBeInTheDocument();
  expect(within(leftPane).getByRole("button", { name: "学术档案" })).toBeInTheDocument();
  expect(within(leftPane).getByRole("button", { name: "清空用户画像（需鉴权）" })).toBeInTheDocument();
}, 10000);


test("updates academic profile configuration from the personal center and archive", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            membershipTier: "pro",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);

  const leftPane = await openProfilePanel(user);

  await user.selectOptions(within(leftPane).getByLabelText("性别"), "女");
  await user.clear(within(leftPane).getByLabelText("年龄"));
  await user.type(within(leftPane).getByLabelText("年龄"), "28");
  await user.selectOptions(within(leftPane).getByLabelText("学段"), "博士研究生");
  await user.click(within(leftPane).getByRole("button", { name: "保存画像配置" }));

  expect(within(leftPane).getByText("画像配置：性别 女 · 年龄 28 · 学段 博士研究生")).toBeInTheDocument();
  expect(within(leftPane).getByText("画像配置已更新。")).toBeInTheDocument();

  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));
  await user.click(within(leftPane).getByRole("button", { name: "学术档案" }));

  const archiveDialog = screen.getByRole("dialog", { name: "学术档案页面" });
  expect(within(archiveDialog).getByText("身份配置：性别 女 · 年龄 28 · 学段 博士研究生")).toBeInTheDocument();
}, 10000);

test("opens the academic archive page from the personal center", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 1, pendingReview: 3 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  const leftPane = await openProfilePanel(user);
  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));
  await user.click(within(leftPane).getByRole("button", { name: "学术档案" }));

  const archiveDialog = screen.getByRole("dialog", { name: "学术档案页面" });
  expect(within(archiveDialog).getByText("学术档案" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("档案所有者：Liteasy Researcher" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("身份配置：性别 未设置 · 年龄 未设置 · 学段 未设置" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("阅读统计：已阅读 3 篇论文" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("学术人格分析：跨学科综述型" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("授权状态：微信/飞书/本地文件 未授权" )).toBeInTheDocument();
}, 10000);

test("requires confirmation before clearing the user profile", async () => {
  const user = userEvent.setup();

  render(
    <AppShell
      accountTransport={async () => ({
        json: async () => ({
          session: {
            email: "researcher@liteasy.dev",
            expiresAt: "2026-05-15T09:30:00Z",
            name: "Liteasy Researcher",
            sessionId: "demo-session-1"
          }
        }),
        ok: true,
        status: 200
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
      organizationListTransport={async () => ({
        json: async () => ({
          activeOrganizationId: "org-demo-1",
          organizations: [
            {
              memberCount: 12,
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              organizationId: "org-demo-1",
              sharedLibraryName: "组织共享文献库"
            }
          ]
        }),
        ok: true,
        status: 200
      })}
      organizationTransport={async () => ({
        json: async () => ({
          summary: {
            auditEvents: [],
            memberCount: 12,
            members: [],
            myRole: "研究员",
            name: "Liteasy AI Reading Lab",
            notifications: [],
            organizationId: "org-demo-1",
            quota: {
              periodEndsAt: "2026-06-01T00:00:00Z",
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            sharedLibrary: {
              documentCount: 48,
              documents: [],
              name: "组织共享文献库",
              status: "available"
            },
            taskSummary: {
              failed: 1,
              running: 2
            }
          }
        }),
        ok: true,
        status: 200
      })}
      organizationGovernanceTransport={async () => ({
        json: async () => ({
          summary: {
            auditQueue: { highRisk: 1, pendingReview: 3 },
            quota: {
              modelCallsLimit: 10000,
              modelCallsUsed: 4200,
              storageLimitGb: 100,
              storageUsedGb: 38
            },
            recentAuditEvents: [],
            runningTasks: []
          }
        }),
        ok: true,
        status: 200
      })}
    />
  );

  await loginThroughDialog(user);
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  const leftPane = await openProfilePanel(user);
  await user.selectOptions(within(leftPane).getByLabelText("性别"), "女");
  await user.clear(within(leftPane).getByLabelText("年龄"));
  await user.type(within(leftPane).getByLabelText("年龄"), "28");
  await user.selectOptions(within(leftPane).getByLabelText("学段"), "博士研究生");
  await user.click(within(leftPane).getByRole("button", { name: "保存画像配置" }));
  expect(within(leftPane).getByText("画像配置：性别 女 · 年龄 28 · 学段 博士研究生")).toBeInTheDocument();

  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));
  await user.click(within(leftPane).getByRole("button", { name: "清空用户画像（需鉴权）" }));

  const clearDialog = screen.getByRole("dialog", { name: "清空用户画像确认" });
  expect(within(clearDialog).getByText("清空用户画像确认" )).toBeInTheDocument();
  expect(within(clearDialog).getByText("将清空性别、年龄、学段、阅读统计和学术人格缓存；昵称、用户 ID 和头像会保留。" )).toBeInTheDocument();

  await user.click(within(clearDialog).getByRole("button", { name: "确认清空用户画像" }));

  expect(screen.queryByRole("dialog", { name: "清空用户画像确认" })).not.toBeInTheDocument();
  expect(within(leftPane).getByText("用户画像：已关闭")).toBeInTheDocument();
  expect(within(leftPane).getByText("画像配置：性别 未设置 · 年龄 未设置 · 学段 未设置")).toBeInTheDocument();
  expect(within(leftPane).getByLabelText("性别")).toHaveValue("未设置");
  expect(within(leftPane).getByLabelText("年龄")).toHaveValue("");
  expect(within(leftPane).getByLabelText("学段")).toHaveValue("未设置");
  expect(within(leftPane).getByText("用户画像已清空，基础身份信息已保留。" )).toBeInTheDocument();
}, 10000);

test("keeps workspace dialogs inside the workbench after removing the top account bar", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/admin/model-policy")) {
        return {
          json: async () => ({
            cloudProxyEndpoint: "http://127.0.0.1:8787",
            defaultProvider: "openai",
            localDirectEnabled: false,
            localDirectEndpoint: "mock://local-direct",
            modelAccessMode: "cloud_proxy",
            policyVersion: "dev-policy-v1",
            syncedAt: "2026-05-14T09:30:00Z"
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/list")) {
        return {
          json: async () => ({
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "研究员",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({}),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  expect(document.querySelector(".app-topbar")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "登录云账号" })).not.toBeInTheDocument();
  await loginThroughDialog(user);
  await openOrganizationPanel(user);
  await user.click(screen.getByRole("button", { name: "打开组织窗口" }));

  const dialogLayer = screen.getByTestId("workspace-dialog-layer");
  const appShell = dialogLayer.closest(".app-shell");

  expect(appShell).toBeInTheDocument();
  expect(dialogLayer).toContainElement(screen.getByRole("dialog", { name: "组织窗口" }));
});

test("keeps the right pane as a minimal AI assistant and moves admin panels out", async () => {
  render(<AppShell />);

  const readerHeader = await screen.findByLabelText("Reader 标题栏");
  const rightPane = screen.getByLabelText("右栏AI助手");
  expect(
    within(rightPane).getByPlaceholderText("输入消息，使用 /、@、$ 添加指令、论文或 skill")
  ).toBeInTheDocument();
  expect(within(rightPane).queryByText("模型接入策略")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("文献元数据同步")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("组织空间")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("组织治理")).not.toBeInTheDocument();

  expect(within(readerHeader).queryByText("云端模型能力")).not.toBeInTheDocument();
  expect(within(readerHeader).queryByText("LiteasyClaw")).not.toBeInTheDocument();
});

test("opens settings from the activity bar and keeps only user-facing cloud capability details", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "设置" }));

  const settingsPane = screen.getByLabelText("左边栏设置");
  expect(within(settingsPane).getByText("设置")).toBeInTheDocument();
  expect(within(settingsPane).queryByText("模型接入策略")).not.toBeInTheDocument();
  expect(within(settingsPane).getByText("云端模型能力")).toBeInTheDocument();
  expect(within(settingsPane).getByText("文献元数据同步")).toBeInTheDocument();
  expect(within(settingsPane).queryByText("组织空间")).not.toBeInTheDocument();
  expect(within(settingsPane).queryByText("组织治理")).not.toBeInTheDocument();
  expect(within(settingsPane).queryByText("开发云端点诊断")).not.toBeInTheDocument();
});

test("opens organization from the activity bar and keeps governance there", async () => {
  const user = userEvent.setup();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (String(input).includes("/v1/account/demo-login")) {
        return {
          json: async () => ({
            session: {
              email: "researcher@liteasy.dev",
              expiresAt: "2026-05-15T09:30:00Z",
              name: "Liteasy Researcher",
              sessionId: "demo-session-1"
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/admin/model-policy")) {
        return {
          json: async () => ({
            cloudProxyEndpoint: "http://127.0.0.1:8787",
            defaultProvider: "openai",
            localDirectEnabled: false,
            localDirectEndpoint: "mock://local-direct",
            modelAccessMode: "cloud_proxy",
            policyVersion: "dev-policy-v1",
            syncedAt: "2026-05-14T09:30:00Z"
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/list")) {
        return {
          json: async () => ({
            activeOrganizationId: "org-demo-1",
            organizations: [
              {
                memberCount: 12,
                myRole: "研究员",
                name: "Liteasy AI Reading Lab",
                organizationId: "org-demo-1",
                sharedLibraryName: "组织共享文献库"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/summary")) {
        return {
          json: async () => ({
            summary: {
              auditEvents: [],
              memberCount: 12,
              members: [],
              myRole: "研究员",
              name: "Liteasy AI Reading Lab",
              notifications: [],
              organizationId: "org-demo-1",
              quota: {
                periodEndsAt: "2026-06-01T00:00:00Z",
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              sharedLibrary: {
                documentCount: 48,
                documents: [],
                name: "组织共享文献库",
                status: "available"
              },
              taskSummary: {
                failed: 1,
                running: 2
              }
            }
          }),
          ok: true,
          status: 200
        };
      }

      if (String(input).includes("/v1/org/governance-summary")) {
        return {
          json: async () => ({
            summary: {
              auditQueue: { highRisk: 1, pendingReview: 3 },
              quota: {
                modelCallsLimit: 10000,
                modelCallsUsed: 4200,
                storageLimitGb: 100,
                storageUsedGb: 38
              },
              recentAuditEvents: [],
              runningTasks: []
            }
          }),
          ok: true,
          status: 200
        };
      }

      return {
        json: async () => ({}),
        ok: true,
        status: 200
      };
    })
  );

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "跳过，进入本地阅读器" }));

  let organizationPane = await openOrganizationPanel(user);
  expect(within(organizationPane).getByText("组织")).toBeInTheDocument();
  expect(within(organizationPane).getByText("组织空间")).toBeInTheDocument();
  expect(within(organizationPane).getByText("组织治理")).toBeInTheDocument();
  expect(within(organizationPane).getByRole("button", { name: "登录后查看组织能力" })).toBeInTheDocument();

  await user.click(within(organizationPane).getByRole("button", { name: "登录后查看组织能力" }));
  expect(screen.getByRole("dialog", { name: "轻量登录面板" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "一键 Demo 登录" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    organizationPane = screen.getByLabelText("左边栏组织");
    expect(within(organizationPane).getByRole("button", { name: "打开组织窗口" })).toBeInTheDocument();
  });
});


test("renders the activity bar separately from the library pane", async () => {
  render(<AppShell />);

  await screen.findByLabelText("Reader 标题栏");
  const activityBar = screen.getByLabelText("左边栏导航");
  expect(within(activityBar).getByRole("button", { name: "文献库" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "组织" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "个人中心" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "设置" })).toBeInTheDocument();

  expect(screen.getByText("我的文献库")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "关闭工作区" })).not.toBeInTheDocument();
});

test("keeps assistant onboarding and mode hints in hover text instead of persistent copy", async () => {
  render(<AppShell />);

  await waitFor(() => {
    expect(screen.getByLabelText("Reader 标题栏")).toBeInTheDocument();
  });

  const launcher = screen.getByLabelText("AI助手初始模式入口");
  expect(
    within(launcher).queryByText("选择一个入口开始会话。")
  ).not.toBeInTheDocument();
  expect(launcher).toHaveAttribute(
    "title",
    "选择一个入口开始会话。"
  );

  expect(screen.getByText("当前模式：命令")).toBeInTheDocument();
  expect(
    screen.queryByText("命令模式可输入“打开组织共享文献库”“关闭联网推荐”“开启用户画像”等受控指令。")
  ).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveAttribute(
    "title",
    "命令模式可输入“打开组织共享文献库”“关闭联网推荐”“开启用户画像”等受控指令。"
  );
});
