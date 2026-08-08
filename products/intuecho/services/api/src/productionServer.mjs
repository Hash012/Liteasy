import { fileURLToPath } from "node:url";
import { createProductionIntuechoApp } from "./productionApp.mjs";
import { loadIntuechoProductionConfig } from "./productionConfig.mjs";
import { startIntuechoProductionRuntime } from "./productionRuntime.mjs";

export async function startIntuechoProductionServer(config = loadIntuechoProductionConfig()) {
  const runtime = await startIntuechoProductionRuntime(config);
  const app = await createProductionIntuechoApp(runtime, config, { logger: true });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close().catch(() => undefined);
    await runtime.pool.end();
    throw error;
  }
  const shutdown = async () => {
    await app.close();
    await runtime.pool.end();
  };
  return { app, runtime, shutdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startIntuechoProductionServer();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void server.shutdown().finally(() => process.exit(0));
    });
  }
}
