import { createServer } from "node:net";

export function resolveRequestedCloudHost(env = process.env) {
  return env.LITEASY_DEV_CLOUD_HOST ?? "127.0.0.1";
}

export function resolveRequestedDesktopHost(env = process.env) {
  return env.LITEASY_DESKTOP_HOST ?? "127.0.0.1";
}

export function resolveRequestedCloudPort(env = process.env) {
  const parsed = Number(env.LITEASY_DEV_CLOUD_PORT ?? "8787");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8787;
}

export function resolveRequestedDesktopPort(env = process.env) {
  const parsed = Number(env.LITEASY_DESKTOP_PORT ?? "1420");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1420;
}

function getPublicHost(host, env = process.env) {
  if (typeof env.LITEASY_PUBLIC_HOST === "string" && env.LITEASY_PUBLIC_HOST.length > 0) {
    return env.LITEASY_PUBLIC_HOST;
  }

  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.listen(port, host, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

export async function findAvailablePort(startPort, host) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await canListen(port, host)) {
      return port;
    }
  }

  throw new Error(`No available Liteasy dev cloud port found from ${startPort} to ${startPort + 49}`);
}

export function buildChildEnv({ baseEnv = process.env, host, port, publicHost }) {
  const resolvedPublicHost = publicHost ?? getPublicHost(host, baseEnv);

  return {
    ...baseEnv,
    LITEASY_DEV_CLOUD_HOST: host,
    LITEASY_DEV_CLOUD_PORT: String(port),
    LITEASY_DEV_CLOUD_PUBLIC_ORIGIN: `http://${resolvedPublicHost}:${port}`,
    VITE_LITEASY_DEV_CLOUD_PORT: String(port)
  };
}

export function buildDesktopViteArgs({ host, port }) {
  return ["vite", "--host", host, "--port", String(port)];
}
