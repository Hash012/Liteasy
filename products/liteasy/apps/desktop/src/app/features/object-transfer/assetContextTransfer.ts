import { z } from "zod";

/** Every library row transfers a locator. The receiver resolves bodies and revisions. */
export const ASSET_CONTEXT_MIME = "application/x-liteasy-asset-context+json";
const identifier = z.string().min(1).max(2048);
const assetContextLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("path"), path: z.string().min(1).max(8192) }),
  z.strictObject({ kind: z.literal("paper-resource"), paperId: identifier,
    resourceKind: z.enum(["extracted_text", "figures", "multimodal"]) }),
]);
const transferSchema = z.strictObject({
  version: z.literal(1), scopeId: identifier, target: assetContextLocatorSchema,
});
export type AssetContextLocator = z.infer<typeof assetContextLocatorSchema>;

export function writeAssetContextTransfer(data: Pick<DataTransfer, "setData">, scopeId: string, target: AssetContextLocator, title: string) {
  data.setData(ASSET_CONTEXT_MIME, JSON.stringify(transferSchema.parse({ version: 1, scopeId, target })));
  data.setData("text/plain", title);
}

export function readAssetContextTransfer(data: Pick<DataTransfer, "getData">, scopeId: string): AssetContextLocator | null {
  const raw = data.getData(ASSET_CONTEXT_MIME);
  if (!raw) return null;
  if (raw.length > 16000) throw new Error("拖入内容过大。");
  const value = transferSchema.parse(JSON.parse(raw));
  if (value.scopeId !== scopeId) throw new Error("此资产属于其他账号，请在当前文献库重新选择。");
  return value.target;
}
