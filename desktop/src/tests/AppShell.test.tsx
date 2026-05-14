import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function openSettingsPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "设置" }));
  return screen.getByLabelText("左边栏设置");
}

async function openOrganizationPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "组织" }));
  return screen.getByLabelText("左边栏组织");
}

async function openLibraryPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "文献库" }));
  return screen.getByLabelText("我的文献库投放区");
}

test("grounds qa answers in the currently selected imported paper set", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("parsed")).toBeInTheDocument();
  }, { timeout: 2500 });

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("总结这篇论文的核心方法")).toBeInTheDocument();
  expect(screen.getByText(/demo-2 · 第/)).toBeInTheDocument();
}, 10000);

test("renders artifact content from imported selected-document chunks", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "思维导图" }));

  await waitFor(() => {
    expect(screen.getByText("Transformer Mind Map")).toBeInTheDocument();
  }, { timeout: 3000 });

  expect(
    screen.getAllByText("BERT: Pre-training of Deep Bidirectional Transformers").length
  ).toBeGreaterThan(1);
  expect(screen.getByText("双向预训练")).toBeInTheDocument();
  expect(screen.getByText("预训练目标")).toBeInTheDocument();
}, 10000);

test("switches assistant generation to local-direct mode when cloud policy allows it", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("parsed")).toBeInTheDocument();
  }, { timeout: 2500 });

  await openSettingsPanel(user);
  await user.click(screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" }));
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
  await openLibraryPanel(user);
  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/本地直连回答：这篇论文的预训练目标是什么？/)).toBeInTheDocument();
  });
}, 10000);

test("falls back to cloud proxy when local-direct permission is turned off", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("parsed")).toBeInTheDocument();
  }, { timeout: 2500 });

  await openSettingsPanel(user);
  const localToggle = screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" });
  await user.click(localToggle);
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
  await user.click(localToggle);
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/云端回答：总结这篇论文的核心方法/)).toBeInTheDocument();
  });
}, 10000);

test("allows assistant commands to switch model policy before qa generation", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("parsed")).toBeInTheDocument();
  }, { timeout: 2500 });

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "允许本地直连");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "切换到本地直连");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/模型：本地直连/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/本地直连回答：这篇论文的预训练目标是什么？/)).toBeInTheDocument();
  });
}, 10000);

test("syncs model access policy from the cloud control plane", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await openSettingsPanel(user);
  await user.click(screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" }));
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
  expect(screen.getByText(/当前通道：本地直连/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "同步云端策略" }));

  await waitFor(() => {
    expect(screen.getByText(/当前通道：云代理/)).toBeInTheDocument();
  });

  expect(
    screen.getByText(/已从云端同步模型策略，当前以云端管理员下发配置为准。/)
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" })
  ).not.toBeChecked();
}, 10000);

test("allows assistant commands to sync cloud model policy", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await openSettingsPanel(user);
  await user.click(screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" }));
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
  expect(screen.getByText(/当前通道：本地直连/)).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "同步云端策略");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/当前通道：云代理/)).toBeInTheDocument();
  });

  expect(screen.getAllByText(/已从云端同步模型策略/).length).toBeGreaterThan(0);
}, 10000);

test("auto-syncs cloud model policy on startup", async () => {
  render(
    <AppShell
      initialSettings={{
        "models.access_mode": "local_direct",
        "models.local_direct_enabled": true
      }}
    />
  );

  const settingsPane = await openSettingsPanel(userEvent.setup());

  await waitFor(() => {
    expect(within(settingsPane).getByText(/当前通道：云代理/)).toBeInTheDocument();
  });

  expect(within(settingsPane).getByText("同步状态：已同步")).toBeInTheDocument();
  expect(screen.getByText("策略版本：mock-policy-v1")).toBeInTheDocument();
  expect(screen.getByText("最近同步：2026-05-14T09:30:00Z")).toBeInTheDocument();
}, 10000);

