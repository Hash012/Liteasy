import { comparisonContent } from "./comparisonContent";
import { parseDataSchema, validateSchemaValue, type JsonObject, type JsonValue } from "../extensions/extensionSchema";
import { operationCatalog, type OperationId } from "./operationCatalog";
/** Shared deterministic evaluator; it cannot obtain storage, grants, models or network handles. */
export function evaluatePureOperation(operation: OperationId, value: JsonObject): JsonValue {
  if (operationCatalog[operation].effect !== "pure" || operation === "core.wait") throw new Error("该操作不能以纯计算方式重算。");
  const args = operationCatalog[operation].input.parse(value) as JsonObject;
  switch (operation) {
    case "core.comparison": return comparisonContent(args.value, args.evidence as JsonValue[], args.cardType as { id: string; version: string });
    case "core.value": case "core.end": return args.value;
    case "core.join": return args.values;
    case "core.branch": return JSON.stringify(args.value) === JSON.stringify(args.equals);
    case "core.template": return String(args.template).replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, key: string) => { const item = (args.values as JsonObject)[key]; if (item === undefined) throw new Error(`模板缺少值：${key}`); return typeof item === "string" ? item : JSON.stringify(item); });
    case "core.validate": return validateSchemaValue(parseDataSchema(args.schema), args.value);
    default: throw new Error("纯操作未登记。");
  }
}
