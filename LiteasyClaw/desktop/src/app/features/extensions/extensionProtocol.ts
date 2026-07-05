import { getDataSourceCards } from "../generative-ui/dataSourceRegistry";
import { getComponentCards } from "../generative-ui/componentRegistry";
import type { UIDslComponentName, UIDslDataSourceId } from "../generative-ui/generativeUi.types";
import {
  getRegisteredActionMetadata,
  type ActionInvocation,
  type CapabilityFamily,
  type RegisteredActionMetadata
} from "../skills/actionRegistry";
import type { ActionRiskLevel } from "../resources/resourceActionPolicy";

export type ExtensionHandlerContract = {
  actionId: ActionInvocation["actionId"];
  handlerId: string;
  owner: CapabilityFamily;
};

export type ExtensionPolicyContract = {
  requiredContext: string[];
  requiresConfirmation: boolean;
  riskLevel: ActionRiskLevel;
};

export type ExtensionJournalContract = {
  eventTypes: string[];
  replayable: boolean;
};

export type ExtensionTestContract = {
  contractTestIds: string[];
};

export type ExtensionProtocolPackage = {
  capability: RegisteredActionMetadata;
  components?: string[];
  dataSources?: string[];
  handler?: ExtensionHandlerContract;
  journal: ExtensionJournalContract;
  packageId: string;
  policy: ExtensionPolicyContract;
  tests: ExtensionTestContract;
};

export type ExtensionProtocolValidationResult = {
  errors: string[];
  valid: boolean;
};

export type CoreExtensionProtocolCatalog = {
  errors: string[];
  packages: ExtensionProtocolPackage[];
};

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function validateHandler(
  item: ExtensionProtocolPackage,
  errors: string[]
) {
  if (!item.handler) {
    errors.push(`${item.packageId} missing handler contract`);
    return;
  }

  if (item.handler.actionId !== item.capability.actionId) {
    errors.push(`${item.packageId} handler actionId does not match capability`);
  }

  if (item.handler.owner !== item.capability.family) {
    errors.push(`${item.packageId} handler owner does not match capability family`);
  }

  if (item.handler.handlerId.length === 0) {
    errors.push(`${item.packageId} handlerId is required`);
  }
}

function validatePolicy(
  item: ExtensionProtocolPackage,
  errors: string[]
) {
  if (item.policy.riskLevel !== item.capability.riskLevel) {
    errors.push(`${item.packageId} policy riskLevel does not match capability`);
  }

  if (item.policy.requiresConfirmation !== item.capability.requiresConfirmation) {
    errors.push(`${item.packageId} policy confirmation rule does not match capability`);
  }

  if (!sameStringSet(item.policy.requiredContext, item.capability.requiredContext)) {
    errors.push(`${item.packageId} policy requiredContext does not match capability`);
  }
}

function validateJournal(
  item: ExtensionProtocolPackage,
  errors: string[]
) {
  if (!item.journal.replayable) {
    errors.push(`${item.packageId} journal must be replayable`);
  }

  if (item.journal.eventTypes.length === 0) {
    errors.push(`${item.packageId} journal eventTypes are required`);
  }
}

function validateTests(
  item: ExtensionProtocolPackage,
  errors: string[]
) {
  if (item.tests.contractTestIds.length === 0) {
    errors.push(`${item.packageId} tests contractTestIds are required`);
  }
}

function validateRegistryReferences(
  item: ExtensionProtocolPackage,
  errors: string[]
) {
  const knownComponents = new Set(getComponentCards().map((card) => card.component));
  const knownDataSources = new Set(getDataSourceCards().map((card) => card.sourceId));

  for (const component of item.components ?? []) {
    if (!knownComponents.has(component as UIDslComponentName)) {
      errors.push(`${item.packageId} Unknown component: ${component}`);
    }
  }

  for (const sourceId of item.dataSources ?? []) {
    if (!knownDataSources.has(sourceId as UIDslDataSourceId)) {
      errors.push(`${item.packageId} Unknown data source: ${sourceId}`);
    }
  }
}

export function validateExtensionProtocolPackage(
  item: ExtensionProtocolPackage
): ExtensionProtocolValidationResult {
  const errors: string[] = [];

  if (item.packageId.length === 0) {
    errors.push("packageId is required");
  }

  validateHandler(item, errors);
  validatePolicy(item, errors);
  validateJournal(item, errors);
  validateTests(item, errors);
  validateRegistryReferences(item, errors);

  return {
    errors,
    valid: errors.length === 0
  };
}

function createCorePackage(capability: RegisteredActionMetadata): ExtensionProtocolPackage {
  return {
    capability,
    handler: {
      actionId: capability.actionId,
      handlerId: `${capability.actionId}.handler`,
      owner: capability.family
    },
    journal: {
      eventTypes: capability.progressEvents?.length
        ? ["plan_preview", ...capability.progressEvents, "action_executed"]
        : ["plan_preview", "action_executed"],
      replayable: true
    },
    packageId: `${capability.actionId}.extension`,
    policy: {
      requiredContext: [...capability.requiredContext],
      requiresConfirmation: capability.requiresConfirmation,
      riskLevel: capability.riskLevel
    },
    tests: {
      contractTestIds: [`${capability.actionId}.contract`]
    }
  };
}

export function buildCoreExtensionProtocolCatalog(): CoreExtensionProtocolCatalog {
  const packages = getRegisteredActionMetadata().map(createCorePackage);
  const errors = packages.flatMap((item) =>
    validateExtensionProtocolPackage(item).errors
  );

  return {
    errors,
    packages
  };
}