test("shows a failed sync status when startup policy sync cannot reach the cloud", async () => {
  render(
    <AppShell
      controlPlaneTransport={async () => ({
        json: async () => ({
          error: "unavailable"
        }),
        ok: false,
        status: 503
      })}
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  const settingsPane = await openSettingsPanel(userEvent.setup());

  await waitFor(() => {
    expect(within(settingsPane).getByText("同步状态：失败")).toBeInTheDocument();
  });

  expect(within(settingsPane).getByText(/云端策略同步失败/)).toBeInTheDocument();
}, 10000);

test("shows the latest model execution chain in the policy panel", async () => {
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

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));
  await user.click(screen.getByRole("button", { name: "交给AI流程" }));

  await waitFor(() => {
    expect(screen.getByText("parsed")).toBeInTheDocument();
  }, { timeout: 2500 });

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  const settingsPane = await openSettingsPanel(user);

  await waitFor(() => {
    expect(within(settingsPane).getByText("最近执行：云代理 -> 开发云 -> OpenAI")).toBeInTheDocument();
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));

  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  expect(screen.getByText("researcher@liteasy.dev")).toBeInTheDocument();
  unmount();

  render(
    <AppShell
      initialSettings={{
        "models.control_plane_endpoint": "https://liteasy.example.com/control-plane"
      }}
    />
  );

  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  expect(screen.getByText("researcher@liteasy.dev")).toBeInTheDocument();
  await openSettingsPanel(user);
  expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
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
                id: "rec-bert-1",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注大规模预训练语言模型的迁移能力。",
                source: "Semantic Scholar",
                title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
              },
              {
                discoveredAt: "2026-05-14T09:10:00Z",
                id: "rec-bert-2",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "medium",
                relevanceScore: 0.78,
                reason: "延续 BERT 路线，强调参数共享与效率优化。",
                source: "arXiv Watch",
                title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
              }
            ]
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));

  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));

  await waitFor(() => {
    expect(
      screen.getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    ).toBeInTheDocument();
  });

  expect(screen.getByText("Semantic Scholar")).toBeInTheDocument();
  expect(screen.getByText("同样关注大规模预训练语言模型的迁移能力。")).toBeInTheDocument();
  expect(
    screen.getAllByText("关联：BERT: Pre-training of Deep Bidirectional Transformers").length
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
                id: "rec-bert-1",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注大规模预训练语言模型的迁移能力。",
                source: "Semantic Scholar",
                title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
              },
              {
                discoveredAt: "2026-05-14T09:10:00Z",
                id: "rec-bert-2",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "medium",
                relevanceScore: 0.78,
                reason: "延续 BERT 路线，强调参数共享与效率优化。",
                source: "arXiv Watch",
                title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
              }
            ]
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await waitFor(() => {
    expect(screen.getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")).toBeInTheDocument();
  });

  const recommendationList = screen.getByLabelText("关联推荐列表");
  expect(within(recommendationList).getAllByRole("listitem")[0]).toHaveTextContent(
    "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "按检索时间排序推荐");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/已更新 推荐排序：按检索时间/)).toBeInTheDocument();
  });

  expect(within(recommendationList).getAllByRole("listitem")[0]).toHaveTextContent(
    "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
  );
}, 10000);

test("drags a recommendation into local collection and restores it on next render", async () => {
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
                id: "rec-bert-1",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注大规模预训练语言模型的迁移能力。",
                source: "Semantic Scholar",
                title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
              }
            ]
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));

  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));

  await waitFor(() => {
    expect(
      screen.getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
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
    .getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    .closest("li");
  expect(recommendationCard).not.toBeNull();
  fireEvent.dragStart(recommendationCard!, { dataTransfer });

  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });

  await waitFor(() => {
    expect(
      within(collectionZone).getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
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
        "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
      )
    ).toBeInTheDocument();
  });
}, 10000);

test("drags collected and recommended papers into the local library without duplicates", async () => {
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
                id: "rec-bert-1",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注大规模预训练语言模型的迁移能力。",
                source: "Semantic Scholar",
                title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
              }
            ]
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await waitFor(() => {
    expect(
      screen.getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
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
    .getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
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
      within(libraryZone).getByLabelText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    ).toBeInTheDocument();
  });

  expect(
    within(libraryZone).getAllByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
  ).toHaveLength(1);

  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });
  const collectedCard = within(collectionZone)
    .getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    .closest("li");
  expect(collectedCard).not.toBeNull();

  fireEvent.dragStart(collectedCard!, { dataTransfer });
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });

  expect(
    within(libraryZone).getAllByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
  ).toHaveLength(1);
}, 10000);

