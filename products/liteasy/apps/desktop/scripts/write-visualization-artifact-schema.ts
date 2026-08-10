import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createVisualizationArtifactJsonSchema } from "../src/app/features/visualization/visualizationArtifact.schema";

const outputPath = fileURLToPath(new URL(
  "../../../packages/shared/visualizationArtifact.v1.schema.json",
  import.meta.url
));
const schema = createVisualizationArtifactJsonSchema();

await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
