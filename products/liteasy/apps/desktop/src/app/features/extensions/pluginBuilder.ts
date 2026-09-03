import {
  getExtensionApiDescriptor,
  getRequiredExtensionPermissions,
  parseExtensionManifest,
  type ExtensionRuntime
} from "./extensionApi";
import type {
  ExtensionHandlerRequest,
  ExtensionHandlerResult,
  ExtensionManifestV1,
  ExtensionPermission
} from "./extensionApi.types";

export const LITEASY_PLUGIN_PACKAGE_VERSION = "liteasy.plugin-package/v1" as const;
export const LITEASY_PLUGIN_BUILDER_SNAPSHOT_VERSION = "liteasy.plugin-builder/v1" as const;

export type PluginBuildRequest = {
  description: string;
  suggestedId?: string;
};

export type PluginPackageFile = {
  path: string;
  sha256: string;
  sizeBytes: number;
};

export type PluginHandlerEntrypoint = {
  exportName: string;
  handlerId: string;
  module: string;
};

export type PluginSandboxTestResult = {
  command: "npm run build" | "npm test";
  durationMs: number;
  exitCode: number;
};

export type SandboxPluginPackage = {
  entrypoints: PluginHandlerEntrypoint[];
  files: PluginPackageFile[];
  manifest: ExtensionManifestV1;
  packageRef: string;
  packageVersion: typeof LITEASY_PLUGIN_PACKAGE_VERSION;
  sandbox: {
    coreSource: "read_only";
    isolated: true;
    networkAccess: "none";
    snapshotId: string;
  };
  tests: PluginSandboxTestResult[];
};

export type PluginAuditFinding = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type PluginCapabilityAudit = {
  auditedAt: string;
  findings: PluginAuditFinding[];
  passed: boolean;
  requestedPermissions: ExtensionPermission[];
  requiredPermissions: ExtensionPermission[];
};

export type PluginBuildRecord = {
  audit: PluginCapabilityAudit;
  buildId: string;
  createdAt: string;
  installationId?: string;
  package: SandboxPluginPackage | null;
  request: PluginBuildRequest;
  status: "audit_failed" | "awaiting_approval" | "installed";
};

export type PluginBuilderSnapshot = {
  builds: PluginBuildRecord[];
  version: typeof LITEASY_PLUGIN_BUILDER_SNAPSHOT_VERSION;
};

export type PluginBuilderStore = {
  load: () => PluginBuilderSnapshot | null | Promise<PluginBuilderSnapshot | null>;
  save: (snapshot: PluginBuilderSnapshot) => void | Promise<void>;
};

export type PluginSandboxTransport = {
  activatePlugin: (input: {
    extensionId: string;
    packageRef: string;
    version: string;
  }) => Promise<{ installationId: string }>;
  buildPlugin: (input: {
    apiDescriptor: ReturnType<typeof getExtensionApiDescriptor>;
    request: PluginBuildRequest;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  deactivatePlugin: (installationId: string) => Promise<void>;
  invokeHandler: (request: ExtensionHandlerRequest) => Promise<ExtensionHandlerResult>;
};

export type PluginBuilderToolDefinition = {
  description: string;
  name: "liteasy_plugin_build" | "liteasy_plugin_list_builds";
  parameters: Record<string, unknown>;
  strict: true;
};

export type PluginBuilderToolInvocation =
  | {
      arguments: PluginBuildRequest;
      name: "liteasy_plugin_build";
      toolCallId: string;
    }
  | {
      arguments: Record<string, never>;
      name: "liteasy_plugin_list_builds";
      toolCallId: string;
    };

export type PluginBuilderToolResult =
  | {
      build: PluginBuildRecord;
      kind: "build";
      nextAction?: {
        actionId: "plugin.install_build";
        arguments: { buildId: string };
      };
    }
  | {
      builds: PluginBuildRecord[];
      kind: "build_list";
    };

export type PluginBuilderRuntime = {
  build: (
    request: PluginBuildRequest,
    options?: { signal?: AbortSignal }
  ) => Promise<PluginBuildRecord>;
  describeInstallApproval: (buildId: string) => string;
  getBuild: (buildId: string) => PluginBuildRecord | null;
  install: (buildId: string) => Promise<string>;
  invokeTool: (
    invocation: PluginBuilderToolInvocation,
    options?: { signal?: AbortSignal }
  ) => Promise<PluginBuilderToolResult>;
  listBuilds: () => PluginBuildRecord[];
  restore: () => Promise<{ issues: string[]; restored: number }>;
  uninstall: (extensionId: string) => Promise<boolean>;
};

const sha256Pattern = /^[a-f0-9]{64}$/;
const packagePathPattern = /^(?:package\.json|src\/[A-Za-z0-9._/-]+|tests\/[A-Za-z0-9._/-]+|assets\/[A-Za-z0-9._/-]+)$/;
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const maxPluginFiles = 200;
const maxPluginFileBytes = 5 * 1024 * 1024;
const maxPluginPackageBytes = 20 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function errorFinding(code: string, message: string): PluginAuditFinding {
  return { code, message, severity: "error" };
}

function parseBuildRequest(value: unknown): PluginBuildRequest {
  if (!isRecord(value)) throw new Error("plugin_build_request_invalid");
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "description" && key !== "suggestedId")) {
    throw new Error("plugin_build_request_unknown_field");
  }
  if (
    typeof value.description !== "string" ||
    value.description.trim().length < 10 ||
    value.description.length > 4_000
  ) {
    throw new Error("plugin_build_request_description_invalid");
  }
  if (
    value.suggestedId !== undefined &&
    (typeof value.suggestedId !== "string" || !/^plugin\.[a-z0-9.-]+$/.test(value.suggestedId))
  ) {
    throw new Error("plugin_build_request_suggested_id_invalid");
  }
  return {
    description: value.description.trim(),
    ...(value.suggestedId ? { suggestedId: value.suggestedId } : {})
  };
}