test("reuses cached recommendations until a collected paper is added to the library", async () => {
  const user = userEvent.setup();
  let recommendationRequestCount = 0;

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
                id: "rec-bert-1",
                relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
                relevanceBand: "high",
                relevanceScore: 0.92,
                reason: "同样关注大规模预训练语言模型的迁移能力。",
                source: "Semantic Scholar",
                title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
              }
            ]
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });
  await openLibraryPanel(user);

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await waitFor(() => {
    expect(screen.getByText("Liteasy Researcher")).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await waitFor(() => {
    expect(screen.getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")).toBeInTheDocument();
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
    .getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    .closest("li");
  expect(recommendationCard).not.toBeNull();
  const collectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragStart(recommendationCard!, { dataTransfer });
  fireEvent.dragOver(collectionZone, { dataTransfer });
  fireEvent.drop(collectionZone, { dataTransfer });

  await waitFor(() => {
    expect(
      within(collectionZone).getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
    ).toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await waitFor(() => {
    expect(screen.queryByLabelText("关联推荐列表")).not.toBeInTheDocument();
  });

  await user.click(screen.getByLabelText("BERT: Pre-training of Deep Bidirectional Transformers"));
  await waitFor(() => {
    expect(screen.getByText("已显示当前选中文献集的缓存推荐。")).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(1);


  const restoredCollectionZone = screen.getByLabelText("收藏投放区");
  fireEvent.dragStart(
    within(restoredCollectionZone)
      .getByText("RoBERTa: A Robustly Optimized BERT Pretraining Approach")
      .closest("li")!,
    { dataTransfer }
  );
  const libraryZone = screen.getByLabelText("我的文献库投放区");
  fireEvent.dragOver(libraryZone, { dataTransfer });
  fireEvent.drop(libraryZone, { dataTransfer });

  await user.click(screen.getByLabelText("RoBERTa: A Robustly Optimized BERT Pretraining Approach"));
  await waitFor(() => {
    expect(screen.getByText("已获取 1 条关联推荐。")).toBeInTheDocument();
  });
  expect(recommendationRequestCount).toBe(2);
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
              acceptedCount: 2,
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
    expect(within(settingsPane).getByText("文献同步：已同步 2 篇")).toBeInTheDocument();
  });

  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/documents/metadata-sync");
  expect(requestedUrls.some((url) => url.startsWith("mock://"))).toBe(false);
});

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
              acceptedCount: 2,
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
  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });

  expect(screen.getByText("文献同步：未连接云账号")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));

  await waitFor(() => {
    expect(screen.getByText("文献同步：已同步 2 篇")).toBeInTheDocument();
  });

  expect(screen.getByText("最近同步：2026-05-14T10:20:00Z")).toBeInTheDocument();
  expect(screen.getByText("同步批次：metadata-sync-1")).toBeInTheDocument();
  expect(JSON.parse(metadataRequests[0])).toEqual({
    documents: [
      {
        id: "demo-1",
        sourcePath: "fixtures/attention-is-all-you-need.pdf",
        title: "Attention Is All You Need"
      },
      {
        id: "demo-2",
        sourcePath: "fixtures/bert-pretraining.pdf",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ],
    sessionId: "demo-session-1",
    workspaceRevision: 0
  });
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

      if (String(input).includes("/v1/documents/metadata-sync")) {
        return {
          json: async () => ({
            result: {
              acceptedCount: 2,
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/account/demo-login");
  expect(requestedUrls).toContain("http://127.0.0.1:8787/v1/org/summary");
  expect(requestedUrls.some((url) => url.startsWith("mock://"))).toBe(false);
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
  expect(screen.getByText("连接云账号后会加载组织空间。")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));

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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await openLibraryPanel(user);
  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(within(libraryZone).getByText("Attention Is All You Need")).toBeInTheDocument();
  expect(within(libraryZone).getByText("BERT: Pre-training of Deep Bidirectional Transformers")).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "打开共享文献库" }));
  await openLibraryPanel(user);

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  expect(
    within(libraryZone).getByText("Organization Reading List: Retrieval-Augmented Generation")
  ).toBeInTheDocument();
  expect(within(libraryZone).getByText("Team Notes on Long-Context Evaluation")).toBeInTheDocument();
  expect(within(libraryZone).queryByText("Attention Is All You Need")).not.toBeInTheDocument();
  expect(
    within(libraryZone).queryByText("BERT: Pre-training of Deep Bidirectional Transformers")
  ).not.toBeInTheDocument();
  expect(screen.getByText("已打开组织共享文献库：组织共享文献库。"));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "打开共享文献库" }));
  await waitFor(() => {
    expect(screen.getByText("当前工作区：组织共享文献库（Liteasy AI Reading Lab）")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "返回本地文献库" }));

  const libraryZone = screen.getByLabelText("我的文献库投放区");
  expect(screen.getByText("当前工作区：本地文献库")).toBeInTheDocument();
  expect(within(libraryZone).getByText("Attention Is All You Need")).toBeInTheDocument();
  expect(
    within(libraryZone).getByText("BERT: Pre-training of Deep Bidirectional Transformers")
  ).toBeInTheDocument();
  expect(
    within(libraryZone).queryByText("Organization Reading List: Retrieval-Augmented Generation")
  ).not.toBeInTheDocument();
  expect(screen.getByText("已返回本地文献库。"));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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
  expect(screen.getByText("组织通知已全部标记为已读。"));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("治理后台：待复核 3 项，高风险 1 项")).toBeInTheDocument();
  });

  expect(screen.getByText("组织配额：存储 38 / 100 GB，模型调用 4200 / 10000")).toBeInTheDocument();
  expect(screen.getByText("后台任务：组织共享文献库索引刷新（running）")).toBeInTheDocument();
  expect(screen.getByText("审计队列：Admin 更新共享文献库上传权限（medium）")).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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
  expect(within(libraryZone).queryByText("Attention Is All You Need")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回本地文献库" })).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "断开云账号" })).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "断开云账号" }));

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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  const dialog = screen.getByRole("dialog", { name: "邀请成员确认" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "邀请成员确认" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已创建 Liteasy AI Reading Lab 的 demo 邀请，等待正式后端接入。")
  ).not.toBeInTheDocument();
}, 10000);


