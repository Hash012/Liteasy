import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import "../../../packages/context-skills/generate.mjs";

const dist = new URL("../dist/", import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL("../src/", import.meta.url), dist, { recursive: true, filter: (path) => !path.endsWith(".test.mjs") });
mkdirSync(new URL("sdk/", dist));
cpSync(new URL("../../../packages/context-client/src/index.mjs", import.meta.url), new URL("sdk/index.mjs", dist));
writeFileSync(new URL("sdk.mjs", dist), 'export * from "./sdk/index.mjs";\n');
cpSync(new URL("../../../packages/context-skills/", import.meta.url), new URL("skills-package/", dist), { recursive: true, filter: (path) => !path.endsWith("generate.mjs") });
writeFileSync(new URL("skillAssets.mjs", dist), 'export const skillPackageRoot = new URL("./skills-package/", import.meta.url);\n');
chmodSync(new URL("main.mjs", dist), 0o755);
// Fail packaging if the source entry no longer declares the executable version.
if (!readFileSync(new URL("main.mjs", dist), "utf8").startsWith("#!/usr/bin/env node\n")) throw new Error("cli_shebang_missing");
