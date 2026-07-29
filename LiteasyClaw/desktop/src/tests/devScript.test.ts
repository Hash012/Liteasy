import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildChildEnv,
  buildDesktopViteArgs,
  findAvailablePort,
  resolveRequestedDesktopHost,
  resolveRequestedDesktopPort
} from "../../scripts/devPorts.mjs";

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolveClose();
    });
  });
}

describe("desktop dev script", () => {
  test("starts the desktop frontend and Liteasy dev cloud together", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.dev).toContain("dev:cloud");
    expect(packageJson.scripts.dev).toContain("dev:desktop");
    expect(packageJson.scripts["dev:cloud"]).toContain("services/dev-cloud/server.mjs");
    expect(packageJson.scripts["dev:desktop"]).toContain("vite --host 127.0.0.1 --port 1420");
  });

  test("finds a fallback cloud port and injects it into both child processes", async () => {
    const blocker = createServer();
    await listen(blocker, 0, "127.0.0.1");

    try {
      const address = blocker.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Expected the blocker server to use a TCP address");
      }

      const port = await findAvailablePort(address.port, "127.0.0.1");
      const env = buildChildEnv({
        baseEnv: {},
        host: "127.0.0.1",
        port
      });

      expect(port).toBeGreaterThan(address.port);
      expect(env.LITEASY_DEV_CLOUD_HOST).toBe("127.0.0.1");
      expect(env.LITEASY_DEV_CLOUD_PORT).toBe(String(port));
      expect(env.LITEASY_DEV_CLOUD_PUBLIC_ORIGIN).toBe(`http://127.0.0.1:${port}`);
      expect(env.VITE_LITEASY_DEV_CLOUD_PORT).toBe(String(port));
    } finally {
      await close(blocker);
    }
  });

  test("does not override the dev cloud env file path by default", () => {
    const env = buildChildEnv({
      baseEnv: {},
      host: "127.0.0.1",
      port: 8787
    });
    const envWithExplicitSecretFile = buildChildEnv({
      baseEnv: {
        LITEASY_DEV_CLOUD_ENV_FILE: "/tmp/liteasy-dev-cloud.env"
      },
      host: "127.0.0.1",
      port: 8787
    });

    expect(env.LITEASY_DEV_CLOUD_ENV_FILE).toBeUndefined();
    expect(envWithExplicitSecretFile.LITEASY_DEV_CLOUD_ENV_FILE).toBe(
      "/tmp/liteasy-dev-cloud.env"
    );
  });

  test("can expose the frontend and dev cloud for Windows browser access", () => {
    const desktopHost = resolveRequestedDesktopHost({
      LITEASY_DESKTOP_HOST: "0.0.0.0"
    });
    const desktopPort = resolveRequestedDesktopPort({
      LITEASY_DESKTOP_PORT: "1425"
    });
    const env = buildChildEnv({
      baseEnv: {},
      host: "0.0.0.0",
      port: 8790,
      publicHost: "10.77.110.167"
    });

    expect(desktopHost).toBe("0.0.0.0");
    expect(desktopPort).toBe(1425);
    expect(buildDesktopViteArgs({ host: desktopHost, port: desktopPort })).toEqual([
      "vite",
      "--host",
      "0.0.0.0",
      "--port",
      "1425"
    ]);
    expect(env.LITEASY_DEV_CLOUD_HOST).toBe("0.0.0.0");
    expect(env.LITEASY_DEV_CLOUD_PUBLIC_ORIGIN).toBe("http://10.77.110.167:8790");
  });

  test("maps test-api credentials into the live dev-test-api launcher", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts/dev-with-test-api.mjs"),
      "utf8"
    );

    expect(script).toContain('readField(content, "OPENAI_KEY")');
    expect(script).toContain('readField(content, "API_END_POINT")');
    expect(script).toContain("OPENAI_API_KEY: apiKey");
    expect(script).toContain("OPENAI_BASE_URL: apiEndpoint");
    expect(script).toContain('VITE_LITEASY_OPENAI_MODEL:\n      process.env.VITE_LITEASY_OPENAI_MODEL ?? "gpt-5.4-mini"');
  });
});