test("opens a confirmation seam before sending a demo organization invite", async () => {
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "邀请成员" }));

  const dialog = screen.getByRole("dialog", { name: "邀请成员确认" });
  expect(within(dialog).getByText("邀请成员确认")).toBeInTheDocument();
  expect(within(dialog).getByText("组织：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(dialog).getByText("Demo 邀请不会发送真实邮件。正式版本需要组织权限校验。"))
    .toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "发送 demo 邀请" }));

  expect(screen.queryByRole("dialog", { name: "邀请成员确认" })).not.toBeInTheDocument();
  expect(screen.getByText("已创建 Liteasy AI Reading Lab 的 demo 邀请，等待正式后端接入。"))
    .toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "退出组织" }));
  const dialog = screen.getByRole("dialog", { name: "退出组织确认" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "退出组织确认" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已创建退出 Liteasy AI Reading Lab 的 demo 请求，等待正式后端接入。")
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a confirmation seam before creating a demo organization leave request", async () => {
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "退出组织" }));

  const dialog = screen.getByRole("dialog", { name: "退出组织确认" });
  expect(within(dialog).getByText("退出组织确认")).toBeInTheDocument();
  expect(within(dialog).getByText("组织：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(dialog).getByText("Demo 退出不会移除真实成员关系，也不会关闭共享文献库访问。正式版本需要二次鉴权和组织策略校验。"))
    .toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "创建 demo 退出请求" }));

  expect(screen.queryByRole("dialog", { name: "退出组织确认" })).not.toBeInTheDocument();
  expect(screen.getByText("已创建退出 Liteasy AI Reading Lab 的 demo 请求，等待正式后端接入。"))
    .toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "创建组织" }));
  const dialog = screen.getByRole("dialog", { name: "创建组织" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "创建组织" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已创建 Liteasy Demo Organization 的 demo 组织申请，等待正式后端接入。")
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a creation seam before creating a demo organization request", async () => {
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "创建组织" }));

  const dialog = screen.getByRole("dialog", { name: "创建组织" });
  expect(within(dialog).getByText("创建组织"));
  expect(within(dialog).getByLabelText("组织名称")).toHaveValue("Liteasy Demo Organization");
  expect(within(dialog).getByText("Demo 创建不会写入真实后端或申请云端空间。正式版本需要套餐、权限与计费校验。"))
    .toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "创建 demo 组织申请" }));

  expect(screen.queryByRole("dialog", { name: "创建组织" })).not.toBeInTheDocument();
  expect(screen.getByText("已创建 Liteasy Demo Organization 的 demo 组织申请，等待正式后端接入。"))
    .toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "加入组织" }));
  const dialog = screen.getByRole("dialog", { name: "加入组织" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));

  expect(screen.queryByRole("dialog", { name: "加入组织" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("已提交组织邀请码 LITEASY-DEMO-JOIN 的 demo 加入申请，等待正式后端接入。")
  ).not.toBeInTheDocument();
  expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
}, 10000);


