import type { RpcResult } from "./types";

export async function rpc<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...args }) as RpcResult<T>;
  if (!result?.ok) throw new Error(result?.error || "扩展后台未响应，请重新加载扩展。");
  return result.data;
}
