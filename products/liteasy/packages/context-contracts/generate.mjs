import { writeFileSync } from "node:fs";
import { contextSchemas } from "./schemas.mjs";

for (const [name, schema] of Object.entries(contextSchemas)) {
  writeFileSync(new URL(`../shared/${name}.v1.schema.json`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
}
