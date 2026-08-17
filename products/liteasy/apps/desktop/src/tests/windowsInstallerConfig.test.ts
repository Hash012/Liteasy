import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("Windows installer configuration", () => {
  test("repairs existing current-user shortcuts with the runtime install directory", () => {
    const config = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "src-tauri/tauri.conf.json"
    ), "utf8"));
    const nsis = config.bundle.windows.nsis;

    expect(nsis.installMode).toBe("currentUser");
    expect(nsis.installerHooks).toBe("windows/installer-hooks.nsh");

    const hooks = readFileSync(resolve(
      process.cwd(),
      "src-tauri/windows/installer-hooks.nsh"
    ), "utf8");
    expect(hooks).toContain("NSIS_HOOK_POSTINSTALL");
    expect(hooks).toContain('$SMPROGRAMS\\${PRODUCTNAME}.lnk');
    expect(hooks).toContain('$DESKTOP\\${PRODUCTNAME}.lnk');
    expect(hooks.match(/\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe/g)).toHaveLength(2);
    expect(hooks).not.toMatch(/[A-Z]:\\Users\\/i);
  });
});
