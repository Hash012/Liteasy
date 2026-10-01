import { invoke, isTauri } from "@tauri-apps/api/core";

export function externalHttpUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("网站地址无效。");
  return url.href;
}

export const ExternalNavigation = {
  async open(value: string): Promise<void> {
    const url = externalHttpUrl(value);
    if (isTauri()) {
      try { await invoke("open_external_url", { url }); }
      catch { throw new Error("无法启动系统浏览器，请复制链接后打开。"); }
    } else {
      const tab = window.open(url, "_blank");
      if (!tab) throw new Error("浏览器拦截了新窗口，请允许弹出窗口或复制链接。");
      tab.opener = null;
    }
  },
};
