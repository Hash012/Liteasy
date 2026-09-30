import { parseExtensionManifest } from "./extensionApi";
import { boundedJson } from "./extensionSchema";
/** Preserve old validators and meanings. Executable v1 handlers still require the old host transport. */
export function inspectLegacyExtension(value: unknown) {
  boundedJson(value);
  const manifest = parseExtensionManifest(value);
  return { apiVersion: manifest.apiVersion, owner: manifest.id, version: manifest.version,
    commands: manifest.contributes.commands.map((item) => ({ id: `${manifest.id}/${item.id}`, title: item.title, legacyHandler: item.handlerId })),
    views: manifest.contributes.sidePanels.map((item) => ({ id: `${manifest.id}/${item.id}`, title: item.title, component: item.component, dataSources: item.dataSources })),
    permissions: manifest.permissions, requiresLegacyTransport: manifest.handlers.length > 0,
    original: manifest };
}
export { compileLegacyWorkflowPlan } from "../skills/workflowSkillRegistry";
