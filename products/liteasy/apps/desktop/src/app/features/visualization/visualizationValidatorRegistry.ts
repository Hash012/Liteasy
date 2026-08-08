import type { VisualizationValidator } from "./visualizationValidator";
import {
  accessibilityReadingOrderValidator,
  evidenceBindingValidator,
  interactionAllowlistValidator,
  resourceLimitsValidator,
  schemaIdentityValidator,
  sourceFigureIdentityValidator,
  stableObjectIdsValidator
} from "./validators/baseValidators";

const validators = new Map<string, VisualizationValidator>();

export function registerVisualizationValidator(validator: VisualizationValidator, aliases: readonly string[] = []): void {
  const ids = [validator.id, ...aliases];
  if (ids.some((id) => validators.has(id))) throw new Error("visualization_validator_already_registered");
  for (const id of ids) validators.set(id, validator);
}

export function getVisualizationValidator(id: string): VisualizationValidator | undefined {
  return validators.get(id);
}

export function hasVisualizationValidator(id: string): boolean {
  return validators.has(id);
}

export function getRegisteredVisualizationValidatorIds(): string[] {
  return [...validators.keys()].sort();
}

export function getVisualizationValidators(ids: readonly string[]): VisualizationValidator[] {
  return ids.map((id) => {
    const validator = getVisualizationValidator(id);
    if (!validator) throw new Error("visualization_validator_not_found");
    return validator;
  });
}

export function validatorsExist(ids: readonly string[]): boolean {
  return ids.every((id) => hasVisualizationValidator(id));
}

const baseVisualizationValidators: readonly VisualizationValidator[] = [
  schemaIdentityValidator,
  evidenceBindingValidator,
  stableObjectIdsValidator,
  interactionAllowlistValidator,
  resourceLimitsValidator,
  sourceFigureIdentityValidator,
  accessibilityReadingOrderValidator
];

for (const validator of baseVisualizationValidators) {
  const aliases = validator.id === "evidence-claims"
    ? ["evidence_claims", "evidence-binding", "evidence_binding", "evidence.claims", "evidence.binding"]
    : validator.id === "schema-identity"
      ? ["artifact-schema", "artifact_schema", "schema_identity", "schema.identity"]
      : validator.id === "stable-object-ids"
        ? ["stable_object_ids"]
        : validator.id === "interaction-allowlist"
          ? ["interaction_allowlist"]
          : validator.id === "resource-limits"
            ? ["resource_limits"]
            : validator.id === "source-figure-identity"
              ? ["source_figure_identity", "source-figure.identity", "source.figure.identity"]
              : ["accessibility_reading_order"];
  registerVisualizationValidator(validator, aliases);
}
