import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  objectEnvelopeSchema,
  objectRefSchema,
  anchorSchema,
  relationSchema,
  placementSchema,
} from "../src/app/features/objects/object.types";
import { objectTransferSchema } from "../src/app/features/object-transfer/objectTransfer";
import { contextRefSchema } from "../src/app/features/context/objectContext";
const root = resolve(process.cwd(), "../../packages/shared");
for (const [name, schema] of Object.entries({
  object: objectEnvelopeSchema,
  objectRef: objectRefSchema,
  objectAnchor: anchorSchema,
  objectRelation: relationSchema,
  boardPlacement: placementSchema,
  objectTransfer: objectTransferSchema,
  contextRef: contextRefSchema,
})) {
  writeFileSync(
    resolve(root, `${name}.v1.schema.json`),
    JSON.stringify(
      {
        ...z.toJSONSchema(schema),
        $id: `https://schemas.liteasy.app/${name}.v1.schema.json`,
      },
      null,
      2,
    ) + "\n",
  );
}
