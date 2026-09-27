import { z } from "zod";
import { objectRefSchema } from "../objects/object.types";
import type { StagedObjectAsset } from "../objects/objectAssets";

const id = z.string().trim().min(1).max(512);
export const paperProjectSchema = z.strictObject({
  schemaVersion: z.literal("liteasy.paper-project/v1"),
  projectId: id,
  paperId: id,
  scopeId: id,
  title: z.string().trim().min(1).max(1000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PaperProject = z.infer<typeof paperProjectSchema>;

export const paperProjectAssetSchema = z.strictObject({
  assetId: id,
  title: z.string().trim().min(1).max(1000),
  kind: z.enum(["text", "image", "note", "board", "artifact", "excerpt"]),
  role: z.enum(["source", "derived", "reference"]),
  ref: objectRefSchema.optional(),
  artifactId: id.optional(),
  page: z.number().int().positive().optional(),
  description: z.string().max(12000).optional(),
}).superRefine((asset, context) => {
  if (!asset.ref && !asset.artifactId) {
    context.addIssue({ code: "custom", message: "项目资产需要有效的内容引用。" });
  }
  if (asset.role === "source" && (!asset.ref || !["text", "image"].includes(asset.kind))) {
    context.addIssue({ code: "custom", message: "论文来源必须引用识别的原文或原图。" });
  }
  if (asset.artifactId && asset.kind !== "artifact") {
    context.addIssue({ code: "custom", message: "产物引用需要使用产物类别。" });
  }
});
export type PaperProjectAsset = z.infer<typeof paperProjectAssetSchema>;

export type PaperProjectSourceInput = {
  assetId: string;
  title: string;
  kind: "text" | "image";
  paperId: string;
  text: string;
  page?: number;
  assets?: StagedObjectAsset[];
  documentHash?: string;
};
