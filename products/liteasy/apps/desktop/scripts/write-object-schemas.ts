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
import { assistantConversationSchema, assistantTaskBindingSchema, assistantOriginSchema, assistantTargetSchema } from "../src/app/features/assistant/assistantSessionContracts";
const root = resolve(process.cwd(), "../../packages/shared");
for (const [name, schema] of Object.entries({
  assistantConversation: assistantConversationSchema,
  assistantTaskBinding: assistantTaskBindingSchema,
  assistantOrigin: assistantOriginSchema,
  assistantTarget: assistantTargetSchema,
  object: objectEnvelopeSchema,
  objectRef: objectRefSchema,
  objectAnchor: anchorSchema,
  objectRelation: relationSchema,
  boardPlacement: placementSchema,
  objectTransfer: objectTransferSchema,
  contextRef: contextRefSchema,
})) {
  const version = name.startsWith("assistant") ? "v2" : "v1";
  writeFileSync(
    resolve(root, `${name}.${version}.schema.json`),
    JSON.stringify(
      {
        ...z.toJSONSchema(schema),
        $id: `https://schemas.liteasy.app/${name}.${version}.schema.json`,
      },
      null,
      2,
    ) + "\n",
  );
}
