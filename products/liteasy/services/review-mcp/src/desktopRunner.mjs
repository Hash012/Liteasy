import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function desktopSocketPath(env = process.env, platform = process.platform) {
  if (env.LITEASY_AGENT_SOCKET) return env.LITEASY_AGENT_SOCKET;
  if (platform === "win32") throw new Error("Liteasy 评论连接目前支持 Linux/macOS；Windows 桌面传输尚未实现。");
  return platform === "darwin"
    ? join(homedir(), "Library/Application Support/com.liteasy.desktop/agent.sock")
    : join(env.XDG_DATA_HOME || join(homedir(), ".local/share"), "com.liteasy.desktop/agent.sock");
}

/** No generic Agent, filesystem or command forwarding is exposed to the MCP client. */
export function createDesktopRunner({ socketPath = desktopSocketPath(), timeoutMs = 10_000 } = {}) {
  return (payload, { signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("review_cancelled")); return; }
    const socket = connect(socketPath);
    let buffer = "";
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error("review_cancelled"));
    const timer = setTimeout(() => finish(new Error("desktop_timeout: 请确认 Liteasy 已打开并开启评论共享。")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({
      kind: "paper_review", payload, request_id: randomUUID(),
    })}\n`));
    socket.on("data", (data) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 512_000) { finish(new Error("desktop_response_too_large")); return; }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, end));
        if (response.ok !== true) {
          // Only the bounded review-domain error is sent back; never log source material.
          finish(new Error(String(response.error || "desktop_review_failed").slice(0, 500)));
        } else if (!response.value || typeof response.value !== "object" || Array.isArray(response.value)) {
          finish(new Error("invalid_desktop_response"));
        } else finish(null, response.value);
      } catch { finish(new Error("invalid_desktop_response")); }
    });
    socket.once("error", () => finish(new Error("desktop_unavailable: 请启动同一用户下的 Liteasy 桌面端。")));
    socket.once("end", () => finish(new Error("desktop_disconnected")));
  });
}
