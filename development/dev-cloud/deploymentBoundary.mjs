const allowedRuntimeEnvironments = new Set(["development", "test"]);

function normalizeEnvironment(value, fallback = "development") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || fallback;
}

export function assertDevCloudDeploymentBoundary({
  nodeEnvironment = process.env.NODE_ENV,
  requestedEnvironment
} = {}) {
  const runtime = normalizeEnvironment(nodeEnvironment);
  const requested = normalizeEnvironment(requestedEnvironment, runtime);
  if (!allowedRuntimeEnvironments.has(runtime) || !allowedRuntimeEnvironments.has(requested)) {
    throw new Error(
      "dev_cloud_nonproduction_only: Liteasy dev-cloud uses SQLite and local object storage " +
      "and cannot run as a staging or production service."
    );
  }
  return { requestedEnvironment: requested, runtimeEnvironment: runtime };
}
