import { objectLink, objectText, type ObjectEnvelope } from "../objects/object.types";
import { compileDocument } from "./documentCompiler";
import { sha256, stableJson, type ExportOptions } from "./documentExport.types";

/** Reader-facing text and exact provenance travel separately through the standard exporter. */
export async function compileObjectDocument(object: ObjectEnvelope, options: Partial<ExportOptions>, signal?: AbortSignal) {
  const literal = (value: string) => value.replace(/([\\`*_[\]<>!|])/g, "\\$1");
  const markdown = `# ${literal(object.title)}\n\n${objectText(object)}\n\n${object.provenance.sourceRefs.length ? "## 来源\n\n" + object.provenance.sourceRefs.map((ref, index) => `- [来源 ${index + 1}](${objectLink(ref)})`).join("\n") : ""}`;
  const document = await compileDocument({ title: object.title, markdown, options, signal,
    sources: [{ identity: object.objectId, revision: object.revision, state: "pinned", sha256: await sha256(stableJson(object)) }] });
  const bytes = new TextEncoder().encode(JSON.stringify({ schema: "liteasy.object-export-provenance/v1", objectId: object.objectId,
    revision: object.revision, updatedAt: object.updatedAt, provenance: object.provenance }, null, 2));
  document.attachments = [{ path: "assets/provenance/object.json", bytes, sha256: await sha256(bytes), mediaType: "application/json" }];
  return document;
}
