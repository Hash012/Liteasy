import {
  objectMetadataSchema,
  parseObject,
  parseObjectLink,
  type ObjectEnvelope,
} from "./object.types";
import type { ObjectRepository } from "./objectRepository";
export type ResolvedObject =
  | { state: "ready" | "partial"; object: ObjectEnvelope }
  | { state: "unsupported"; title: string; text: string; raw: unknown }
  | { state: "missing" | "forbidden" | "error"; message: string };
export function createObjectResolver(repository: ObjectRepository) {
  return {
    async open(link: string): Promise<ResolvedObject> {
      const ref = parseObjectLink(link);
      if (!ref) return { state: "error", message: "内容链接格式不正确。" };
      try {
        const raw = await repository.readRaw(ref);
        const {
          kind: _kind,
          content,
          ...metadata
        } = raw as Record<string, unknown>;
        objectMetadataSchema.parse(metadata);
        try {
          const object = parseObject(raw);
          return {
            state:
              (object.kind === "content.fragment" ||
                object.kind === "conversation.message") &&
              object.content.payload.partial
                ? "partial"
                : "ready",
            object,
          };
        } catch {
          const payload = (content as { payload?: { text?: unknown } })
            ?.payload;
          return {
            state: "unsupported",
            title: String(metadata.title),
            text:
              typeof payload?.text === "string"
                ? payload.text
                : "此内容类型暂不支持展示，可导出原始数据。",
            raw,
          };
        }
      } catch {
        return {
          state: "missing",
          message: "内容在当前账号或设备不可用，请确认账号与本机资源。",
        };
      }
    },
  };
}
