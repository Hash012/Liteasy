import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { InferenceProvider, InferenceTerminal, InferenceRequest } from "./inferenceProvider";

export type ChatgptPlanAccount = { id: string; name: string; email: string; clientId: string; planUsageEnabled: boolean; inferenceVerified: boolean };
export type ChatgptPlanAccounts = { activeAccount: string | null; accounts: ChatgptPlanAccount[] };
export type ChatgptPlanModel = { slug: string; displayName: string };
export function createChatgptPlanClient(scope: string, active: () => boolean) {
  const check = () => {
    if (!active()) throw new Error("账号已变化，请重新选择模型连接。");
    if (!isTauri()) throw new Error("ChatGPT 订阅授权需要桌面应用。");
  };
  const call = async <T>(name: string, args: Record<string, unknown> = {}) => {
    check(); const value = await invoke<T>(name, { scope, ...args }); check(); return value;
  };
  return {
    accounts: () => call<ChatgptPlanAccounts>("chatgpt_plan_accounts"),
    login: (accountId: string | null = null) => call<ChatgptPlanAccount>("chatgpt_plan_login", { accountId }),
    select: (accountId: string) => call<void>("chatgpt_plan_select", { accountId }),
    logout: (accountId: string) => call<void>("chatgpt_plan_logout", { accountId }),
    models: (accountId: string) => call<ChatgptPlanModel[]>("chatgpt_plan_models", { accountId }),
    cancel: () => invoke<void>("chatgpt_plan_cancel"),
    provider(accountId: string): InferenceProvider {
      return {
        providerId: "chatgpt_plan",
        async infer(input: InferenceRequest) {
          check(); input.signal?.throwIfAborted();
          const chunks = new Channel<string>();
          chunks.onmessage = value => { if (active() && !input.signal?.aborted) input.onDelta?.(value); };
          const cancel = () => { void invoke("chatgpt_plan_cancel").catch(() => undefined); };
          input.signal?.addEventListener("abort", cancel, { once: true });
          try {
            const receipt = await invoke<InferenceTerminal>("chatgpt_plan_infer", {
              request: { scope, accountId, model: input.model, input: input.messages, tools: input.tools ?? [] }, chunks,
            });
            check(); input.signal?.throwIfAborted();
            if (receipt.status !== "completed") throw new Error("模型流未成功完成。");
            return receipt;
          } finally { input.signal?.removeEventListener("abort", cancel); }
        },
      };
    },
  };
}
