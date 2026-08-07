import fs from "node:fs";
import path from "node:path";

test("keeps the Tauri main window behind a restrictive CSP", () => {
  const config = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")
  ) as { app?: { security?: { csp?: string | null } } };
  const csp = config.app?.security?.csp;
  expect(typeof csp).toBe("string");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost https:");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("script-src 'unsafe-inline'");
  expect(csp).not.toContain("script-src 'unsafe-eval'");
});

test("allows the main window to receive host events without frontend emission", () => {
  const capability = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src-tauri/capabilities/main.json"), "utf8")
  );

  expect(capability.windows).toEqual(["main"]);
  expect(capability.permissions).toEqual([
    "core:event:allow-listen",
    "core:event:allow-unlisten"
  ]);
  expect(capability.permissions).not.toContain("core:event:allow-emit");
});