function safePackagePath(path: string) {
  return packagePathPattern.test(path) &&
    !path.includes("..") &&
    !path.includes("//") &&
    !path.includes("\\") &&
    !path.includes("node_modules") &&
    !path.includes(".git");
}

function parseFile(value: unknown, findings: PluginAuditFinding[]): PluginPackageFile | null {
  if (!isRecord(value)) {
    findings.push(errorFinding("plugin_file_invalid", "插件文件元数据格式无效。"));
    return null;
  }
  const { path, sha256, sizeBytes } = value;
  if (typeof path !== "string" || !safePackagePath(path)) {
    findings.push(errorFinding("plugin_file_path_unsafe", "插件包包含越界或不受支持的文件路径。"));
    return null;
  }
  if (typeof sha256 !== "string" || !sha256Pattern.test(sha256)) {
    findings.push(errorFinding("plugin_file_hash_invalid", `插件文件 ${path} 缺少有效 SHA-256。`));
    return null;
  }
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 0 || (sizeBytes as number) > maxPluginFileBytes) {
    findings.push(errorFinding("plugin_file_size_invalid", `插件文件 ${path} 超出大小限制。`));
    return null;
  }
  return { path, sha256, sizeBytes: sizeBytes as number };
}

function parseEntrypoint(
  value: unknown,
  findings: PluginAuditFinding[]
): PluginHandlerEntrypoint | null {
  if (!isRecord(value)) {
    findings.push(errorFinding("plugin_entrypoint_invalid", "插件 handler 入口格式无效。"));
    return null;
  }
  const { exportName, handlerId, module } = value;
  if (
    typeof exportName !== "string" ||
    !identifierPattern.test(exportName) ||
    typeof handlerId !== "string" ||
    handlerId.length === 0 ||
    typeof module !== "string" ||
    !safePackagePath(module) ||
    !module.startsWith("src/")
  ) {
    findings.push(errorFinding("plugin_entrypoint_invalid", "插件 handler 入口声明无效。"));
    return null;
  }
  return { exportName, handlerId, module };
}

function parseTest(value: unknown, findings: PluginAuditFinding[]): PluginSandboxTestResult | null {
  if (!isRecord(value)) {
    findings.push(errorFinding("plugin_test_result_invalid", "插件测试结果格式无效。"));
    return null;
  }
  const { command, durationMs, exitCode } = value;
  if (
    (command !== "npm test" && command !== "npm run build") ||
    !Number.isFinite(durationMs) ||
    (durationMs as number) < 0 ||
    !Number.isInteger(exitCode)
  ) {
    findings.push(errorFinding("plugin_test_result_invalid", "插件测试命令或结果无效。"));
    return null;
  }
  return {
    command,
    durationMs: durationMs as number,
    exitCode: exitCode as number
  };
}

function samePermissions(left: ExtensionPermission[], right: ExtensionPermission[]) {
  return left.length === right.length && left.every((permission) => right.includes(permission));
}

