import { getRegisteredActionMetadata } from "../skills/actionRegistry";
import { getComponentCard } from "./componentRegistry";
import { hasDataSource } from "./dataSourceRegistry";
import { hasSpacingToken } from "./designTokenRegistry";
import type { UIDslDocument, UIDslNode, UIDslValidationResult } from "./generativeUi.types";

const bannedPropNames = new Set(["className", "dangerouslySetInnerHTML", "style"]);
const executablePropNamePattern = /^(on[A-Z]|on[a-z]|handler|render|ref)$/;
const executableStringPattern = /(=>|function\s*\(|document\.|window\.|eval\s*\(|<script)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNoBannedProps(props: Record<string, unknown>, path: string, errors: string[]) {
  for (const propName of Object.keys(props)) {
    if (bannedPropNames.has(propName)) {
      errors.push(`Arbitrary style props are not allowed at ${path}.${propName}`);
    }

    const value = props[propName];
    if (
      executablePropNamePattern.test(propName) ||
      (typeof value === "string" && executableStringPattern.test(value))
    ) {
      errors.push(`Executable props are not allowed at ${path}.${propName}`);
    }
  }
}

function validateNoExecutableValues(value: unknown, path: string, errors: string[]) {
  if (typeof value === "string" && executableStringPattern.test(value)) {
    errors.push(`Executable values are not allowed at ${path}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoExecutableValues(item, `${path}[${index}]`, errors));
    return;
  }

  if (isRecord(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (executablePropNamePattern.test(key)) {
        errors.push(`Executable values are not allowed at ${path}.${key}`);
        return;
      }
      validateNoExecutableValues(child, `${path}.${key}`, errors);
    });
  }
}

function getValueType(value: unknown) {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function validatePropSchema(node: UIDslNode, path: string, errors: string[]) {
  const card = getComponentCard(String(node.component));
  if (!card) {
    return;
  }

  const required = card.propSchema.required ?? {};
  const optional = card.propSchema.optional ?? {};
  const allowedProps = new Set([...Object.keys(required), ...Object.keys(optional)]);

  for (const [propName, expectedType] of Object.entries(required)) {
    if (!(propName in node.props)) {
      errors.push(`${path}.props.${propName} is required`);
      continue;
    }

    const actualType = getValueType(node.props[propName]);
    if (actualType !== expectedType) {
      errors.push(`${path}.props.${propName} must be ${expectedType}`);
    }
  }

  for (const [propName, value] of Object.entries(node.props)) {
    if (!allowedProps.has(propName)) {
      errors.push(`Unknown prop at ${path}.props.${propName}`);
      continue;
    }

    const expectedType = required[propName] ?? optional[propName];
    if (expectedType && getValueType(value) !== expectedType) {
      errors.push(`${path}.props.${propName} must be ${expectedType}`);
    }
  }
}

function validateComponentProps(node: UIDslNode, path: string, actionIds: Set<string>, errors: string[]) {
  validateNoBannedProps(node.props, path, errors);
  validatePropSchema(node, path, errors);

  if (node.component === "Stack") {
    const gap = node.props.gap;
    if (gap !== undefined && !hasSpacingToken(gap)) {
      errors.push(`Unknown design token at ${path}.gap`);
    }

    const direction = node.props.direction;
    if (direction !== undefined && direction !== "vertical" && direction !== "horizontal") {
      errors.push(`${path}.props.direction must be vertical or horizontal`);
    }
  }

  if (node.component === "StatusBanner") {
    const tone = node.props.tone;
    if (tone !== "info" && tone !== "success" && tone !== "warning" && tone !== "error") {
      errors.push(`${path}.props.tone must be a registered tone`);
    }
  }

  if (node.component === "ActionBar") {
    const refs = node.props.actionIds;
    if (!Array.isArray(refs)) {
      errors.push(`ActionBar at ${path} requires actionIds`);
      return;
    }

    refs.forEach((actionId) => {
      if (typeof actionId !== "string" || !actionIds.has(actionId)) {
        errors.push(`Unknown ActionRef id at ${path}: ${String(actionId)}`);
      }
    });
  }
}

function validateNode(
  node: UIDslNode,
  surface: UIDslDocument["surface"],
  actionIds: Set<string>,
  path: string,
  errors: string[]
) {
  if (!isRecord(node)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const card = getComponentCard(String(node.component));
  if (!card) {
    errors.push(`Unknown component at ${path}: ${String(node.component)}`);
  } else if (!card.supportedSurfaces.includes(surface)) {
    errors.push(`${node.component} does not support ${surface} surface`);
  }

  if (typeof node.id !== "string" || node.id.length === 0) {
    errors.push(`${path}.id is required`);
  }

  if (!isRecord(node.props)) {
    errors.push(`${path}.props must be an object`);
  } else {
    validateComponentProps(node, path, actionIds, errors);
  }

  node.children?.forEach((child, index) => {
    validateNode(child, surface, actionIds, `${path}.children[${index}]`, errors);
  });
}

export function validateUIDslDocument(document: UIDslDocument): UIDslValidationResult {
  const errors: string[] = [];

  if (!isRecord(document)) {
    return {
      errors: ["UIDslDocument must be an object"],
      valid: false
    };
  }

  if (document.version !== "liteasy-ui-dsl/v1") {
    errors.push("Unsupported UIDslDocument version");
  }

  const registeredActionIds = new Set(
    getRegisteredActionMetadata().map((metadata) => metadata.actionId)
  );
  const actionRefIds = new Set<string>();

  for (const action of document.actions ?? []) {
    if (!registeredActionIds.has(action.actionId)) {
      errors.push(`Unknown registered action: ${String(action.actionId)}`);
    }

    if (typeof action.id !== "string" || action.id.length === 0) {
      errors.push("ActionRef id is required");
    } else {
      actionRefIds.add(action.id);
    }

    if (typeof action.label !== "string" || action.label.length === 0) {
      errors.push(`ActionRef ${String(action.id)} requires label`);
    }
  }

  for (const dataSource of document.dataSources ?? []) {
    if (!hasDataSource(String(dataSource.sourceId))) {
      errors.push(`Unknown data source: ${String(dataSource.sourceId)}`);
    }

    if (!isRecord(dataSource.params)) {
      errors.push(`DataSource ${String(dataSource.id)} params must be an object`);
    } else {
      validateNoExecutableValues(dataSource.params, `dataSources.${String(dataSource.id)}.params`, errors);
    }
  }

  validateNode(document.root, document.surface, actionRefIds, "root", errors);

  return {
    errors,
    valid: errors.length === 0
  };
}
