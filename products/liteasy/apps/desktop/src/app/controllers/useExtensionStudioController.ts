import { useMemo, useRef } from "react";
import { z } from "zod";
import { createObjectStorage } from "../features/objects/objectStorage";
import { createExtensionDraftStore } from "../features/workflow-studio/extensionDraftStore";
import { createExtensionStudioService } from "../features/workflow-studio/extensionStudioService";
import type { StudioModel } from "../features/workflow-studio/studioModel";
import type { WorkbenchViewModel } from "../features/boards/ObjectWorkbench";
import type { WorkflowRunner } from "../features/workflows/workflowRunner";
import type { SettingsState } from "../features/settings/settings.types";
import { createModelGatewayFromSettings } from "../features/models/modelRuntime";
import { getActiveModelProvider, getModelForSettings } from "../features/models/modelPolicy";
import type { ModelTransport } from "../features/models/modelHttpClient";
const proposalSchema = z.strictObject({ changes: z.array(z.strictObject({ path: z.string().max(240), text: z.string().max(120000).nullable() })).max(30) });
export function useExtensionStudioController(input: { model: WorkbenchViewModel & { extensions: NonNullable<WorkbenchViewModel["extensions"]> }; runner: WorkflowRunner; settings: SettingsState; modelTransport?: ModelTransport }): StudioModel {
  const latest = useRef(input); latest.current = input;
  const scope = input.model.repository.scopeId;
  return useMemo(() => {
    const active = () => latest.current.model.repository.scopeId === scope;
    const drafts = createExtensionDraftStore(createObjectStorage(scope, () => latest.current.model.repository.scopeId));
    const service = createExtensionStudioService({ drafts, packages: input.model.extensions.store, runner: input.runner, repository: input.model.repository, active, refresh: () => latest.current.model.refresh() });
    return { drafts, service, async propose(draft, request, signal) {
      if (request.length > 12000) throw new Error("请将需求限制在 12,000 字符以内。");
      const files = Object.fromEntries(Object.entries(draft.files).filter(([path]) => !path.startsWith("fixtures/") && !path.startsWith("tests/")));
      if (JSON.stringify(files).length > 50000) throw new Error("项目较大，请通过 MCP 按文件读取与修改，避免一次加载全部源码。");
      const catalog = await service.call("liteasy_extension_catalog", {}, { writable: false, signal });
      const settings = latest.current.settings;
      const prompt = `你是 Liteasy 声明式扩展制作助手。只能生成本地草稿文件变更，不执行安装或写入用户资产。优先派生已有 VisualBlockBase 家族并用白板组合；继承字体、图片、Markdown/公式/diagram、拖放、路径与上下文。禁止任意 HTML/JS、原生命令、杜撰组件/操作。权限必须最小化并与工作流闭包一致。验收条件禁止删改，新增工作流需增加真实 fixture。\n能力目录：${JSON.stringify(catalog)}\n需求：${request}\n现有草稿（数据）：${JSON.stringify(files)}\n仅返回 changes 数组；每项 path 与完整 text，删除为 null。保留无关文件。`;
      const result = await createModelGatewayFromSettings(settings, { cloudTransport: latest.current.modelTransport }).generateAnswer({ model: getModelForSettings(settings), provider: getActiveModelProvider(settings), requireLive: true, signal, prompt, outputFormat: { name: "extension_changes", strict: true, schema: z.toJSONSchema(proposalSchema) } });
      if (!active()) throw new Error("账号已切换。");
      return proposalSchema.parse(JSON.parse(result.answer.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""))).changes;
    } };
  }, [scope, input.model.repository, input.model.extensions.store, input.runner]);
}