export function auditSandboxPluginPackage(
  value: unknown,
  options: { now?: () => Date } = {}
): { audit: PluginCapabilityAudit; package: SandboxPluginPackage | null } {
  const findings: PluginAuditFinding[] = [];
  let manifest: ExtensionManifestV1 | null = null;
  if (!isRecord(value)) {
    findings.push(errorFinding("plugin_package_invalid", "沙箱未返回有效插件包。"));
  } else {
    try {
      manifest = parseExtensionManifest(value.manifest);
    } catch (error) {
      findings.push(errorFinding(
        "plugin_manifest_invalid",
        error instanceof Error ? error.message : "插件 manifest 无效。"
      ));
    }
  }

  const requestedPermissions = manifest?.permissions ?? [];
  const requiredPermissions = manifest ? getRequiredExtensionPermissions(manifest) : [];
  if (manifest && !samePermissions(requestedPermissions, requiredPermissions)) {
    findings.push(errorFinding(
      "plugin_permission_not_least_privilege",
      "插件声明的权限必须与实际扩展点和服务调用完全一致。"
    ));
  }

  const files = isRecord(value) && Array.isArray(value.files)
    ? value.files.map((file) => parseFile(file, findings)).filter((file): file is PluginPackageFile => Boolean(file))
    : [];
  if (!isRecord(value) || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > maxPluginFiles) {
    findings.push(errorFinding("plugin_files_invalid", "插件文件列表为空或超过数量限制。"));
  }
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    findings.push(errorFinding("plugin_file_duplicate", "插件包包含重复文件路径。"));
  }
  if (files.reduce((total, file) => total + file.sizeBytes, 0) > maxPluginPackageBytes) {
    findings.push(errorFinding("plugin_package_too_large", "插件包超过 20 MB 限制。"));
  }

  const entrypoints = isRecord(value) && Array.isArray(value.entrypoints)
    ? value.entrypoints
        .map((entrypoint) => parseEntrypoint(entrypoint, findings))
        .filter((entrypoint): entrypoint is PluginHandlerEntrypoint => Boolean(entrypoint))
    : [];
  if (!isRecord(value) || !Array.isArray(value.entrypoints)) {
    findings.push(errorFinding("plugin_entrypoints_invalid", "插件缺少 handler 入口列表。"));
  }
  if (new Set(entrypoints.map((entrypoint) => entrypoint.handlerId)).size !== entrypoints.length) {
    findings.push(errorFinding("plugin_entrypoint_duplicate", "插件包含重复 handler 入口。"));
  }
  if (manifest) {
    const declaredHandlers = new Set(manifest.handlers);
    const entrypointHandlers = new Set(entrypoints.map((entrypoint) => entrypoint.handlerId));
    if (
      declaredHandlers.size !== entrypointHandlers.size ||
      [...declaredHandlers].some((handlerId) => !entrypointHandlers.has(handlerId))
    ) {
      findings.push(errorFinding("plugin_entrypoint_mismatch", "manifest handler 与沙箱入口不一致。"));
    }
    const filePaths = new Set(files.map((file) => file.path));
    if (entrypoints.some((entrypoint) => !filePaths.has(entrypoint.module))) {
      findings.push(errorFinding("plugin_entrypoint_module_missing", "插件入口文件未包含在构建产物中。"));
    }
  }

  const tests = isRecord(value) && Array.isArray(value.tests)
    ? value.tests.map((test) => parseTest(test, findings)).filter((test): test is PluginSandboxTestResult => Boolean(test))
    : [];
  for (const requiredCommand of ["npm test", "npm run build"] as const) {
    const result = tests.find((test) => test.command === requiredCommand);
    if (!result || result.exitCode !== 0) {
      findings.push(errorFinding("plugin_required_test_failed", `${requiredCommand} 未通过。`));
    }
  }

  const sandbox = isRecord(value) && isRecord(value.sandbox) ? value.sandbox : null;
  if (
    !sandbox ||
    sandbox.isolated !== true ||
    sandbox.networkAccess !== "none" ||
    sandbox.coreSource !== "read_only" ||
    typeof sandbox.snapshotId !== "string" ||
    sandbox.snapshotId.length === 0
  ) {
    findings.push(errorFinding(
      "plugin_sandbox_boundary_invalid",
      "构建必须来自隔离、无网络且核心源码只读的沙箱。"
    ));
  }
  if (!isRecord(value) || value.packageVersion !== LITEASY_PLUGIN_PACKAGE_VERSION) {
    findings.push(errorFinding("plugin_package_version_unsupported", "插件包版本不受支持。"));
  }
  if (!isRecord(value) || typeof value.packageRef !== "string" || value.packageRef.length === 0) {
    findings.push(errorFinding("plugin_package_ref_invalid", "插件包缺少可信宿主引用。"));
  }

  const audit: PluginCapabilityAudit = {
    auditedAt: (options.now?.() ?? new Date()).toISOString(),
    findings,
    passed: findings.every((finding) => finding.severity !== "error"),
    requestedPermissions: [...requestedPermissions],
    requiredPermissions: [...requiredPermissions]
  };
  if (!audit.passed || !manifest || !sandbox || !isRecord(value)) {
    return { audit, package: null };
  }
  return {
    audit,
    package: clone({
      entrypoints,
      files,
      manifest,
      packageRef: value.packageRef as string,
      packageVersion: LITEASY_PLUGIN_PACKAGE_VERSION,
      sandbox: {
        coreSource: "read_only",
        isolated: true,
        networkAccess: "none",
        snapshotId: sandbox.snapshotId as string
      },
      tests
    })
  };
}

