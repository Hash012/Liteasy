import type { VisualizationValidator } from "./visualizationValidator";

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
