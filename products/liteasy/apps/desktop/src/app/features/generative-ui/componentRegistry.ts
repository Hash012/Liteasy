import type { UIDslComponentName, UIDslSurface } from "./generativeUi.types";

export type ComponentCard = {
  component: UIDslComponentName;
  propSchema: {
    optional?: Record<string, "array" | "boolean" | "number" | "object" | "string">;
    required?: Record<string, "array" | "boolean" | "number" | "object" | "string">;
  };
  supportedSurfaces: UIDslSurface[];
};

const componentCards: ComponentCard[] = [
  {
    component: "ActionBar",
    propSchema: {
      optional: {
        primaryActionId: "string"
      },
      required: {
        actionIds: "array"
      }
    },
    supportedSurfaces: ["assistant", "center_artifact", "workbench_overlay"]
  },
  {
    component: "ArtifactLauncher",
    propSchema: {
      required: {
        artifactType: "string",
        title: "string"
      }
    },
    supportedSurfaces: ["assistant"]
  },
  {
    component: "CitationList",
    propSchema: {
      required: {
        citations: "array"
      }
    },
    supportedSurfaces: ["assistant", "center_artifact"]
  },
  {
    component: "ComparisonTable",
    propSchema: {
      optional: {
        rows: "array"
      },
      required: {
        title: "string"
      }
    },
    supportedSurfaces: ["center_artifact"]
  },
  {
    component: "EvidenceCard",
    propSchema: {
      optional: {
        confidence: "number"
      },
      required: {
        snippet: "string",
        source: "string",
        title: "string"
      }
    },
    supportedSurfaces: ["assistant", "center_artifact"]
  },
  {
    component: "EvidenceMatrix",
    propSchema: {
      optional: {
        rows: "array"
      },
      required: {
        title: "string"
      }
    },
    supportedSurfaces: ["center_artifact"]
  },
  {
    component: "MindMap",
    propSchema: {
      optional: {
        nodes: "array"
      },
      required: {
        title: "string"
      }
    },
    supportedSurfaces: ["center_artifact"]
  },
  {
    component: "Panel",
    propSchema: {
      optional: {
        longTextStrategy: "string",
        text: "string",
        title: "string"
      }
    },
    supportedSurfaces: ["assistant", "center_artifact", "workbench_overlay"]
  },
  {
    component: "SlideDeck",
    propSchema: {
      optional: {
        slides: "array"
      },
      required: {
        title: "string"
      }
    },
    supportedSurfaces: ["center_artifact"]
  },
  {
    component: "Stack",
    propSchema: {
      optional: {
        direction: "string",
        gap: "string"
      }
    },
    supportedSurfaces: ["assistant", "center_artifact", "workbench_overlay"]
  },
  {
    component: "StatusBanner",
    propSchema: {
      required: {
        text: "string",
        tone: "string"
      }
    },
    supportedSurfaces: ["assistant", "workbench_overlay"]
  },
  {
    component: "TreeOutline",
    propSchema: {
      optional: {
        nodes: "array"
      },
      required: {
        title: "string"
      }
    },
    supportedSurfaces: ["center_artifact"]
  }
];

export function getComponentCards(): ComponentCard[] {
  return componentCards.map((card) => ({
    ...card,
    propSchema: {
      optional: card.propSchema.optional ? { ...card.propSchema.optional } : undefined,
      required: card.propSchema.required ? { ...card.propSchema.required } : undefined
    },
    supportedSurfaces: [...card.supportedSurfaces]
  }));
}

export function getComponentCard(component: string): ComponentCard | undefined {
  return componentCards.find((card) => card.component === component);
}
