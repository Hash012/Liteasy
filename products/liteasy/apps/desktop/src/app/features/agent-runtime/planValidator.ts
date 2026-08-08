import type { JsonSchema, JsonSchemaType, RegisteredActionMetadata } from "../skills/actionRegistry";
import type { AssistantMode } from "./agentRuntime.types";
import type { SemanticActionPlan } from "./agentRuntime.types";

export type SemanticPlanValidationResult = {
  errors: string[];
  valid: boolean;
};

type ValidateSemanticActionPlanInput = {
  mode: AssistantMode;
  registeredActions: RegisteredActionMetadata[];
};

function getValueType(value: unknown) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function getAllowedTypes(schema: JsonSchema): readonly JsonSchemaType[] {
  if (Array.isArray(schema.type)) {
    return schema.type;
  }

  return [schema.type as JsonSchemaType];
}

function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[]
) {
  const actualType = getValueType(value);
  const allowedTypes = getAllowedTypes(schema);
  if (!allowedTypes.includes(actualType as JsonSchemaType)) {
    errors.push(`${path} must be ${allowedTypes.join(" or ")}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.map(String).join(", ")}`);
    return;
  }

  if (allowedTypes.includes("array")) {
    if (schema.items && Array.isArray(value)) {
      value.forEach((item, index) => {
        validateJsonSchema(item, schema.items as JsonSchema, `${path}[${index}]`, errors);
      });
    }
    return;
  }

  if (!allowedTypes.includes("object")) {
    return;
  }

  const objectValue = value as Record<string, unknown>;
  for (const requiredKey of schema.required ?? []) {
    if (!(requiredKey in objectValue)) {
      errors.push(`${path}.${requiredKey} is required`);
    }
  }

  for (const [key, childValue] of Object.entries(objectValue)) {
    const childSchema = schema.properties?.[key];
    if (!childSchema) {
      errors.push(`${path}.${key} is not allowed`);
      continue;
    }

    validateJsonSchema(childValue, childSchema, `${path}.${key}`, errors);
  }
}

export function validateSemanticActionPlan(
  plan: SemanticActionPlan,
  input: ValidateSemanticActionPlanInput
): SemanticPlanValidationResult {
  const errors: string[] = [];
  const metadataByActionId = new Map(
    input.registeredActions.map((action) => [action.actionId, action])
  );

  if (input.mode !== "command" && plan.actions.length > 0) {
    errors.push("Only command mode can execute actions");
  }

  for (const action of plan.actions) {
    const metadata = metadataByActionId.get(action.actionId);
    if (!metadata) {
      errors.push(`Unknown action: ${action.actionId}`);
      continue;
    }

    validateJsonSchema(action.input, metadata.inputSchema, action.actionId, errors);
  }

  for (const candidate of plan.clarification?.candidates ?? []) {
    const metadata = metadataByActionId.get(candidate.actionId);
    if (!metadata) {
      errors.push(`Unknown clarification candidate: ${candidate.actionId}`);
      continue;
    }

    validateJsonSchema(
      candidate.input,
      metadata.inputSchema,
      `clarification.${candidate.actionId}`,
      errors
    );
  }

  return {
    errors,
    valid: errors.length === 0
  };
}
