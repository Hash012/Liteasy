import { z } from "zod";
import type { ObjectStorage } from "../objects/objectStorage";
import { boundedJson } from "../extensions/extensionSchema";
import { buildExtensionPackage, validateExtensionPackage } from "../extensions/extensionPackage";
import type { ExtensionPackageStore } from "../extensions/extensionPackageStore";
import { hashText } from "../context/objectContext";
const draftSchema = z.strictObject({ schema: z.literal("liteasy.extension-draft/v1"), id: z.string(), title: z.string().max(120), description: z.string().max(12000), files: z.record(z.string(), z.string()), sourcePaths: z.array(z.string()).optional(), updatedAt: z.string(), revision: z.string(),
  source: z.enum(["user", "ai", "restore"]).optional(), restoredFrom: z.string().optional(),
  base: z.strictObject({ id: z.string(), version: z.string(), digest: z.string(), installationRevision: z.string() }).optional(),
});
export type ExtensionDraft = z.infer<typeof draftSchema>;
export type DraftChange = { path: string; text: string | null };
export type TrialReport = { schema: "liteasy.extension-trial/v1"; digest: string; at: string; cases: Array<{ name: string; workflow: string; passed: boolean; runId?: string; error?: string }>; passed: boolean };
export function createExtensionDraftStore(storage: ObjectStorage) {
  const listeners = new Set<() => void>();
  async function get(id: string) { const row = await storage.get(`extension-draft/${id}`); if (!row) throw new Error("草稿不存在。"); return draftSchema.parse(row.value); }
  async function revision(id: string, revision: string) {
    const current = await get(id);
    if (current.revision === revision) return current;
    const row = await storage.get(`extension-draft-history/${id}/${revision}`);
    if (!row) throw new Error("找不到这次修改的历史记录。");
    return draftSchema.parse(row.value);
  }
  async function save(current: ExtensionDraft, next: ExtensionDraft) {
    const key = `extension-draft/${current.id}`, backup = `extension-draft-history/${current.id}/${current.revision}`;
    await storage.commit([{ key: backup, expected: null, row: { key: backup, version: current.revision, value: current } }, { key, expected: current.revision, row: { key, version: next.revision, value: next } }]);
    notify(); return next;
  }
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get, revision,
    async history(id: string) {
      const summary = ({ revision, updatedAt, source, restoredFrom }: ExtensionDraft) => ({ revision, updatedAt, source, restoredFrom });
      const entries = [summary(await get(id))];
      let after = "";
      for (;;) {
        const rows = await storage.list(`extension-draft-history/${id}/`, after, 10);
        entries.push(...rows.map(row => summary(draftSchema.parse(row.value))));
        if (rows.length < 10) break;
        after = rows.at(-1)!.key;
      }
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async list() { return (await storage.list("extension-draft/", "", 100)).flatMap((row) => { const value = draftSchema.safeParse(row.value); return value.success ? [value.data] : []; }); },
    async create(title: string, files: Record<string, string>, description = "", sourcePaths: string[] | null = [], base?: ExtensionDraft["base"]) {
      files = { ...files }; delete files["extension.lock.json"]; delete files["tests/report.json"];
      boundedJson(files, 24 * 1024 * 1024); await buildExtensionPackage(files); // safe relative paths even in unfinished drafts
      const draft = draftSchema.parse({ schema: "liteasy.extension-draft/v1", id: crypto.randomUUID(), title, description, files, sourcePaths: sourcePaths ?? undefined, base, source: "user", updatedAt: new Date().toISOString(), revision: crypto.randomUUID() });
      const key = `extension-draft/${draft.id}`;
      await storage.commit([{ key, expected: null, row: { key, version: draft.revision, value: draft } }]); notify(); return draft;
    },
    async fork(packages: ExtensionPackageStore, id: string, version: string) {
      const state = (await packages.list()).find(item => item.id === id);
      const pkg = await packages.get(id, version);
      if (!state || state.version !== version || state.digest !== pkg.digest) throw new Error("扩展版本已变化，请重新选择要修复的版本。");
      const files = { ...pkg.bundle.files }, manifest = { ...pkg.manifest };
      const parts = version.split(".");
      const prefix = `${parts[0]}.${parts[1]}.`;
      const used = (await packages.versions(id)).filter(item => item.startsWith(prefix)).map(item => Number.parseInt(item.slice(prefix.length), 10)).filter(Number.isFinite);
      manifest.version = `${prefix}${Math.max(Number.parseInt(parts[2], 10), ...used) + 1}`;
      files["liteasy.extension.json"] = JSON.stringify(manifest, null, 2);
      return this.create(`${manifest.name} · 修复草稿`.slice(0, 120), files, `基于 ${version}；发布前需要重新校验与试跑。`, await packages.sourcePaths(id, version) ?? null, { id, version, digest: pkg.digest, installationRevision: state.revision });
    },
    async patch(id: string, expectedRevision: string, changes: DraftChange[], source: "user" | "ai" = "ai") {
      const current = await get(id);
      if (current.revision !== expectedRevision) throw new Error("草稿已被其他编辑修改；请读取新版本并合并，原稿未被覆盖。");
      if (changes.length > 100 || new Set(changes.map((change) => change.path)).size !== changes.length) throw new Error("变更路径重复或数量超限。");
      const files = { ...current.files };
      for (const change of changes) {
        if (source === "ai" && /^(fixtures|tests)\//.test(change.path) && current.files[change.path] !== undefined && current.files[change.path] !== change.text) throw new Error("AI 不能删改已有验收样例；可添加新样例，已有条件由用户在制作工作台修改。");
        if (change.text === null) delete files[change.path]; else files[change.path] = change.text;
      }
      boundedJson(files, 24 * 1024 * 1024); await buildExtensionPackage(files);
      return save(current, { ...current, files, source, restoredFrom: undefined, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() });
    },
    async restore(id: string, expectedRevision: string, targetRevision: string, source: "user" | "ai" = "ai") {
      const current = await get(id), target = await revision(id, targetRevision);
      if (current.revision !== expectedRevision) throw new Error("草稿已被其他编辑修改；请读取新版本并合并，原稿未被覆盖。");
      if (source === "ai" && Object.keys(current.files).some(path => /^(fixtures|tests)\//.test(path) && target.files[path] !== current.files[path])) throw new Error("AI 不能通过恢复历史删改已有验收样例；请由用户核对后恢复。");
      await buildExtensionPackage(target.files);
      return save(current, { ...current, files: target.files, sourcePaths: current.sourcePaths && target.sourcePaths ? [...new Set([...current.sourcePaths, ...target.sourcePaths])] : undefined, source: "restore", restoredFrom: targetRevision, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() });
    },
    async validate(id: string) { return validateExtensionPackage(await buildExtensionPackage((await get(id)).files)); },
    async report(id: string) { return (await storage.get(`extension-trial/${id}`))?.value as TrialReport | undefined; },
    async saveReport(id: string, report: TrialReport) { const key = `extension-trial/${id}`, row = await storage.get(key); await storage.commit([{ key, expected: row?.version ?? null, row: { key, version: crypto.randomUUID(), value: report } }]); notify(); },
    async publish(id: string, packages: ExtensionPackageStore) {
      const draft = await get(id), pkg = await validateExtensionPackage(await buildExtensionPackage(draft.files));
      const report = await this.report(id);
      if (!report?.passed || report.digest !== pkg.digest) throw new Error("当前内容尚未通过样例试跑；请先预览并运行样例。");
      const lock = { schema: "liteasy.extension-lock/v1", extensionId: pkg.manifest.id, version: pkg.manifest.version, sourceDigest: pkg.digest, extensionApi: "2.0.0", files: pkg.bundle.digests, components: pkg.blocks.map((block) => ({ id: block.id, version: block.version, base: block.base })), workflows: await Promise.all(pkg.manifest.contributes.workflows.map(async (workflow) => ({ id: workflow.id, digest: await hashText(pkg.bundle.files[workflow.path]) }))) };
      const published = await buildExtensionPackage({ ...draft.files, "extension.lock.json": JSON.stringify(lock, null, 2), "tests/report.json": JSON.stringify(report, null, 2) });
      const previous = (await packages.list()).find((entry) => entry.id === pkg.manifest.id);
      if (draft.base && (draft.base.id !== pkg.manifest.id || previous?.revision !== draft.base.installationRevision || previous.digest !== draft.base.digest)) throw new Error("已安装版本在制作期间发生变化。请从当前版本重新创建修复草稿并合并修改，旧版本未被覆盖。");
      // Installation is disabled; enabling remains an explicit host action after reviewing contributions.
      return packages.install(published, previous?.revision ?? null, draft.sourcePaths);
    },
  };
}
export type ExtensionDraftStore = ReturnType<typeof createExtensionDraftStore>;