test("opens a join seam before creating a demo organization join request", async () => {
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);
  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "加入组织" }));

  const dialog = screen.getByRole("dialog", { name: "加入组织" });
  expect(within(dialog).getByText("加入组织")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("组织邀请码")).toHaveValue("LITEASY-DEMO-JOIN");
  expect(within(dialog).getByText("Demo 加入不会校验真实邀请码或写入组织成员关系。正式版本需要邀请生命周期、组织权限与管理员审批。"))
    .toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "提交 demo 加入申请" }));

  expect(screen.queryByRole("dialog", { name: "加入组织" })).not.toBeInTheDocument();
  expect(screen.getByText("已提交组织邀请码 LITEASY-DEMO-JOIN 的 demo 加入申请，等待正式后端接入。"))
    .toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
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

  expect(within(dialog).getByText("成员：Liteasy Researcher（管理员）、Ops Reviewer（审核员）")).toBeInTheDocument();
  expect(within(dialog).getByText("通知：文献库变更 · 文献运营共享库新增 QA 目录。")).toBeInTheDocument();
  expect(within(dialog).getByText("共享文献库：文献运营共享库 · 16 篇" )).toBeInTheDocument();
}, 10000);

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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "个人中心" }));

  const leftPane = screen.getByLabelText("左边栏个人中心");
  expect(within(leftPane).getByText("个人中心")).toBeInTheDocument();
  expect(within(leftPane).getByText("昵称：Liteasy Researcher")).toBeInTheDocument();
  expect(within(leftPane).getByText("用户 ID：demo-session-1")).toBeInTheDocument();
  expect(within(leftPane).getByText("所在团队：Liteasy AI Reading Lab")).toBeInTheDocument();
  expect(within(leftPane).getByText("画像配置：性别 未设置 · 年龄 未设置 · 学段 未设置")).toBeInTheDocument();
  expect(within(leftPane).getByText("用户画像：已关闭" )).toBeInTheDocument();

  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));

  expect(within(leftPane).getByText("用户画像：已开启")).toBeInTheDocument();
  expect(within(leftPane).getByText("已阅读论文数：2")).toBeInTheDocument();
  expect(within(leftPane).getByText("学术人格：跨学科综述型" )).toBeInTheDocument();
  expect(within(leftPane).getByRole("button", { name: "学术档案" })).toBeInTheDocument();
  expect(within(leftPane).getByRole("button", { name: "清空用户画像（需鉴权）" })).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "个人中心" }));
  const leftPane = screen.getByLabelText("左边栏个人中心");
  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));
  await user.click(within(leftPane).getByRole("button", { name: "学术档案" }));

  const archiveDialog = screen.getByRole("dialog", { name: "学术档案页面" });
  expect(within(archiveDialog).getByText("学术档案" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("档案所有者：Liteasy Researcher" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("身份配置：性别 未设置 · 年龄 未设置 · 学段 未设置" )).toBeInTheDocument();
  expect(within(archiveDialog).getByText("阅读统计：已阅读 2 篇论文" )).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "连接开发云账号" }));
  await openOrganizationPanel(user);

  await waitFor(() => {
    expect(screen.getByText("组织空间：Liteasy AI Reading Lab")).toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "个人中心" }));
  const leftPane = screen.getByLabelText("左边栏个人中心");
  await user.click(within(leftPane).getByRole("button", { name: "开启用户画像" }));
  await user.click(within(leftPane).getByRole("button", { name: "清空用户画像（需鉴权）" }));

  const clearDialog = screen.getByRole("dialog", { name: "清空用户画像确认" });
  expect(within(clearDialog).getByText("清空用户画像确认" )).toBeInTheDocument();
  expect(within(clearDialog).getByText("将清空性别、年龄、学段、阅读统计和学术人格缓存；昵称、用户 ID 和头像会保留。" )).toBeInTheDocument();

  await user.click(within(clearDialog).getByRole("button", { name: "确认清空用户画像" }));

  expect(screen.queryByRole("dialog", { name: "清空用户画像确认" })).not.toBeInTheDocument();
  expect(within(leftPane).getByText("用户画像：已关闭")).toBeInTheDocument();
  expect(within(leftPane).getByText("用户画像已清空，基础身份信息已保留。" )).toBeInTheDocument();
}, 10000);

