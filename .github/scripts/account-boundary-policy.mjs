import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const clients = ["desktop", "admin", "mobile"];
const desktopBoundary = /(?:account|session|auth|identity|cloud|community|forum|publication|organization|transfer|provenance|source|resourceReference|operation|space|permission|personalCenter|capability|policy|agent|local-mcp|workflow|features\/objects\/)/i;

// Paths are data, never shell fragments. Shared contracts and authority changes
// exercise every client; a Desktop-only sharing change still exercises real PG.
export function requiredAccountSuites(paths, { all = false } = {}) {
  const chosen = new Set();
  let services = all;
  if (all) clients.forEach((client) => chosen.add(client));
  for (const file of paths) {
    if (/^(?:products\/liteasy\/(?:services\/api|packages\/shared)|products\/intuecho|platform\/identity-service|deployment\/local|\.github\/(?:scripts\/account-|scripts\/run-account-|workflows\/account-cloud-community))\//.test(file)
      || /^\.github\/(?:scripts\/(?:account-|run-account-)|workflows\/account-cloud-community)/.test(file)) {
      services = true;
      clients.forEach((client) => chosen.add(client));
    }
    const match = /^products\/liteasy\/apps\/(desktop|admin|mobile)\/(.*)$/.exec(file);
    if (!match) continue;
    const [, client, relative] = match;
    if (client !== "desktop" || desktopBoundary.test(relative) || /(?:package(?:-lock)?\.json|\.nvmrc|tsconfig|vitest)/.test(relative)) {
      services = true;
      chosen.add(client);
    }
  }
  return { services, clients: clients.filter((client) => chosen.has(client)) };
}

export function assertAccountGate(policy, results) {
  for (const [job, needed] of [["policy", true], ["isolated-services", policy.services], ["client-contracts", policy.clients.length > 0]]) {
    const status = results?.[job]?.result;
    if (needed ? status !== "success" : !["success", "skipped"].includes(status)) {
      throw new Error(`Required account boundary job did not succeed: ${job}`);
    }
  }
}

function main() {
  if (process.argv.includes("--gate")) {
    assertAccountGate(JSON.parse(process.env.ACCOUNT_POLICY), JSON.parse(process.env.CI_RESULTS));
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const base = event.pull_request?.base?.sha ?? event.before;
  let paths = [];
  let all = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || !/^[a-f0-9]{40}$/.test(base ?? "") || /^0+$/.test(base);
  if (!all) {
    try { paths = execFileSync("git", ["diff", "--name-only", "-z", base, "HEAD"], { encoding: "utf8" }).split("\0").filter(Boolean); }
    catch { all = true; }
  }
  const policy = requiredAccountSuites(paths, { all });
  appendFileSync(process.env.GITHUB_OUTPUT, `services=${policy.services}\nclients=${JSON.stringify(policy.clients)}\nclients-enabled=${policy.clients.length > 0}\npolicy=${JSON.stringify(policy)}\n`);
  console.log(JSON.stringify(policy));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
