import { getComponentCard, getComponentCards } from "../generative-ui/componentRegistry";
import { getDataSourceCards, hasDataSource } from "../generative-ui/dataSourceRegistry";
import type { UIDslComponentName, UIDslDataSourceId } from "../generative-ui/generativeUi.types";
import {
  LITEASY_EXTENSION_API_VERSION,
  LITEASY_READER_SELECTION_VERSION,
  type ExtensionApiDescriptor,
  type ExtensionArtifactRendererContribution,
  type ExtensionCommandContribution,
  type ExtensionContextMenuContribution,
  type ExtensionDispatchResult,
  type ExtensionEventSubscription,
  type ExtensionHandlerRequest,
  type ExtensionHandlerResult,
  type ExtensionManifestV1,
  type ExtensionPermission,
  type ExtensionServiceName,
  type ExtensionSidePanelContribution,
  type ReaderSelectionSnapshotV1
} from "./extensionApi.types";

const extensionPermissions: ExtensionPermission[] = [
  "artifact.renderer.register",
  "reader.command.register",
  "reader.context_menu.register",
  "reader.selection.read",
  "reader.selection.subscribe",
  "ui.side_panel.register"
];

const extensionPermissionSet = new Set<string>(extensionPermissions);
const extensionIdPattern = /^plugin\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const memberIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const handlerIdPattern = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const maxHandlerResultBytes = 256 * 1024;

export type ExtensionHostBridge = {
  invokeHandler: (
    request: ExtensionHandlerRequest
  ) => ExtensionHandlerResult | Promise<ExtensionHandlerResult>;
};

