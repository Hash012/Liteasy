import { expect, test, vi } from "vitest";
import { collectClientDiagnostics } from "../../scripts/client-doctor.mjs";
test("doctor reports missing native dependencies without reading credentials or attempting installation", () => {
  const run = vi.fn(() => ({ ok: false, output: "" }));
  const result = collectClientDiagnostics({ os: "linux", cpu: "x64", kernel: "microsoft-WSL2", run });
  expect(result).toMatchObject({ wsl: true, nativeVerified: false, credentialsRead: false, automaticallyInstalled: false });
  expect(result.checks.find(check => check.id === "webkit2gtk-4.1").status).toBe("unavailable");
  expect(run.mock.calls.some(([command]) => /install|apt|brew|npm/.test(command))).toBe(false);
  expect(run.mock.calls.find(([command]) => command === "gdbus")?.[1]).toContain("introspect");
});
test("Windows probes use argument arrays and never spawn an npm.cmd shell", () => {
  const run = vi.fn(() => ({ ok: true, output: "native version" }));
  const result = collectClientDiagnostics({ os: "win32", cpu: "x64", kernel: "windows", run });
  expect(result.nativeVerified).toBe(false);
  expect(run.mock.calls.some(([command]) => command.endsWith(".cmd"))).toBe(false);
  expect(run.mock.calls.find(([command]) => command === "powershell.exe")?.[1]).toContain("-NoProfile");
});
