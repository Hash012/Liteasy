import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkbenchViewModel } from "../features/boards/ObjectWorkbench";
import { createObjectStorage } from "../features/objects/objectStorage";
import { createExtensionWorkspaceStore, type ExtensionViewInstance } from "../features/extensions/extensionWorkspaceStore";
import type { ExtensionWorkbench } from "../features/extensions/extensionWorkbenchContext";
import { boundedJson, schemaDefaults, parseDataSchema, validateSchemaValue, type JsonObject } from "../features/extensions/extensionSchema";
import { registerExtensionDockItem } from "../features/dock/dockRegistry";
import type { DockItemId, ExtensionDockItemId } from "../features/dock/dock.types";
import { hashText } from "../features/context/objectContext";
import { projectBlockText } from "../features/visual-blocks/blockRegistry";

export function useExtensionWorkbenchController(input: {
  model: WorkbenchViewModel & { extensions: NonNullable<WorkbenchViewModel["extensions"]> };
  openDock(item: DockItemId): void;
  openAsset(path: string): Promise<unknown>;
  runWorkflow?(owner: string, workflow: string, selection: string[]): Promise<void>;
}): ExtensionWorkbench {
  const latest = useRef(input); latest.current = input;
  const scope = input.model.repository.scopeId;
  const workspace = useMemo(() => createExtensionWorkspaceStore(createObjectStorage(scope, () => latest.current.model.repository.scopeId)), [scope]);
  const [views, setViews] = useState<ExtensionViewInstance[]>([]);
  const [error, setError] = useState("");
  const registrations = useRef<Array<() => void>>([]);
  const generation = useRef(0);
  const active = useRef(true);
  async function refreshViews() {
    const current = ++generation.current;
    const items = await workspace.listViews();
    if (!active.current || current !== generation.current || latest.current.model.repository.scopeId !== scope) return;
    registrations.current.splice(0).forEach((dispose) => dispose());
    for (const item of items) {
      const pkg = latest.current.model.extensions.snapshot.packages.find((entry) => entry.manifest.id === item.extensionId);
      const definition = pkg?.manifest.contributes.views.find((entry) => entry.id === item.viewId);
      registrations.current.push(registerExtensionDockItem({ id: item.dockId, title: definition?.title ?? item.title, preferredRegion: definition?.placement ?? "main", allowedRegions: definition?.allowedPlacements ?? ["main", "left", "right", "bottom"] }));
    }
    setViews(items);
  }
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; registrations.current.splice(0).forEach((dispose) => dispose()); }; }, [workspace]);
  useEffect(() => { setError(""); void refreshViews().catch((e) => { if (active.current) setError(String(e)); }); }, [workspace, input.model.extensions.snapshot]);
  async function openView(owner: string, viewId: string, args: JsonObject = {}, requestedInstance?: string) {
    boundedJson(args, 32 * 1024);
    const pkg = latest.current.model.extensions.snapshot.packages.find((entry) => entry.manifest.id === owner);
    const definition = pkg?.manifest.contributes.views.find((entry) => entry.id === viewId);
    if (!pkg || !definition) throw new Error("页面所属扩展未启用，请在扩展中启用或重新导入。");
    if (definition.argsSchema) validateSchemaValue(parseDataSchema(JSON.parse(pkg.bundle.files[definition.argsSchema])), args);
    const instanceId = requestedInstance ?? (definition.instancePolicy === "singleton" ? "default" : definition.instancePolicy === "multiple" ? crypto.randomUUID() : (await hashText(JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]])))).slice(0, 32));
    const dockId: ExtensionDockItemId = `extension:${pkg.manifest.id as `plugin.${string}`}/${viewId}/${instanceId}`;
    const existing = await workspace.getView(dockId);
    if (!existing) {
      if ((await workspace.listViews()).length >= 200) throw new Error("已保存页面达到上限，请先移除不用的页面记录。");
      await workspace.saveView({ schema: "liteasy.extension-view/v1", dockId, extensionId: owner, viewId, instanceId, title: definition.title, args, state: definition.stateSchema ? schemaDefaults(parseDataSchema(JSON.parse(pkg.bundle.files[definition.stateSchema]))) as JsonObject : {} }, null);
    }
    await refreshViews();
    if (active.current && latest.current.model.repository.scopeId === scope) latest.current.openDock(dockId);
  }
  async function invoke(owner: string, commandId: string, selection: string[] = []) {
    const model = latest.current.model;
    const pkg = model.extensions.snapshot.packages.find((entry) => entry.manifest.id === owner);
    const command = pkg?.manifest.contributes.commands.find((entry) => entry.id === commandId);
    if (!pkg || !command) throw new Error("扩展命令不可用。");
    if (command.view) return openView(owner, command.view, { selection });
    if (command.workflow) {
      if (!latest.current.runWorkflow) throw new Error("工作流执行器尚未就绪。");
      return latest.current.runWorkflow(owner, command.workflow, selection);
    }
    const template = pkg.templates.find((entry) => entry.id === command.boardTemplate);
    if (!template) throw new Error("组合模板不可用。");
    const board = await model.repository.importBoardFile({ title: template.title, operationId: crypto.randomUUID(), edges: [], nodes: template.cards.map((card) => {
      const data = model.extensions.snapshot.registry.instantiate(card.type.id, card.type.version, card.data);
      return { id: card.id, position: card.position, size: card.size, structured: { schema: "liteasy.visual-block/v1" as const, type: card.type, data }, draft: { title: card.title, kind: "content.note" as const, content: { schema: "liteasy.note/v1" as const, payload: { text: projectBlockText(data), origin: "user" as const } } } };
    }) });
    await model.selectBoard(board); await model.refresh(); latest.current.openDock("board");
  }
  return {
    packages: input.model.extensions, workspace, views, error, openView, invoke, refreshViews,
    openStudio: () => latest.current.openDock("workflow-studio"),
    async openLink(path) {
      if (path.startsWith("liteasy://extensions/")) {
        const url = new URL(path), parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        if (parts.length === 3 && parts[1] === "settings") {
          latest.current.openDock("settings");
          window.dispatchEvent(new CustomEvent("liteasy:extension-settings", { detail: { owner: parts[0], group: parts[2] } }));
          return;
        }
        if (parts.length !== 3 || parts[1] !== "views") throw new Error("扩展链接无效。");
        return openView(parts[0], parts[2], {}, url.searchParams.get("instance") ?? undefined);
      }
      await latest.current.openAsset(path);
    },
  };
}
