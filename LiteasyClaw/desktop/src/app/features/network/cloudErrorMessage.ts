const browserFetchFailureMessages = new Set([
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "Load failed"
]);

type CloudConnectionErrorOptions = {
  controlPlaneEndpoint?: string;
};

export function formatCloudConnectionError(error: unknown, options: CloudConnectionErrorOptions = {}) {
  if (error instanceof Error && browserFetchFailureMessages.has(error.message)) {
    if (
      typeof options.controlPlaneEndpoint === "string" &&
      options.controlPlaneEndpoint.length > 0
    ) {
      return `云端服务当前不可用。请确认服务已启动，并检查当前云端地址：${options.controlPlaneEndpoint}。`;
    }

    return "云端服务当前不可用。请确认已启动 http://127.0.0.1:8787，并检查当前云端地址。";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}