export function createPluginBuilderToolCatalog(): PluginBuilderToolDefinition[] {
  return [
    {
      description: "在隔离沙箱中生成并测试 Liteasy 插件。成功后只创建待审批构建，不会安装。",
      name: "liteasy_plugin_build",
      parameters: {
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          suggestedId: { type: "string" }
        },
        required: ["description"],
        type: "object"
      },
      strict: true
    },
    {
      description: "列出当前会话已构建、待审批或已安装的插件。",
      name: "liteasy_plugin_list_builds",
      parameters: {
        additionalProperties: false,
        properties: {},
        type: "object"
      },
      strict: true
    }
  ];
}

export function createMemoryPluginBuilderStore(
  initial?: PluginBuilderSnapshot
): PluginBuilderStore {
  let snapshot = initial ? clone(initial) : null;
  return {
    load: () => snapshot ? clone(snapshot) : null,
    save: (next) => {
      snapshot = clone(next);
    }
  };
}

export function createBrowserPluginBuilderStore(): PluginBuilderStore {
  const key = "liteasy.plugin-builder.v1";
  return {
    load() {
      if (typeof localStorage === "undefined") return null;
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) as PluginBuilderSnapshot : null;
    },
    save(snapshot) {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, JSON.stringify(snapshot));
      }
    }
  };
}