test("keeps the right pane as a minimal AI assistant and moves admin panels out", async () => {
  render(<AppShell />);

  await screen.findByText(/模型：云代理/);
  const rightPane = screen.getByLabelText("右栏AI助手");
  expect(within(rightPane).getByPlaceholderText("输入你的问题或命令")).toBeInTheDocument();
  expect(within(rightPane).queryByText("模型接入策略")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("文献元数据同步")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("组织空间")).not.toBeInTheDocument();
  expect(within(rightPane).queryByText("组织治理")).not.toBeInTheDocument();

  expect(screen.getByText(/模型：云代理/)).toBeInTheDocument();
});

test("opens settings from the activity bar and shows model policy details", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "设置" }));

  const settingsPane = screen.getByLabelText("左边栏设置");
  expect(within(settingsPane).getByText("设置")).toBeInTheDocument();
  expect(within(settingsPane).getByText("模型接入策略")).toBeInTheDocument();
  expect(within(settingsPane).getByRole("button", { name: "同步云端策略" })).toBeInTheDocument();
  expect(within(settingsPane).getByText("文献元数据同步")).toBeInTheDocument();
  expect(within(settingsPane).queryByText("组织空间")).not.toBeInTheDocument();
  expect(within(settingsPane).queryByText("组织治理")).not.toBeInTheDocument();
});

test("opens organization from the activity bar and keeps governance there", async () => {
  const user = userEvent.setup();

  render(<AppShell />);

  await user.click(screen.getByRole("button", { name: "组织" }));

  const organizationPane = screen.getByLabelText("左边栏组织");
  expect(within(organizationPane).getByText("组织")).toBeInTheDocument();
  expect(within(organizationPane).getByText("组织空间")).toBeInTheDocument();
  expect(within(organizationPane).getByText("组织治理")).toBeInTheDocument();
  expect(within(organizationPane).getByRole("button", { name: "打开组织窗口" })).toBeInTheDocument();
});


test("renders the activity bar separately from the library pane", async () => {
  render(<AppShell />);

  await screen.findByText(/模型：云代理/);
  const activityBar = screen.getByLabelText("左边栏导航");
  expect(within(activityBar).getByRole("button", { name: "文献库" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "组织" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "个人中心" })).toBeInTheDocument();
  expect(within(activityBar).getByRole("button", { name: "设置" })).toBeInTheDocument();

  expect(screen.getByText("我的文献库")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "关闭工作区" })).not.toBeInTheDocument();
});
