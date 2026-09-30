import { z } from "zod";
import type { ObjectStorage } from "../objects/objectStorage";
import { createBlockRegistry } from "../visual-blocks/blockRegistry";
import { validateExtensionPackage, type ValidatedExtension } from "./extensionPackage";

const installationSchema = z.strictObject({ schema: z.literal("liteasy.extension-installation/v1"), id: z.string(), version: z.string(), digest: z.string(), enabled: z.boolean(), installedAt: z.string(), error: z.string().optional() });
export type ExtensionInstallation = z.infer<typeof installationSchema> & { revision: string };
export function createExtensionPackageStore(storage: ObjectStorage) {
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const stateKey = (id: string) => `extension-installation/${encodeURIComponent(id)}`;
  const packageKey = (id: string, version: string) => `extension-package/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
  async function list(): Promise<ExtensionInstallation[]> {
    return (await storage.list("extension-installation/", "", 200)).flatMap((row) => {
      const parsed = installationSchema.safeParse(row.value);
      return parsed.success ? [{ ...parsed.data, revision: row.version }] : [];
    });
  }
  async function get(id: string, version: string): Promise<ValidatedExtension> {
    const row = await storage.get(packageKey(id, version));
    if (!row) throw new Error("扩展包不存在，请重新导入。");
    const result = await validateExtensionPackage(row.value);
    if (result.manifest.id !== id || result.manifest.version !== version) throw new Error("扩展包身份不匹配。");
    return result;
  }
  async function active() {
    const enabled = (await list()).filter((item) => item.enabled);
    if (enabled.length > 16) throw new Error("同时启用的扩展不能超过 16 个。");
    const packages: ValidatedExtension[] = [];
    const failures: Array<{ id: string; message: string }> = [];
    let bytes = 0;
    for (const item of enabled) {
      try {
        const pkg = await get(item.id, item.version);
        if (pkg.digest !== item.digest) throw new Error("已启用版本的摘要不一致。");
        bytes += JSON.stringify(pkg.bundle).length;
        if (bytes > 48 * 1024 * 1024) throw new Error("已启用扩展超过内存加载预算。");
        packages.push(pkg);
      } catch (error) { failures.push({ id: item.id, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { packages, failures, registry: createBlockRegistry(packages.flatMap((pkg) => pkg.blocks)) };
  }
  return {
    list, get, active,
    async versions(id: string) { return (await storage.list(`extension-package/${encodeURIComponent(id)}/`, "", 200)).map((row) => decodeURIComponent(row.key.split("/").at(-1)!)); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async install(input: unknown, expectedRevision: string | null = null) {
      const pkg = await validateExtensionPackage(input);
      const { id, version } = pkg.manifest;
      const key = stateKey(id), previous = await storage.get(key);
      if ((previous?.version ?? null) !== expectedRevision) throw new Error("扩展安装状态已变化，请刷新后重试。");
      const immutable = await storage.get(packageKey(id, version));
      if (immutable && (await validateExtensionPackage(immutable.value)).digest !== pkg.digest) throw new Error("同一版本的包内容不能改变，请增加版本号。");
      const value = installationSchema.parse({ schema: "liteasy.extension-installation/v1", id, version, digest: pkg.digest, enabled: false, installedAt: new Date().toISOString() });
      await storage.commit([
        ...(immutable ? [] : [{ key: packageKey(id, version), expected: null, row: { key: packageKey(id, version), version: pkg.digest, value: pkg.bundle } }]),
        { key, expected: expectedRevision, row: { key, version: crypto.randomUUID(), value } },
      ]);
      changed();
      return pkg;
    },
    async enable(id: string, enabled: boolean, expectedRevision: string) {
      const key = stateKey(id), row = await storage.get(key);
      if (!row || row.version !== expectedRevision) throw new Error("扩展状态已变化。");
      const previous = installationSchema.parse(row.value);
      if (enabled) {
        const pkg = await get(id, previous.version);
        if (pkg.digest !== previous.digest) throw new Error("扩展摘要不符。");
        const current = await active();
        if (!previous.enabled && current.packages.length >= 16) throw new Error("同时启用的扩展不能超过 16 个。");
        createBlockRegistry([...current.packages.filter((item) => item.manifest.id !== id).flatMap((item) => item.blocks), ...pkg.blocks]);
      }
      await storage.commit([{ key, expected: row.version, row: { key, version: crypto.randomUUID(), value: { ...previous, enabled } } }]);
      changed();
    },
    async uninstall(id: string, expectedRevision: string) {
      // Content, packages pinned by old runs, and settings remain available for export/recovery.
      await storage.commit([{ key: stateKey(id), expected: expectedRevision, row: null }]);
      changed();
    },
    async rollback(id: string, version: string, expectedRevision: string) { const previous = await get(id, version); return this.install(previous.bundle, expectedRevision); },
    async disableAll() {
      for (const item of await list()) if (item.enabled) await this.enable(item.id, false, item.revision);
    },
  };
}
export type ExtensionPackageStore = ReturnType<typeof createExtensionPackageStore>;
