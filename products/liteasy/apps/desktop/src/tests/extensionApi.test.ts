import { describe, expect, test, vi } from "vitest";
import {
  createExtensionRuntime,
  getExtensionApiDescriptor,
  parseExtensionManifest
} from "../app/features/extensions/extensionApi";
import {
  LITEASY_EXTENSION_API_VERSION,
  LITEASY_READER_SELECTION_VERSION,
  type ExtensionManifestV1,
  type ReaderSelectionSnapshotV1
} from "../app/features/extensions/extensionApi.types";

function createManifest(
  overrides: Partial<ExtensionManifestV1> = {}
): ExtensionManifestV1 {
  return {
    apiVersion: LITEASY_EXTENSION_API_VERSION,
    contributes: {
      artifactRenderers: [
        {
          artifactType: "selection-analysis",
          component: "ComparisonTable",
          dataSources: ["retrieval.citations"],
          id: "plugin.selection-ask.renderer.selection-analysis"
        }
      ],
      commands: [
        {
          handlerId: "handlers.ask",
          id: "plugin.selection-ask.command.ask",
          title: "询问 AI"
        }
      ],
      contextMenus: [
        {
          commandId: "plugin.selection-ask.command.ask",
          group: "assistant",
          id: "plugin.selection-ask.menu.ask",
          when: "reader.has_selection"
        }
      ],
      sidePanels: [
        {
          component: "Panel",
          dataSources: ["runtime.context_view"],
          id: "plugin.selection-ask.panel.answers",
          title: "选区问答"
        }
      ]
    },
    handlers: ["handlers.ask", "handlers.selectionChanged"],
    id: "plugin.selection-ask",
    name: "Selection Ask",
    permissions: [
      "artifact.renderer.register",
      "reader.command.register",
      "reader.context_menu.register",
      "reader.selection.read",
      "reader.selection.subscribe",
      "ui.side_panel.register"
    ],
    subscriptions: [
      {
        event: "reader.selection.changed",
        handlerId: "handlers.selectionChanged"
      }
    ],
    uses: {
      services: ["reader.selection.get"]
    },
    version: "1.0.0",
    ...overrides
  };
}

const selection: ReaderSelectionSnapshotV1 = {
  excerpt: "The baseline omits the strongest ablation.",
  page: 4,
  paperId: "paper-1",
  paperTitle: "A Systems Paper",
  rects: [{ height: 3, left: 12, top: 24, width: 40 }],
  selectionId: "paper-1:4:120:The baseline omits the strongest ablation.",
  version: LITEASY_READER_SELECTION_VERSION
};

