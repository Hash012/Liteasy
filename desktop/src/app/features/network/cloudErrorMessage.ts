const browserFetchFailureMessages = new Set([
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "Load failed"
]);

export function formatCloudConnectionError(error: unknown) {
  if (error instanceof Error && browserFetchFailureMessages.has(error.message)) {
    return "无法连接开发云服务。请确认已启动 http://127.0.0.1:8787，并检查设置里的控制平面端点。";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}
