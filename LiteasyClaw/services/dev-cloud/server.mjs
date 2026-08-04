import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  buildPublicRuntimeSummary,
  defaultConfig,
  resolveCliRuntimeConfig,
  resolveHost,
  resolvePort
} from "./config.mjs";
import { createDevCloudRequestHandler } from "./requestHandler.mjs";

export { createDevCloudRequestHandler } from "./requestHandler.mjs";

export function createDevCloudServer(customConfig = {}) {
  return http.createServer(createDevCloudRequestHandler(customConfig));
}

async function startFromCli() {
  const port = resolvePort();
  const host = resolveHost();
  const startedAt = new Date().toISOString();
  const { allowedOrigins, desktopOrigin, publicOrigin } = resolveCliRuntimeConfig();
  const serverConfig = {
    allowedOrigins,
    arxivEnabled: true,
    desktopOrigin,
    publicOrigin,
    runtimeStartedAt: startedAt
  };
  const runtimeSummary = buildPublicRuntimeSummary(
    { ...defaultConfig, ...serverConfig },
    { startedAt }
  );
  const server = createDevCloudServer(serverConfig);

  server.listen(port, host, () => {
    console.log(`LiteasyClaw dev cloud listening on http://${host}:${port}`);
    console.log(`[dev-cloud] runtime ${JSON.stringify(runtimeSummary)}`);
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  void startFromCli();
}
