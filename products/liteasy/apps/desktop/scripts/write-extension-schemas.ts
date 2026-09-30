import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { extensionManifestSchema } from "../src/app/features/extensions/extensionPackage";
import { workflowSchema } from "../src/app/features/workflows/workflowDefinition";
import { blockPresentationSchema, structuredBlockSchema } from "../src/app/features/objects/visualBlock.types";
import { extensionSkillSchema } from "../src/app/features/extensions/extensionSkill";
const root = resolve(process.cwd(), "../../packages/shared");
for (const [name, schema] of Object.entries({ "extension.v2": extensionManifestSchema, "compiledWorkflow.v2": workflowSchema, "blockPresentation.v1": blockPresentationSchema, "visualBlock.v1": structuredBlockSchema, "skill.v2": extensionSkillSchema })) {
  writeFileSync(resolve(root, `${name}.schema.json`), JSON.stringify({ ...z.toJSONSchema(schema), $id: `https://schemas.liteasy.app/${name}.schema.json` }, null, 2) + "\n");
}
