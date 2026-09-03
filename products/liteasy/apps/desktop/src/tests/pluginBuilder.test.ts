import { describe, expect, test, vi } from "vitest";
import {
  createManagerCapabilityToolCatalog,
  executeManagerCapabilityTool
} from "../app/features/agent-runtime/capabilityToolAdapter";
import { executeConfirmedSemanticPlan } from "../app/features/agent-runtime/planExecutor";
import { createExtensionRuntime } from "../app/features/extensions/extensionApi";
import {
  auditSandboxPluginPackage,
  createMemoryPluginBuilderStore,
  createPluginBuilderRuntime,
  createPluginBuilderToolCatalog,
  LITEASY_PLUGIN_PACKAGE_VERSION,
  type PluginSandboxTransport,
  type SandboxPluginPackage
} from "../app/features/extensions/pluginBuilder";
import { LITEASY_EXTENSION_API_VERSION } from "../app/features/extensions/extensionApi.types";

function createSandboxPackage(): SandboxPluginPackage {
  return {
    entrypoints: [
      {
        exportName: "askSelection",
        handlerId: "handlers.ask",
        module: "src/index.ts"
      },
      {
        exportName: "selectionChanged",
        handlerId: "handlers.selectionChanged",
        module: "src/index.ts"
      }
    ],
    files: [
      {
        path: "package.json",
        sha256: "a".repeat(64),
        sizeBytes: 800
      },
      {
        path: "src/index.ts",
        sha256: "b".repeat(64),
        sizeBytes: 2_000
      },
      {
        path: "tests/selectionAsk.test.ts",
        sha256: "c".repeat(64),
        sizeBytes: 1_500
      }
    ],
    manifest: {
      apiVersion: LITEASY_EXTENSION_API_VERSION,
      contributes: {
        artifactRenderers: [],
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
        sidePanels: []
      },
      handlers: ["handlers.ask", "handlers.selectionChanged"],
      id: "plugin.selection-ask",
      name: "Selection Ask",
      permissions: [
        "reader.command.register",
        "reader.context_menu.register",
        "reader.selection.read",
        "reader.selection.subscribe"
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
      version: "1.0.0"
    },
    packageRef: "sandbox-package://selection-ask/build-1",
    packageVersion: LITEASY_PLUGIN_PACKAGE_VERSION,
    sandbox: {
      coreSource: "read_only",
      isolated: true,
      networkAccess: "none",
      snapshotId: "snapshot-build-1"
    },
    tests: [
      { command: "npm test", durationMs: 120, exitCode: 0 },
      { command: "npm run build", durationMs: 240, exitCode: 0 }
    ]
  };
}

function createTransport(
  sandboxPackage = createSandboxPackage()
): PluginSandboxTransport & {
  activatePlugin: ReturnType<typeof vi.fn>;
  buildPlugin: ReturnType<typeof vi.fn>;
  deactivatePlugin: ReturnType<typeof vi.fn>;
  invokeHandler: ReturnType<typeof vi.fn>;
} {
  return {
    activatePlugin: vi.fn(async () => ({ installationId: "installation-1" })),
    buildPlugin: vi.fn(async () => structuredClone(sandboxPackage)),
    deactivatePlugin: vi.fn(async () => undefined),
    invokeHandler: vi.fn(async () => ({ status: "ok" as const }))
  };
}

function createRuntime(transport = createTransport()) {
  const extensionRuntime = createExtensionRuntime({
    invokeHandler: (request) => transport.invokeHandler(request)
  });
  const pluginBuilder = createPluginBuilderRuntime({
    createId: () => "plugin-build-1",
    extensionRuntime,
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    transport
  });
  return { extensionRuntime, pluginBuilder, transport };
}

describe("Sandbox PluginBuilder", () => {
  test("exposes build and list tools without an implicit install tool", () => {
    expect(createPluginBuilderToolCatalog()).toEqual([
      expect.objectContaining({ name: "liteasy_plugin_build", strict: true }),
      expect.objectContaining({ name: "liteasy_plugin_list_builds", strict: true })
    ]);
    expect(createPluginBuilderToolCatalog().some((tool) => tool.name.includes("install"))).toBe(false);
  });

  test("accepts an isolated, tested, least-privilege package", () => {
    const result = auditSandboxPluginPackage(createSandboxPackage(), {
      now: () => new Date("2026-09-01T10:00:00.000Z")
    });

    expect(result.audit).toMatchObject({
      findings: [],
      passed: true,
      requestedPermissions: [
        "reader.command.register",
        "reader.context_menu.register",
        "reader.selection.read",
        "reader.selection.subscribe"
      ]
    });
    expect(result.package?.manifest.id).toBe("plugin.selection-ask");
  });

  test("rejects unsafe paths, writable core, failed tests, and excess permissions", () => {
    const unsafe = createSandboxPackage() as unknown as Record<string, any>;
    unsafe.files.push({
      path: "../products/liteasy/apps/desktop/src/app/layout/AppShell.tsx",
      sha256: "d".repeat(64),
      sizeBytes: 100
    });
    unsafe.sandbox.coreSource = "read_write";
    unsafe.tests[0].exitCode = 1;
    unsafe.manifest.permissions.push("ui.side_panel.register");

    const result = auditSandboxPluginPackage(unsafe);
    expect(result.package).toBeNull();
    expect(result.audit.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "plugin_file_path_unsafe",
        "plugin_sandbox_boundary_invalid",
        "plugin_required_test_failed",
        "plugin_permission_not_least_privilege"
      ])
    );
  });

  test("builds in the sandbox and remains inactive until approval", async () => {
    const { extensionRuntime, pluginBuilder, transport } = createRuntime();
    const result = await pluginBuilder.invokeTool({
      arguments: {
        description: "选择 PDF 文本后显示一个可调用 AI 的上下文菜单按钮。",
        suggestedId: "plugin.selection-ask"
      },
      name: "liteasy_plugin_build",
      toolCallId: "plugin-build-call-1"
    });

    expect(result).toMatchObject({
      build: {
        audit: { passed: true },
        buildId: "plugin-build-1",
        status: "awaiting_approval"
      },
      kind: "build",
      nextAction: {
        actionId: "plugin.install_build",
        arguments: { buildId: "plugin-build-1" }
      }
    });
    expect(transport.buildPlugin).toHaveBeenCalledWith(expect.objectContaining({
      apiDescriptor: expect.objectContaining({ apiVersion: "liteasy.extension/v1" })
    }));
    expect(transport.activatePlugin).not.toHaveBeenCalled();
    expect(extensionRuntime.listExtensions()).toEqual([]);
  });

  test("installs only through the existing human confirmation boundary", async () => {
    const { extensionRuntime, pluginBuilder, transport } = createRuntime();
    await pluginBuilder.build({
      description: "选择 PDF 文本后显示一个可调用 AI 的上下文菜单按钮。",
      suggestedId: "plugin.selection-ask"
    });
    expect(createManagerCapabilityToolCatalog().find(
      (tool) => tool.actionId === "plugin.install_build"
    )).toMatchObject({
      policy: {
        requiresConfirmation: true,
        riskLevel: "high"
      }
    });

    const pending = await executeManagerCapabilityTool({
      actionId: "plugin.install_build",
      arguments: { buildId: "plugin-build-1" },
      toolCallId: "plugin-install-call-1"
    }, {
      describePluginBuildForApproval: (buildId) =>
        pluginBuilder.describeInstallApproval(buildId),
      installPluginBuild: ({ buildId }) => pluginBuilder.install(buildId)
    });
    const confirmation = pending.events.find(
      (event) => event.type === "confirmation_request" && "plan" in event
    );
    expect(confirmation).toMatchObject({
      action: {
        actionId: "plugin.install_build",
        payload: { buildId: "plugin-build-1" }
      },
      plan: {
        summary: expect.stringContaining("Selection Ask")
      }
    });
    expect(transport.activatePlugin).not.toHaveBeenCalled();
    if (!confirmation || confirmation.type !== "confirmation_request" || !("plan" in confirmation)) {
      throw new Error("Expected plugin install confirmation");
    }

    const installed = await executeConfirmedSemanticPlan(confirmation, {
      installPluginBuild: ({ buildId }) => pluginBuilder.install(buildId)
    });
    expect(installed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("已安装插件"),
        type: "assistant_reply"
      })
    ]));
    expect(transport.activatePlugin).toHaveBeenCalledTimes(1);
    expect(extensionRuntime.listExtensions()).toEqual([
      expect.objectContaining({ id: "plugin.selection-ask" })
    ]);
  });

  test("rolls back sandbox activation when Extension Runtime registration fails", async () => {
    const { extensionRuntime, pluginBuilder, transport } = createRuntime();
    await pluginBuilder.build({
      description: "选择 PDF 文本后显示一个可调用 AI 的上下文菜单按钮。"
    });
    extensionRuntime.registerExtension(createSandboxPackage().manifest);

    await expect(pluginBuilder.install("plugin-build-1")).rejects.toThrow(
      "extension_already_registered"
    );
    expect(transport.activatePlugin).not.toHaveBeenCalled();
    expect(pluginBuilder.getBuild("plugin-build-1")).toMatchObject({
      status: "awaiting_approval"
    });
  });

  test("restores installed plugins from audited package references", async () => {
    const store = createMemoryPluginBuilderStore();
    const firstTransport = createTransport();
    const firstExtensionRuntime = createExtensionRuntime({
      invokeHandler: (request) => firstTransport.invokeHandler(request)
    });
    const first = createPluginBuilderRuntime({
      createId: () => "plugin-build-persisted",
      extensionRuntime: firstExtensionRuntime,
      store,
      transport: firstTransport
    });
    await first.build({ description: "选择 PDF 文本后显示一个可调用 AI 的上下文菜单按钮。" });
    await first.install("plugin-build-persisted");

    const restoredTransport = createTransport();
    const restoredExtensionRuntime = createExtensionRuntime({
      invokeHandler: (request) => restoredTransport.invokeHandler(request)
    });
    const restored = createPluginBuilderRuntime({
      extensionRuntime: restoredExtensionRuntime,
      store,
      transport: restoredTransport
    });

    await expect(restored.restore()).resolves.toEqual({ issues: [], restored: 1 });
    expect(restoredTransport.activatePlugin).toHaveBeenCalledTimes(1);
    expect(restoredExtensionRuntime.listExtensions()).toEqual([
      expect.objectContaining({ id: "plugin.selection-ask" })
    ]);
  });
});
