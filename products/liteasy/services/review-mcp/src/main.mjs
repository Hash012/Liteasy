import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDesktopRunner } from "./desktopRunner.mjs";
import { createReviewServer } from "./reviewServer.mjs";
import { createReviewHttpServer } from "./httpServer.mjs";

async function main() {
  const readDesktop = createDesktopRunner();
  if (process.argv.includes("--stdio")) {
    const server = createReviewServer(readDesktop);
    await server.connect(new StdioServerTransport());
    return;
  }
  const port = Number(process.env.LITEASY_REVIEW_PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid LITEASY_REVIEW_PORT");
  const tokenPath = process.env.LITEASY_REVIEW_TOKEN_FILE;
  if (!tokenPath) throw new Error("Set LITEASY_REVIEW_TOKEN_FILE to a private token file, or use --stdio with a trusted MCP tunnel.");
  const token = (await readFile(tokenPath, "utf8")).trim();
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`,
    ...(process.env.LITEASY_REVIEW_PUBLIC_HOSTS || "").split(",").map((host) => host.trim()).filter(Boolean)];
  const server = createReviewHttpServer({ token, allowedHosts, readDesktop });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.error(`Liteasy Review MCP: http://127.0.0.1:${port}/mcp (authenticated; keep Liteasy open)`);
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