export type ExtensionRuntime = {
  emitReaderSelectionChanged: (
    selection: ReaderSelectionSnapshotV1 | null
  ) => Promise<ExtensionDispatchResult[]>;
  getArtifactRenderers: () => ExtensionArtifactRendererContribution[];
  getContextMenuItems: () => Array<
    ExtensionContextMenuContribution & { extensionId: string; title: string }
  >;
  getReaderSelection: (extensionId: string) => ReaderSelectionSnapshotV1 | null;
  getSidePanels: () => ExtensionSidePanelContribution[];
  invokeCommand: (
    commandId: string,
    payload?: Record<string, unknown>
  ) => Promise<ExtensionHandlerResult>;
  listCommands: () => ExtensionCommandContribution[];
  listExtensions: () => ExtensionManifestV1[];
  registerExtension: (manifest: unknown) => ExtensionManifestV1;
  unregisterExtension: (extensionId: string) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertJsonValue(value: unknown, path: string, seen = new WeakSet<object>()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${path}_not_serializable`);
    seen.add(value);
    value.forEach((item, index) => assertJsonValue(item, `${path}.${index}`, seen));
    return;
  }
  if (isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    if (seen.has(value)) throw new Error(`${path}_not_serializable`);
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
    return;
  }
  throw new Error(`${path}_not_serializable`);
}

function cloneJsonValue<T>(value: T, path: string, maxBytes = maxHandlerResultBytes): T {
  assertJsonValue(value, path);
  const serialized = JSON.stringify(value);
  if (serialized.length > maxBytes) throw new Error(`${path}_too_large`);
  return JSON.parse(serialized) as T;
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], path: string) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`extension_manifest_unknown_field:${path}`);
  }
}

function requireString(value: unknown, path: string, maxLength = 160) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`extension_manifest_invalid_string:${path}`);
  }
  return value;
}

function requireArray(value: unknown, path: string, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`extension_manifest_invalid_array:${path}`);
  }
  return value;
}

function requireOwnedId(value: unknown, extensionId: string, path: string) {
  const id = requireString(value, path);
  if (!memberIdPattern.test(id) || !id.startsWith(`${extensionId}.`)) {
    throw new Error(`extension_manifest_unowned_id:${path}`);
  }
  return id;
}

function requireHandlerId(value: unknown, path: string) {
  const id = requireString(value, path);
  if (!handlerIdPattern.test(id)) {
    throw new Error(`extension_manifest_invalid_handler:${path}`);
  }
  return id;
}

function parseDataSources(value: unknown, path: string): UIDslDataSourceId[] {
  return requireArray(value, path, 16).map((item, index) => {
    const sourceId = requireString(item, `${path}.${index}`);
    if (!hasDataSource(sourceId)) {
      throw new Error(`extension_manifest_unknown_data_source:${sourceId}`);
    }
    return sourceId as UIDslDataSourceId;
  });
}

function requireComponent(value: unknown, path: string, surface: string): UIDslComponentName {
  const component = requireString(value, path);
  const card = getComponentCard(component);
  if (!card || !card.supportedSurfaces.includes(surface as never)) {
    throw new Error(`extension_manifest_unsupported_component:${component}:${surface}`);
  }
  return component as UIDslComponentName;
}

function parseCommands(value: unknown, extensionId: string): ExtensionCommandContribution[] {
  return requireArray(value, "contributes.commands", 50).map((item, index) => {
    if (!isRecord(item)) throw new Error(`extension_manifest_invalid_command:${index}`);
    assertExactKeys(item, ["handlerId", "id", "title"], `contributes.commands.${index}`);
    return {
      handlerId: requireHandlerId(item.handlerId, `contributes.commands.${index}.handlerId`),
      id: requireOwnedId(item.id, extensionId, `contributes.commands.${index}.id`),
      title: requireString(item.title, `contributes.commands.${index}.title`, 80)
    };
  });
}

function parseContextMenus(
  value: unknown,
  extensionId: string
): ExtensionContextMenuContribution[] {
  return requireArray(value, "contributes.contextMenus", 50).map((item, index) => {
    if (!isRecord(item)) throw new Error(`extension_manifest_invalid_context_menu:${index}`);
    assertExactKeys(
      item,
      ["commandId", "group", "id", "when"],
      `contributes.contextMenus.${index}`
    );
    const group = requireString(item.group, `contributes.contextMenus.${index}.group`);
    const when = requireString(item.when, `contributes.contextMenus.${index}.when`);
    if (group !== "assistant" && group !== "navigation" && group !== "tools") {
      throw new Error(`extension_manifest_invalid_context_menu_group:${group}`);
    }
    if (when !== "reader.has_selection") {
      throw new Error(`extension_manifest_invalid_context_menu_when:${when}`);
    }
    return {
      commandId: requireOwnedId(
        item.commandId,
        extensionId,
        `contributes.contextMenus.${index}.commandId`
      ),
      group,
      id: requireOwnedId(item.id, extensionId, `contributes.contextMenus.${index}.id`),
      when
    };
  });
}

function parseSidePanels(value: unknown, extensionId: string): ExtensionSidePanelContribution[] {
  return requireArray(value, "contributes.sidePanels", 10).map((item, index) => {
    if (!isRecord(item)) throw new Error(`extension_manifest_invalid_side_panel:${index}`);
    assertExactKeys(
      item,
      ["component", "dataSources", "id", "title"],
      `contributes.sidePanels.${index}`
    );
    return {
      component: requireComponent(
        item.component,
        `contributes.sidePanels.${index}.component`,
        "workbench_overlay"
      ),
      dataSources: parseDataSources(
        item.dataSources,
        `contributes.sidePanels.${index}.dataSources`
      ),
      id: requireOwnedId(item.id, extensionId, `contributes.sidePanels.${index}.id`),
      title: requireString(item.title, `contributes.sidePanels.${index}.title`, 80)
    };
  });
}

function parseArtifactRenderers(
  value: unknown,
  extensionId: string
): ExtensionArtifactRendererContribution[] {
  return requireArray(value, "contributes.artifactRenderers", 20).map((item, index) => {
    if (!isRecord(item)) throw new Error(`extension_manifest_invalid_artifact_renderer:${index}`);
    assertExactKeys(
      item,
      ["artifactType", "component", "dataSources", "id"],
      `contributes.artifactRenderers.${index}`
    );
    return {
      artifactType: requireString(
        item.artifactType,
        `contributes.artifactRenderers.${index}.artifactType`,
        80
      ),
      component: requireComponent(
        item.component,
        `contributes.artifactRenderers.${index}.component`,
        "center_artifact"
      ),
      dataSources: parseDataSources(
        item.dataSources,
        `contributes.artifactRenderers.${index}.dataSources`
      ),
      id: requireOwnedId(item.id, extensionId, `contributes.artifactRenderers.${index}.id`)
    };
  });
}

function parseSubscriptions(value: unknown): ExtensionEventSubscription[] {
  return requireArray(value, "subscriptions", 20).map((item, index) => {
    if (!isRecord(item)) throw new Error(`extension_manifest_invalid_subscription:${index}`);
    assertExactKeys(item, ["event", "handlerId"], `subscriptions.${index}`);
    const event = requireString(item.event, `subscriptions.${index}.event`);
    if (event !== "reader.selection.changed") {
      throw new Error(`extension_manifest_unknown_event:${event}`);
    }
    return {
      event,
      handlerId: requireHandlerId(item.handlerId, `subscriptions.${index}.handlerId`)
    };
  });
}

function assertUnique(values: string[], path: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`extension_manifest_duplicate:${path}`);
  }
}

function assertPermission(
  permissions: Set<ExtensionPermission>,
  required: ExtensionPermission,
  present: boolean
) {
  if (present && !permissions.has(required)) {
    throw new Error(`extension_manifest_permission_missing:${required}`);
  }
}

export function parseExtensionManifest(value: unknown): ExtensionManifestV1 {
  if (!isRecord(value)) throw new Error("extension_manifest_invalid");
  assertExactKeys(
    value,
    [
      "apiVersion",
      "contributes",
      "handlers",
      "id",
      "name",
      "permissions",
      "subscriptions",
      "uses",
      "version"
    ],
    "manifest"
  );
  if (value.apiVersion !== LITEASY_EXTENSION_API_VERSION) {
    throw new Error("extension_manifest_api_version_unsupported");
  }
  const id = requireString(value.id, "id", 100);
  if (!extensionIdPattern.test(id)) throw new Error("extension_manifest_invalid_id");
  const version = requireString(value.version, "version", 64);
  if (!semverPattern.test(version)) throw new Error("extension_manifest_invalid_version");
  const permissions = requireArray(value.permissions, "permissions", extensionPermissions.length)
    .map((item, index) => {
      const permission = requireString(item, `permissions.${index}`);
      if (!extensionPermissionSet.has(permission)) {
        throw new Error(`extension_manifest_unknown_permission:${permission}`);
      }
      return permission as ExtensionPermission;
    });
  assertUnique(permissions, "permissions");
  const handlers = requireArray(value.handlers, "handlers", 100).map((item, index) =>
    requireHandlerId(item, `handlers.${index}`)
  );
  assertUnique(handlers, "handlers");
  if (!isRecord(value.contributes)) throw new Error("extension_manifest_invalid_contributions");
  assertExactKeys(
    value.contributes,
    ["artifactRenderers", "commands", "contextMenus", "sidePanels"],
    "contributes"
  );
  const commands = parseCommands(value.contributes.commands, id);
  const contextMenus = parseContextMenus(value.contributes.contextMenus, id);
  const sidePanels = parseSidePanels(value.contributes.sidePanels, id);
  const artifactRenderers = parseArtifactRenderers(value.contributes.artifactRenderers, id);
  const subscriptions = parseSubscriptions(value.subscriptions);
  if (!isRecord(value.uses)) throw new Error("extension_manifest_invalid_uses");
  assertExactKeys(value.uses, ["services"], "uses");
  const services = requireArray(value.uses.services, "uses.services", 10).map((item, index) => {
    const service = requireString(item, `uses.services.${index}`);
    if (service !== "reader.selection.get") {
      throw new Error(`extension_manifest_unknown_service:${service}`);
    }
    return service as ExtensionServiceName;
  });
  assertUnique(services, "uses.services");
  const permissionSet = new Set(permissions);

  assertUnique(commands.map((item) => item.id), "commands");
  assertUnique(contextMenus.map((item) => item.id), "contextMenus");
  assertUnique(sidePanels.map((item) => item.id), "sidePanels");
  assertUnique(artifactRenderers.map((item) => item.id), "artifactRenderers");
  assertUnique(artifactRenderers.map((item) => item.artifactType), "artifactTypes");
  const declaredHandlers = new Set(handlers);
  for (const handlerId of [
    ...commands.map((item) => item.handlerId),
    ...subscriptions.map((item) => item.handlerId)
  ]) {
    if (!declaredHandlers.has(handlerId)) {
      throw new Error(`extension_manifest_handler_not_declared:${handlerId}`);
    }
  }
  const commandIds = new Set(commands.map((item) => item.id));
  for (const menu of contextMenus) {
    if (!commandIds.has(menu.commandId)) {
      throw new Error(`extension_manifest_command_not_declared:${menu.commandId}`);
    }
  }
  assertPermission(permissionSet, "reader.command.register", commands.length > 0);
  assertPermission(permissionSet, "reader.context_menu.register", contextMenus.length > 0);
  assertPermission(permissionSet, "ui.side_panel.register", sidePanels.length > 0);
  assertPermission(
    permissionSet,
    "artifact.renderer.register",
    artifactRenderers.length > 0
  );
  assertPermission(
    permissionSet,
    "reader.selection.subscribe",
    subscriptions.length > 0
  );
  assertPermission(
    permissionSet,
    "reader.selection.read",
    subscriptions.length > 0 || contextMenus.length > 0 || services.length > 0
  );

  return structuredClone({
    apiVersion: LITEASY_EXTENSION_API_VERSION,
    contributes: {
      artifactRenderers,
      commands,
      contextMenus,
      sidePanels
    },
    handlers,
    id,
    name: requireString(value.name, "name", 80),
    permissions,
    subscriptions,
    uses: {
      services
    },
    version
  });
}

export function getRequiredExtensionPermissions(
  manifest: ExtensionManifestV1
): ExtensionPermission[] {
  const required = new Set<ExtensionPermission>();
  if (manifest.contributes.commands.length > 0) required.add("reader.command.register");
  if (manifest.contributes.contextMenus.length > 0) {
    required.add("reader.context_menu.register");
    required.add("reader.selection.read");
  }
  if (manifest.contributes.sidePanels.length > 0) required.add("ui.side_panel.register");
  if (manifest.contributes.artifactRenderers.length > 0) {
    required.add("artifact.renderer.register");
  }
  if (manifest.subscriptions.length > 0) {
    required.add("reader.selection.read");
    required.add("reader.selection.subscribe");
  }
  if (manifest.uses.services.includes("reader.selection.get")) {
    required.add("reader.selection.read");
  }
  return extensionPermissions.filter((permission) => required.has(permission));
}

function parseSelection(value: ReaderSelectionSnapshotV1): ReaderSelectionSnapshotV1 {
  if (!isRecord(value) || value.version !== LITEASY_READER_SELECTION_VERSION) {
    throw new Error("extension_reader_selection_invalid");
  }
  if (
    typeof value.page !== "number" ||
    !Number.isInteger(value.page) ||
    value.page < 1 ||
    !Array.isArray(value.rects) ||
    value.rects.length > 100
  ) {
    throw new Error("extension_reader_selection_invalid");
  }
  requireString(value.excerpt, "selection.excerpt", 20_000);
  requireString(value.paperId, "selection.paperId", 200);
  requireString(value.paperTitle, "selection.paperTitle", 500);
  requireString(value.selectionId, "selection.selectionId", 500);
  for (const rect of value.rects) {
    if (
      !isRecord(rect) ||
      [rect.height, rect.left, rect.top, rect.width].some(
        (coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate)
      )
    ) {
      throw new Error("extension_reader_selection_invalid_rect");
    }
  }
  return structuredClone(value);
}

function cloneHandlerResult(result: ExtensionHandlerResult): ExtensionHandlerResult {
  if (!isRecord(result) || (result.status !== "ok" && result.status !== "rejected")) {
    throw new Error("extension_handler_result_invalid");
  }
  if (result.message !== undefined && typeof result.message !== "string") {
    throw new Error("extension_handler_result_invalid");
  }
  return cloneJsonValue(result, "extension_handler_result");
}

function contributionIds(manifest: ExtensionManifestV1) {
  return [
    ...manifest.contributes.commands.map((item) => item.id),
    ...manifest.contributes.contextMenus.map((item) => item.id),
    ...manifest.contributes.sidePanels.map((item) => item.id),
    ...manifest.contributes.artifactRenderers.map((item) => item.id)
  ];
}

export function getExtensionApiDescriptor(): ExtensionApiDescriptor {
  return {
    apiVersion: LITEASY_EXTENSION_API_VERSION,
    components: getComponentCards().map((card) => ({
      component: card.component,
      supportedSurfaces: [...card.supportedSurfaces]
    })),
    dataSources: getDataSourceCards().map((card) => card.sourceId),
    events: ["reader.selection.changed"],
    permissions: [...extensionPermissions],
    services: ["reader.selection.get"]
  };
}

export function createExtensionRuntime(bridge: ExtensionHostBridge): ExtensionRuntime {
  const manifests = new Map<string, ExtensionManifestV1>();
  let readerSelection: ReaderSelectionSnapshotV1 | null = null;

  function allManifests() {
    return [...manifests.values()];
  }

  function assertNoConflicts(manifest: ExtensionManifestV1) {
    const existingIds = new Set(allManifests().flatMap(contributionIds));
    const existingArtifactTypes = new Set(
      allManifests().flatMap((item) =>
        item.contributes.artifactRenderers.map((renderer) => renderer.artifactType)
      )
    );
    if (contributionIds(manifest).some((id) => existingIds.has(id))) {
      throw new Error("extension_contribution_conflict");
    }
    if (
      manifest.contributes.artifactRenderers.some((renderer) =>
        existingArtifactTypes.has(renderer.artifactType)
      )
    ) {
      throw new Error("extension_artifact_renderer_conflict");
    }
  }

  async function invoke(request: ExtensionHandlerRequest) {
    return cloneHandlerResult(await bridge.invokeHandler(
      cloneJsonValue(request, "extension_handler_request")
    ));
  }

  return {
    async emitReaderSelectionChanged(selection) {
      readerSelection = selection ? parseSelection(selection) : null;
      const subscribers = allManifests().flatMap((manifest) =>
        manifest.subscriptions
          .filter((subscription) => subscription.event === "reader.selection.changed")
          .map((subscription) => ({ manifest, subscription }))
      );
      return Promise.all(subscribers.map(async ({ manifest, subscription }) => {
        try {
          const result = await invoke({
            apiVersion: LITEASY_EXTENSION_API_VERSION,
            extensionId: manifest.id,
            handlerId: subscription.handlerId,
            payload: {
              selection: readerSelection ? structuredClone(readerSelection) : null
            },
            trigger: {
              event: "reader.selection.changed",
              kind: "event"
            }
          });
          return {
            extensionId: manifest.id,
            handlerId: subscription.handlerId,
            result,
            status: "fulfilled" as const
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "extension_handler_failed",
            extensionId: manifest.id,
            handlerId: subscription.handlerId,
            status: "rejected" as const
          };
        }
      }));
    },
    getArtifactRenderers() {
      return structuredClone(allManifests().flatMap((item) => item.contributes.artifactRenderers));
    },
    getContextMenuItems() {
      if (!readerSelection) return [];
      return allManifests().flatMap((manifest) => {
        const titles = new Map(
          manifest.contributes.commands.map((command) => [command.id, command.title])
        );
        return manifest.contributes.contextMenus.map((item) => ({
          ...structuredClone(item),
          extensionId: manifest.id,
          title: titles.get(item.commandId) ?? item.commandId
        }));
      });
    },
    getReaderSelection(extensionId) {
      const manifest = manifests.get(extensionId);
      if (!manifest) throw new Error("extension_not_registered");
      if (!manifest.permissions.includes("reader.selection.read")) {
        throw new Error("extension_permission_denied:reader.selection.read");
      }
      return readerSelection ? structuredClone(readerSelection) : null;
    },
    getSidePanels() {
      return structuredClone(allManifests().flatMap((item) => item.contributes.sidePanels));
    },
    async invokeCommand(commandId, payload = {}) {
      const entry = allManifests()
        .map((manifest) => ({
          command: manifest.contributes.commands.find((candidate) => candidate.id === commandId),
          manifest
        }))
        .find((candidate) => candidate.command);
      if (!entry?.command) throw new Error("extension_command_not_found");
      const commandPayload = cloneJsonValue(payload, "extension_command_payload");
      if (entry.manifest.permissions.includes("reader.selection.read")) {
        commandPayload.selection = readerSelection ? structuredClone(readerSelection) : null;
      }
      return invoke({
        apiVersion: LITEASY_EXTENSION_API_VERSION,
        extensionId: entry.manifest.id,
        handlerId: entry.command.handlerId,
        payload: commandPayload,
        trigger: {
          commandId,
          kind: "command"
        }
      });
    },
    listCommands() {
      return structuredClone(allManifests().flatMap((item) => item.contributes.commands));
    },
    listExtensions() {
      return structuredClone(allManifests());
    },
    registerExtension(value) {
      const manifest = parseExtensionManifest(value);
      if (manifests.has(manifest.id)) throw new Error("extension_already_registered");
      assertNoConflicts(manifest);
      manifests.set(manifest.id, manifest);
      return structuredClone(manifest);
    },
    unregisterExtension(extensionId) {
      return manifests.delete(extensionId);
    }
  };
}
