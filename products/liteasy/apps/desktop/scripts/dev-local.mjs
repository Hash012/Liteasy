import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createLocalClientProfile, desktopDir, localClientEnvironment } from "./localClientProfile.mjs";

const args = process.argv.slice(2);
const frontend = args.includes("--frontend");
const profileIndex = args.indexOf("--profile");
if (profileIndex >= 0 && !args[profileIndex + 1]) throw new Error("--profile requires a path to an empty or marked development directory.");
if (args.some((arg, i) => !["--frontend", "--profile", "--prepare"].includes(arg) && !(profileIndex >= 0 && i === profileIndex + 1))) throw new Error("Usage: npm run dev:local -- [--profile <directory>] [--prepare]");
const profile = frontend ? { root: process.env.LITEASY_LOCAL_DEV_PROFILE } : await createLocalClientProfile(profileIndex >= 0 ? args[profileIndex + 1] : undefined);
if (!profile.root) throw new Error("Start the frontend through npm run dev:local so a temporary profile is allocated.");
if (!frontend) console.log(JSON.stringify({ profile: profile.root, fixtureDirectory: resolve(profile.root, "fixtures"), persistence: "isolated development profile; retained on exit" }));
if (!args.includes("--prepare")) {
  // Invoke JS entrypoints with Node: never shell-expand a path or spawn npm.cmd on Windows.
  const command = frontend ? [resolve(desktopDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "1420", "--strictPort", "--mode", "local-only"]
    : [resolve(desktopDir, "node_modules/@tauri-apps/cli/tauri.js"), "dev", "--config", profile.configPath];
  const ownGroup = !frontend && process.platform !== "win32";
  const child = spawn(process.execPath, command, { cwd: desktopDir, env: localClientEnvironment(process.env, profile.root), stdio: "inherit", shell: false, detached: ownGroup });
  let stopped = false;
  const stop = () => {
    if (stopped || !child.pid) return;
    stopped = true;
    try {
      if (process.platform === "win32" && !frontend) execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else if (ownGroup) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch (error) { if (error.code !== "ESRCH") console.error("Development child already exited; verify no dev server remains."); }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  child.once("error", error => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { stop(); process.exitCode = code ?? (signal ? 1 : 0); });
}