describe("Extension API", () => {
  test("publishes a versioned descriptor for stable extension points", () => {
    expect(getExtensionApiDescriptor()).toMatchObject({
      apiVersion: "liteasy.extension/v1",
      events: ["reader.selection.changed"],
      services: ["reader.selection.get"]
    });
    expect(getExtensionApiDescriptor().permissions).toEqual(
      expect.arrayContaining([
        "reader.command.register",
        "reader.context_menu.register",
        "ui.side_panel.register",
        "artifact.renderer.register"
      ])
    );
  });

  test("registers declarative commands, context menus, panels, and artifact renderers", () => {
    const runtime = createExtensionRuntime({
      invokeHandler: async () => ({ status: "ok" })
    });

    expect(runtime.registerExtension(createManifest())).toMatchObject({
      id: "plugin.selection-ask",
      version: "1.0.0"
    });
    expect(runtime.listCommands()).toEqual([
      expect.objectContaining({ id: "plugin.selection-ask.command.ask" })
    ]);
    expect(runtime.getSidePanels()).toEqual([
      expect.objectContaining({ id: "plugin.selection-ask.panel.answers" })
    ]);
    expect(runtime.getArtifactRenderers()).toEqual([
      expect.objectContaining({ artifactType: "selection-analysis" })
    ]);
    expect(runtime.getContextMenuItems()).toEqual([]);
  });

  test("routes selection events and commands through the host bridge", async () => {
    const invokeHandler = vi.fn(async () => ({
      data: { answerId: "answer-1" },
      status: "ok" as const
    }));
    const runtime = createExtensionRuntime({ invokeHandler });
    runtime.registerExtension(createManifest());

    await expect(runtime.emitReaderSelectionChanged(selection)).resolves.toEqual([
      expect.objectContaining({
        extensionId: "plugin.selection-ask",
        handlerId: "handlers.selectionChanged",
        status: "fulfilled"
      })
    ]);
    expect(runtime.getReaderSelection("plugin.selection-ask")).toEqual(selection);
    expect(runtime.getContextMenuItems()).toEqual([
      expect.objectContaining({
        commandId: "plugin.selection-ask.command.ask",
        extensionId: "plugin.selection-ask",
        title: "询问 AI"
      })
    ]);

    await expect(runtime.invokeCommand("plugin.selection-ask.command.ask", {
      question: "这个实验设计有什么问题？"
    })).resolves.toEqual({
      data: { answerId: "answer-1" },
      status: "ok"
    });
    expect(invokeHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        extensionId: "plugin.selection-ask",
        handlerId: "handlers.ask",
        payload: expect.objectContaining({
          question: "这个实验设计有什么问题？",
          selection
        }),
        trigger: {
          commandId: "plugin.selection-ask.command.ask",
          kind: "command"
        }
      })
    );
  });

  test("enforces ownership, handler references, permissions, and known UI primitives", () => {
    expect(() => parseExtensionManifest({
      ...createManifest(),
      executable: () => "arbitrary React or JavaScript"
    })).toThrow("extension_manifest_unknown_field");

    expect(() => parseExtensionManifest({
      ...createManifest(),
      permissions: ["reader.command.register"]
    })).toThrow("extension_manifest_permission_missing");

    const unowned = createManifest();
    unowned.contributes.commands[0].id = "plugin.other.command.ask";
    expect(() => parseExtensionManifest(unowned)).toThrow("extension_manifest_unowned_id");

    const unknownHandler = createManifest();
    unknownHandler.contributes.commands[0].handlerId = "handlers.notDeclared";
    expect(() => parseExtensionManifest(unknownHandler)).toThrow(
      "extension_manifest_handler_not_declared"
    );

    const unsupportedRenderer = createManifest();
    unsupportedRenderer.contributes.artifactRenderers[0].component = "StatusBanner";
    expect(() => parseExtensionManifest(unsupportedRenderer)).toThrow(
      "extension_manifest_unsupported_component"
    );
  });

  test("does not expose selection data without reader.selection.read", async () => {
    const invokeHandler = vi.fn(async () => ({ status: "ok" as const }));
    const runtime = createExtensionRuntime({ invokeHandler });
    runtime.registerExtension(createManifest({
      contributes: {
        artifactRenderers: [],
        commands: [
          {
            handlerId: "handlers.open",
            id: "plugin.command-only.command.open",
            title: "打开"
          }
        ],
        contextMenus: [],
        sidePanels: []
      },
      handlers: ["handlers.open"],
      id: "plugin.command-only",
      name: "Command Only",
      permissions: ["reader.command.register"],
      subscriptions: [],
      uses: {
        services: []
      }
    }));

    await runtime.emitReaderSelectionChanged(selection);
    expect(() => runtime.getReaderSelection("plugin.command-only")).toThrow(
      "extension_permission_denied:reader.selection.read"
    );
    await runtime.invokeCommand("plugin.command-only.command.open", { target: "reader" });
    expect(invokeHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { target: "reader" }
      })
    );
  });

  test("rejects contribution conflicts without partially registering a package", () => {
    const runtime = createExtensionRuntime({
      invokeHandler: async () => ({ status: "ok" })
    });
    runtime.registerExtension(createManifest());
    const conflicting = createManifest({
      contributes: {
        artifactRenderers: [
          {
            artifactType: "selection-analysis",
            component: "ComparisonTable",
            dataSources: [],
            id: "plugin.other.renderer.selection-analysis"
          }
        ],
        commands: [],
        contextMenus: [],
        sidePanels: []
      },
      handlers: [],
      id: "plugin.other",
      name: "Other Plugin",
      permissions: ["artifact.renderer.register"],
      subscriptions: [],
      uses: {
        services: []
      }
    });

    expect(() => runtime.registerExtension(conflicting)).toThrow(
      "extension_artifact_renderer_conflict"
    );
    expect(runtime.listExtensions()).toHaveLength(1);
  });

  test("keeps handler requests and results on the JSON ABI", async () => {
    const runtime = createExtensionRuntime({
      invokeHandler: async () => ({
        data: new Map([["unsafe", true]]),
        status: "ok"
      })
    });
    runtime.registerExtension(createManifest());

    await expect(runtime.invokeCommand("plugin.selection-ask.command.ask")).rejects.toThrow(
      "extension_handler_result.data_not_serializable"
    );
    await expect(runtime.invokeCommand("plugin.selection-ask.command.ask", {
      createdAt: new Date()
    })).rejects.toThrow("extension_command_payload.createdAt_not_serializable");
  });
});
