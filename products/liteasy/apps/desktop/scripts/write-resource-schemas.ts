import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { authoredArtifactSchema } from "../src/app/features/artifact-workflow/authoredArtifact";
import { paperAnchorEntitySchema } from "../src/app/features/paper-anchors/paperAnchorEntity";
import { resourceRefSchema } from "../src/app/features/resource-filesystem/resourceFile.types";
import { authoredResourceFileSchema } from "../src/app/features/resource-filesystem/authoredResourceFile";

const root = resolve(process.cwd(), "../../packages/shared");
for (const [name, schema] of Object.entries({
  authoredArtifact: authoredArtifactSchema,
  authoredResourceFile: authoredResourceFileSchema,
  paperAnchorEntity: paperAnchorEntitySchema,
  resourceRef: resourceRefSchema
})) {
  writeFileSync(resolve(root, `${name}.v1.schema.json`), JSON.stringify({
    ...z.toJSONSchema(schema),
    $id: `https://schemas.liteasy.app/${name}.v1.schema.json`
  }, null, 2) + "\n");
}
