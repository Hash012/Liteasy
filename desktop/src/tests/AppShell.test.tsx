import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "../app/layout/AppShell";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

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

  await user.click(screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" }));
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
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

  const localToggle = screen.getByRole("checkbox", { name: "允许本地直连（模拟云端策略）" });
  await user.click(localToggle);
  await user.click(screen.getByRole("button", { name: "使用本地直连" }));
  await user.click(localToggle);

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

  expect(screen.getByText(/当前通道：本地直连/)).toBeInTheDocument();

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

  await waitFor(() => {
    expect(screen.getByText(/当前通道：云代理/)).toBeInTheDocument();
  });

  expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
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

  await waitFor(() => {
    expect(screen.getByText("同步状态：失败")).toBeInTheDocument();
  });

  expect(screen.getByText(/云端策略同步失败/)).toBeInTheDocument();
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

  await waitFor(() => {
    expect(screen.getByText("最近执行：云代理 -> 开发云 -> OpenAI")).toBeInTheDocument();
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

  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });

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

  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });

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

  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });

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

test("drags a recommendation into online collection and restores it on next render", async () => {
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

  await waitFor(() => {
    expect(screen.getByText("同步状态：已同步")).toBeInTheDocument();
  });

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
