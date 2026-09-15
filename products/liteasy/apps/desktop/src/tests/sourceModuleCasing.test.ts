import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, test } from "vitest";

test("source module names remain unambiguous on case-insensitive file systems", () => {
  const sourceRoot = resolve(process.cwd(), "src");
  const modules = new Map<string, string[]>();
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(path);
      } else if (/\.[cm]?[jt]sx?$/i.test(entry.name) && !/\.d\.[cm]?ts$/i.test(entry.name)) {
        const sourcePath = relative(sourceRoot, path).replaceAll("\\", "/");
        // Windows extensionless imports can resolve Foo.tsx to foo.ts first.
        const moduleName = sourcePath.replace(/\.[cm]?[jt]sx?$/i, "").toLowerCase();
        modules.set(moduleName, [...(modules.get(moduleName) ?? []), sourcePath]);
      }
    }
  };
  scan(sourceRoot);
  const collisions = [...modules.values()].filter((paths) => paths.length > 1);
  expect(collisions, "Use distinct module names, including across .ts and .tsx extensions.").toEqual([]);
});
