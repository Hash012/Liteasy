import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolveCliRuntimeConfig, resolveHost, resolvePort } from "./config.mjs";
import { createDevCloudRequestHandler } from "./requestHandler.mjs";

export { createDevCloudRequestHandler } from "./requestHandler.mjs";

export function createDevCloudServer(customConfig = {}) {
  return http.createServer(createDevCloudRequestHandler(customConfig));
}

async function startFromCli() {
  const port = resolvePort();
  const host = resolveHost();
  const { desktopOrigin, publicOrigin } = resolveCliRuntimeConfig();
  const server = createDevCloudServer({
    desktopOrigin,
    publicOrigin
  });

  server.listen(port, host, () => {
    console.log(`Liteasy dev cloud listening on http://${host}:${port}`);
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  void startFromCli();
}
