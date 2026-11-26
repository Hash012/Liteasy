import { z } from "zod";
import { loadStoredAccountSession, getAccountSessionGeneration } from "../account/accountSessionStorage";
import { createPersonalContextClient, type ContextWrite } from "./contextClient";

export function contextTurnAccess(message: string) {
  const capture = /^\s*[$/]liteasy-capture\b/.test(message) || /^\s*(?:请)?(?:把|将)(?:这次|本次|本轮|当前)(?:讨论|对话|进展|认识|理解|想法|选中内容).{0,80}(?:保存|记录)(?:到|进)(?:Liteasy(?:的)?(?:个人上下文)?|个人上下文)[。！!.\s]*$/iu.test(message);
  const read = capture || /^\s*[$/]liteasy-(?:context|papers|research-fit|reframe|connect)\b/.test(message) || /^\s*(?:请)?(?:读取|查看|使用|根据)(?:我的)?(?:Liteasy(?:的)?个人上下文|个人上下文)/iu.test(message);
  return { read, write: capture, scopes: [...new Set(["personal", ...message.matchAll(/project\/[a-z0-9][a-z0-9-]{0,63}/g)].map((value) => typeof value === "string" ? value : value[0]))] };
}
const readSchema = z.object({
  id: z.string().uuid().optional(), query: z.string().max(256).optional(),
  scopes: z.array(z.string()).max(50).optional(),
  kinds: z.array(z.enum(["profile", "understanding", "progress", "idea", "group_background", "reference"])).max(6).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(), maxChars: z.number().int().min(1).max(12000).optional()
}).strict();
export function createContextAgentTools(message: string, createClient = createPersonalContextClient) {
  const access = contextTurnAccess(message);
  const session = loadStoredAccountSession(); const generation = getAccountSessionGeneration();
  const assertCurrent = () => { if (!session || generation !== getAccountSessionGeneration()) throw new Error("请在当前账号重新请求个人上下文操作。"); };
  function scopeAllowed(scope: string) { if (!access.scopes.includes(scope)) throw new Error("本轮没有明确选择此个人上下文归组。"); }
  return { access,
    read: async (args: unknown) => {
      if (!access.read) throw new Error("本轮未明确请求使用个人上下文。");
      assertCurrent(); const value = readSchema.parse(args); const client = createClient(session!);
      for (const scope of value.scopes ?? access.scopes) scopeAllowed(scope);
      const result = value.id ? await client.get(value.id) : await client.query({ schemaVersion: "liteasy.context-api/v1", query: value.query,
        scopes: value.scopes ?? access.scopes, kinds: value.kinds, tags: value.tags, maxChars: value.maxChars ?? 12000 });
      assertCurrent();
      if ("entry" in result) scopeAllowed(result.entry.scopeKey);
      return result;
    },
    write: async (args: unknown) => {
      if (!access.write) throw new Error("本轮未明确授权保存到个人上下文。");
      assertCurrent();
      if (!args || typeof args !== "object" || !("entry" in args) || !("action" in args) || !["create", "update"].includes(String(args.action))) throw new Error("保存需要 create/update 写入契约。");
      const input = args as ContextWrite;
      if (input.action === "delete") throw new Error("此工具不提供删除。");
      scopeAllowed(input.entry.scopeKey);
      if (input.entry.basis !== "agent_summary") throw new Error("AI 整理必须标记为 agent_summary；原文请通过选定资料发布入口保留出处。");
      const result = await createClient(session!).write(input);
      assertCurrent(); return result;
    }
  };
}
