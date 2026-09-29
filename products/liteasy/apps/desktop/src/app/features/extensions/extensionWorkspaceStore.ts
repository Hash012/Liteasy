import { z } from "zod";
import type { ObjectStorage } from "../objects/objectStorage";
import { boundedJson, schemaDefaults, validateSchemaValue, type DataSchema, type JsonObject } from "./extensionSchema";
import { extensionId } from "./extensionPackage";
import { isExtensionDockItemId } from "../dock/dockRegistry";
import type { ExtensionDockItemId } from "../dock/dock.types";

const viewSchema = z.strictObject({ schema: z.literal("liteasy.extension-view/v1"), dockId: z.string().refine(isExtensionDockItemId), extensionId, viewId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9.-]*$/), instanceId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), title: z.string().max(120), args: z.record(z.string(), z.json()), state: z.record(z.string(), z.json()), hostState: z.strictObject({ scrollTop: z.number().nonnegative() }).optional(), updatedAt: z.string() });
export type ExtensionViewInstance = z.infer<typeof viewSchema> & { revision: string; dockId: ExtensionDockItemId };
const configurationSchema = z.strictObject({ schema: z.literal("liteasy.extension-config/v1"), values: z.record(z.string(), z.json()) });
export type ConfigurationLevel = "global" | "profile" | `workspace:${string}`;

export function createExtensionWorkspaceStore(storage: ObjectStorage) {
  const configurationListeners = new Set<() => void>();
  const viewKey = (id: string) => `extension-view/${encodeURIComponent(id)}`;
  const configKey = (owner: string, group: string, level: ConfigurationLevel) => `extension-config/${encodeURIComponent(owner)}/${encodeURIComponent(group)}/${encodeURIComponent(level)}`;
  return {
    subscribeConfiguration(listener: () => void) { configurationListeners.add(listener); return () => { configurationListeners.delete(listener); }; },
    async listViews(): Promise<ExtensionViewInstance[]> {
      return (await storage.list("extension-view/", "", 200)).flatMap((row) => { const result = viewSchema.safeParse(row.value); return result.success ? [{ ...result.data, dockId: result.data.dockId as ExtensionDockItemId, revision: row.version }] : []; });
    },
    async getView(dockId: string): Promise<ExtensionViewInstance | undefined> {
      const row = await storage.get(viewKey(dockId));
      if (!row) return undefined;
      const value = viewSchema.parse(row.value);
      if (value.dockId !== dockId) throw new Error("页面身份不匹配。");
      return { ...value, dockId: value.dockId as ExtensionDockItemId, revision: row.version };
    },
    async saveView(input: Omit<ExtensionViewInstance, "revision" | "updatedAt">, expectedRevision: string | null) {
      boundedJson(input, 64 * 1024);
      const value = viewSchema.parse({ ...input, updatedAt: new Date().toISOString() });
      const key = viewKey(input.dockId), revision = crypto.randomUUID();
      await storage.commit([{ key, expected: expectedRevision, row: { key, version: revision, value } }]);
      return { ...value, dockId: value.dockId as ExtensionDockItemId, revision };
    },
    async readConfiguration(owner: string, group: string, schema: DataSchema, level: ConfigurationLevel = "profile") {
      const levels: ConfigurationLevel[] = level === "global" ? ["global"] : level === "profile" ? ["global", "profile"] : ["global", "profile", level];
      const effective = schemaDefaults(schema) as JsonObject;
      const sources: Record<string, string> = Object.fromEntries(Object.keys(effective).map((key) => [key, "default"]));
      let values: JsonObject = {}, revision: string | null = null;
      for (const entry of levels) {
        const row = await storage.get(configKey(owner, group, entry));
        if (!row) continue;
        const stored = configurationSchema.parse(row.value).values;
        for (const [key, value] of Object.entries(stored)) { effective[key] = value; sources[key] = entry; }
        if (entry === level) { values = stored; revision = row.version; }
      }
      validateSchemaValue(schema, effective);
      return { effective, values, revision, sources };
    },
    async saveConfiguration(owner: string, group: string, schema: DataSchema, level: ConfigurationLevel, values: JsonObject, expectedRevision: string | null) {
      extensionId.parse(owner);
      boundedJson(values, 64 * 1024);
      const parent = level === "global" ? schemaDefaults(schema) as JsonObject : (await this.readConfiguration(owner, group, schema, level === "profile" ? "global" : "profile")).effective;
      const merged = { ...parent, ...values };
      validateSchemaValue(schema, merged);
      const key = configKey(owner, group, level);
      const old = await storage.get(key);
      if (old) configurationSchema.parse(old.value); // preserve unrecognized newer data
      await storage.commit([{ key, expected: expectedRevision, row: { key, version: crypto.randomUUID(), value: { schema: "liteasy.extension-config/v1", values } } }]);
      for (const listener of configurationListeners) listener();
    },
  };
}
export type ExtensionWorkspaceStore = ReturnType<typeof createExtensionWorkspaceStore>;
