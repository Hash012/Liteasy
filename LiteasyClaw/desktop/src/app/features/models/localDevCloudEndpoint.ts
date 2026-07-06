const FALLBACK_DEV_CLOUD_PORT = "8787";

type BrowserLocationLike = {
  hostname: string;
  port?: string;
  protocol: string;
};

type DevCloudEnvLike = {
  VITE_LITEASY_DEV_CLOUD_PORT?: string;
};

function hasHttpProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

function normalizeHostname(hostname: string) {
  if (hostname === "::1" || hostname === "localhost") {
    return "127.0.0.1";
  }

  return hostname;
}

function isLocalHostname(hostname: string) {
  return normalizeHostname(hostname) === "127.0.0.1";
}

function isDesktopDevPort(port: string | undefined) {
  if (!port) {
    return false;
  }

  const parsed = Number(port);
  return Number.isFinite(parsed) && parsed >= 1420 && parsed <= 1469;
}

export function resolveLocalDevCloudEndpoint(
  locationLike: BrowserLocationLike | undefined =
    typeof window === "undefined" ? undefined : window.location,
  envLike: DevCloudEnvLike = import.meta.env
) {
  const devCloudPort =
    typeof envLike.VITE_LITEASY_DEV_CLOUD_PORT === "string" &&
    envLike.VITE_LITEASY_DEV_CLOUD_PORT.length > 0
      ? envLike.VITE_LITEASY_DEV_CLOUD_PORT
      : FALLBACK_DEV_CLOUD_PORT;
  const loopbackEndpoint = `http://127.0.0.1:${devCloudPort}`;

  if (!locationLike) {
    return loopbackEndpoint;
  }

  const hostname = normalizeHostname(locationLike.hostname);
  if (hostname.length === 0 || !hasHttpProtocol(locationLike.protocol)) {
    return loopbackEndpoint;
  }

  return `${locationLike.protocol}//${hostname}:${devCloudPort}`;
}

export function hasInjectedLocalDevCloudEndpoint(envLike: DevCloudEnvLike = import.meta.env) {
  return (
    typeof envLike.VITE_LITEASY_DEV_CLOUD_PORT === "string" &&
    envLike.VITE_LITEASY_DEV_CLOUD_PORT.length > 0
  );
}

export function shouldApplyLocalDevCloudDefaults(
  locationLike: BrowserLocationLike | undefined =
    typeof window === "undefined" ? undefined : window.location,
  envLike: DevCloudEnvLike = import.meta.env
) {
  if (hasInjectedLocalDevCloudEndpoint(envLike)) {
    return true;
  }

  if (!locationLike || !hasHttpProtocol(locationLike.protocol)) {
    return false;
  }

  return isLocalHostname(locationLike.hostname) && isDesktopDevPort(locationLike.port);
}

export type { DevCloudEnvLike };