export function createPluginBuilderRuntime(options: {
  createId?: () => string;
  extensionRuntime: ExtensionRuntime;
  now?: () => Date;
  store?: PluginBuilderStore;
  transport: PluginSandboxTransport;
}): PluginBuilderRuntime {
  const builds = new Map<string, PluginBuildRecord>();
  const now = options.now ?? (() => new Date());
  const store = options.store ?? createMemoryPluginBuilderStore();
  const createId = options.createId ?? (() => `plugin-build-${crypto.randomUUID()}`);

  async function persist() {
    await store.save({
      builds: [...builds.values()].map(clone),
      version: LITEASY_PLUGIN_BUILDER_SNAPSHOT_VERSION
    });
  }

  async function activate(record: PluginBuildRecord) {
    if (!record.package) throw new Error("plugin_build_package_missing");
    const { manifest, packageRef } = record.package;
    if (options.extensionRuntime.listExtensions().some((candidate) => candidate.id === manifest.id)) {
      throw new Error("extension_already_registered");
    }
    const activated = await options.transport.activatePlugin({
      extensionId: manifest.id,
      packageRef,
      version: manifest.version
    });
    try {
      options.extensionRuntime.registerExtension(manifest);
      record.installationId = activated.installationId;
    } catch (error) {
      await options.transport.deactivatePlugin(activated.installationId).catch(() => undefined);
      throw error;
    }
  }

  const runtime: PluginBuilderRuntime = {
    async build(value, buildOptions = {}) {
      const request = parseBuildRequest(value);
      const sandboxResult = await options.transport.buildPlugin({
        apiDescriptor: getExtensionApiDescriptor(),
        request,
        signal: buildOptions.signal
      });
      const audited = auditSandboxPluginPackage(sandboxResult, { now });
      if (
        request.suggestedId &&
        audited.package &&
        audited.package.manifest.id !== request.suggestedId
      ) {
        audited.audit.findings.push(errorFinding(
          "plugin_suggested_id_mismatch",
          "沙箱产物的插件 ID 与构建请求不一致。"
        ));
        audited.audit.passed = false;
        audited.package = null;
      }
      const record: PluginBuildRecord = {
        audit: audited.audit,
        buildId: createId(),
        createdAt: now().toISOString(),
        package: audited.package,
        request,
        status: audited.audit.passed ? "awaiting_approval" : "audit_failed"
      };
      builds.set(record.buildId, record);
      await persist();
      return clone(record);
    },
    describeInstallApproval(buildId) {
      const record = builds.get(buildId);
      if (!record?.package || record.status !== "awaiting_approval") {
        throw new Error("plugin_build_not_installable");
      }
      const permissionSummary = record.audit.requiredPermissions.join("、") || "无额外权限";
      return `安装插件“${record.package.manifest.name}” ${record.package.manifest.version}；权限：${permissionSummary}。`;
    },
    getBuild(buildId) {
      const record = builds.get(buildId);
      return record ? clone(record) : null;
    },
    async install(buildId) {
      const record = builds.get(buildId);
      if (!record) throw new Error("plugin_build_not_found");
      if (record.status === "installed" && record.package) {
        return `插件“${record.package.manifest.name}”已经安装。`;
      }
      if (!record.package || record.status !== "awaiting_approval") {
        throw new Error("plugin_build_not_installable");
      }
      const reaudited = auditSandboxPluginPackage(record.package, { now });
      if (!reaudited.audit.passed || !reaudited.package) {
        record.audit = reaudited.audit;
        record.package = null;
        record.status = "audit_failed";
        await persist();
        throw new Error("plugin_capability_audit_failed");
      }
      record.audit = reaudited.audit;
      record.package = reaudited.package;
      await activate(record);
      record.status = "installed";
      try {
        await persist();
      } catch (error) {
        options.extensionRuntime.unregisterExtension(record.package.manifest.id);
        if (record.installationId) {
          await options.transport.deactivatePlugin(record.installationId).catch(() => undefined);
        }
        record.status = "awaiting_approval";
        delete record.installationId;
        throw error;
      }
      return `已安装插件“${record.package.manifest.name}” ${record.package.manifest.version}。`;
    },
    async invokeTool(invocation, invokeOptions = {}) {
      if (invocation.name === "liteasy_plugin_list_builds") {
        return { builds: runtime.listBuilds(), kind: "build_list" };
      }
      const build = await runtime.build(invocation.arguments, invokeOptions);
      return {
        build,
        kind: "build",
        ...(build.status === "awaiting_approval"
          ? {
              nextAction: {
                actionId: "plugin.install_build" as const,
                arguments: { buildId: build.buildId }
              }
            }
          : {})
      };
    },
    listBuilds() {
      return [...builds.values()].map(clone);
    },
    async restore() {
      const issues: string[] = [];
      let restored = 0;
      const snapshot = await store.load();
      if (!snapshot) return { issues, restored };
      if (snapshot.version !== LITEASY_PLUGIN_BUILDER_SNAPSHOT_VERSION || !Array.isArray(snapshot.builds)) {
        return { issues: ["plugin_builder_snapshot_invalid"], restored };
      }
      for (const stored of snapshot.builds) {
        if (!stored || typeof stored.buildId !== "string" || !stored.package) {
          issues.push("plugin_builder_record_invalid");
          continue;
        }
        const audited = auditSandboxPluginPackage(stored.package, { now });
        if (!audited.audit.passed || !audited.package) {
          issues.push(`${stored.buildId}:plugin_capability_audit_failed`);
          continue;
        }
        const record: PluginBuildRecord = {
          ...clone(stored),
          audit: audited.audit,
          package: audited.package
        };
        if (
          record.status !== "audit_failed" &&
          record.status !== "awaiting_approval" &&
          record.status !== "installed"
        ) {
          issues.push(`${record.buildId}:plugin_build_status_invalid`);
          continue;
        }
        builds.set(record.buildId, record);
        if (record.status === "installed") {
          try {
            await activate(record);
            restored += 1;
          } catch (error) {
            issues.push(`${record.buildId}:${error instanceof Error ? error.message : "restore_failed"}`);
          }
        }
      }
      await persist();
      return { issues, restored };
    },
    async uninstall(extensionId) {
      const record = [...builds.values()].find(
        (candidate) => candidate.status === "installed" && candidate.package?.manifest.id === extensionId
      );
      if (!record) return false;
      options.extensionRuntime.unregisterExtension(extensionId);
      if (record.installationId) {
        await options.transport.deactivatePlugin(record.installationId);
      }
      record.status = "awaiting_approval";
      delete record.installationId;
      await persist();
      return true;
    }
  };

  return runtime;
}
