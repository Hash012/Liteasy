import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { LocalTesseractRasterOcr } from "./visualizationRasterOcr.mjs";
import { validateAndStoreRasterIllustration } from "./visualizationRasterService.mjs";
import { EnvironmentVisualizationSecretStore } from "./visualizationSecretStore.mjs";
import { VisualizationProviderGateway } from "./visualizationProviderGateway.mjs";
import { productionVisualizationProviderAdapters } from "./visualizationStructuredProviderAdapter.mjs";

const defaultRasterSpec = Object.freeze({
  composition: { aspectRatio: 1, height: 1024, width: 1024 },
  evidenceClaimIds: ["claim-smoke"],
  labels: [{ evidenceClaimIds: ["claim-smoke"], id: "label-cell", text: "CELL" }],
  styleLock: {
    allowTransparency: false,
    palette: ["#ffffff", "#111827", "#0f6cbd"],
    prohibitDecorativeClaims: true,
    typography: "sans-serif"
  },
  visualSchema: "One clean scientific cell diagram with the exact visible label CELL"
});

function parseHostnames(value, routes) {
  if (value?.trim()) return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  return [...new Set(routes.map((route) => new URL(route.endpoint).hostname.toLowerCase()))];
}

function parseRoute(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("visualization_smoke_route_invalid");
  }
}

function configuredRoutes(env) {
  const legacy = env.LITEASY_VISUALIZATION_SMOKE_ROUTE?.trim();
  const structured = env.LITEASY_VISUALIZATION_SMOKE_STRUCTURED_ROUTE?.trim();
  const image = env.LITEASY_VISUALIZATION_SMOKE_IMAGE_ROUTE?.trim();
  const legacyRoute = legacy ? parseRoute(legacy) : null;
  return {
    image: image ? parseRoute(image) : legacyRoute?.operations?.includes("image_generation") ? legacyRoute : null,
    structured: structured ? parseRoute(structured) : legacyRoute?.operations?.includes("structured_generation") ? legacyRoute : null
  };
}

function immutableSmokeStore() {
  return {
    async putImmutableObject(bytes, options) {
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(contentHash, options.contentHash);
      assert.equal(options.mediaType, "image/png");
      return {
        byteLength: bytes.byteLength,
        contentHash,
        mediaType: options.mediaType,
        storageKey: `smoke/${contentHash}`
      };
    }
  };
}

export async function runVisualizationProviderSmoke(env = process.env, dependencies = {}) {
  const routes = configuredRoutes(env);
  const configured = [routes.structured, routes.image].filter(Boolean);
  if (configured.length === 0) {
    if (env.LITEASY_VISUALIZATION_SMOKE_REQUIRED === "1") {
      throw new Error("visualization_provider_smoke_configuration_required");
    }
    return Object.freeze({
      reason: "LITEASY_VISUALIZATION_SMOKE_STRUCTURED_ROUTE or LITEASY_VISUALIZATION_SMOKE_IMAGE_ROUTE",
      status: "skipped_configuration"
    });
  }

  const gateway = dependencies.gateway ?? new VisualizationProviderGateway({
    adapters: productionVisualizationProviderAdapters,
    egressPolicy: {
      allowedHostnames: parseHostnames(env.LITEASY_VISUALIZATION_EGRESS_HOSTNAMES, configured)
    },
    secretStore: new EnvironmentVisualizationSecretStore(env)
  });
  const operations = {};
  if (routes.structured) {
    const result = await gateway.generateStructured({
      dataClass: env.LITEASY_VISUALIZATION_SMOKE_DATA_CLASS?.trim() || "paper",
      invocationId: "smoke_structured_generation",
      modality: env.LITEASY_VISUALIZATION_SMOKE_MODALITY?.trim() || "raster_illustration",
      payload: {
        prompt: "Return exactly one JSON object whose status field is the string ok.",
        schema: {
          additionalProperties: false,
          properties: { status: { const: "ok", type: "string" } },
          required: ["status"],
          type: "object"
        },
        schemaName: "liteasy_visualization_live_smoke_v1"
      },
      route: routes.structured
    });
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new Error("visualization_smoke_structured_output_invalid");
    }
    if (parsed?.status !== "ok" || Object.keys(parsed).length !== 1) {
      throw new Error("visualization_smoke_structured_output_invalid");
    }
    operations.structuredGeneration = {
      providerId: routes.structured.providerId,
      responseSha256: createHash("sha256").update(result.text).digest("hex"),
      routeId: routes.structured.routeId
    };
  }
  if (routes.image) {
    const spec = dependencies.rasterSpec ?? defaultRasterSpec;
    const image = await gateway.generateImage({
      dataClass: env.LITEASY_VISUALIZATION_SMOKE_DATA_CLASS?.trim() || "paper",
      invocationId: "smoke_image_generation",
      modality: "raster_illustration",
      payload: {
        height: spec.composition.height,
        prompt: [
          spec.visualSchema,
          `Render the exact visible labels: ${spec.labels.map(({ text }) => text).join(", ")}.`,
          "Do not add any other words, logos, signatures, or watermarks."
        ].join("\n"),
        width: spec.composition.width
      },
      route: routes.image
    });
    const asset = await validateAndStoreRasterIllustration({
      image,
      objectStore: dependencies.objectStore ?? immutableSmokeStore(),
      ocr: dependencies.ocr ?? new LocalTesseractRasterOcr(),
      sourceIdentityHashes: [],
      spec
    });
    operations.imageGeneration = {
      assetSha256: asset.sha256,
      byteLength: asset.byteLength,
      height: asset.height,
      providerId: routes.image.providerId,
      routeId: routes.image.routeId,
      verifiedLabelIds: asset.labelVerification.verifiedLabelIds,
      width: asset.width
    };
  }
  return Object.freeze({ operations: Object.freeze(operations), status: "pass" });
}

test("visualization provider smoke runs only with explicit route configuration", async (t) => {
  const result = await runVisualizationProviderSmoke();
  t.diagnostic(JSON.stringify({
    status: result.status,
    test: "visualization_provider_smoke",
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.operations ? { operations: result.operations } : {})
  }));

  if (result.status === "skipped_configuration") {
    assert.match(result.reason, /LITEASY_VISUALIZATION_SMOKE_/);
    return;
  }
  assert.equal(result.status, "pass");
  assert.ok(result.operations.structuredGeneration || result.operations.imageGeneration);
});

test("required provider smoke fails closed without live route configuration", async () => {
  await assert.rejects(
    () => runVisualizationProviderSmoke({ LITEASY_VISUALIZATION_SMOKE_REQUIRED: "1" }),
    /visualization_provider_smoke_configuration_required/
  );
});

test("configured smoke derives structured and raster results from real gateway outputs", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADklEQVR4nGP4DwUMMAYAj4IP8TylVlEAAAAASUVORK5CYII=", "base64");
  const calls = [];
  const result = await runVisualizationProviderSmoke({
    LITEASY_VISUALIZATION_SMOKE_IMAGE_ROUTE: JSON.stringify({
      endpoint: "https://image.example/v1/images/generations",
      operations: ["image_generation"],
      providerId: "image-provider",
      routeId: "image-route"
    }),
    LITEASY_VISUALIZATION_SMOKE_STRUCTURED_ROUTE: JSON.stringify({
      endpoint: "https://structured.example/v1/responses",
      operations: ["structured_generation"],
      providerId: "structured-provider",
      routeId: "structured-route"
    })
  }, {
    gateway: {
      async generateImage(input) {
        calls.push(input);
        return { bytes: png, mimeType: "image/png" };
      },
      async generateStructured(input) {
        calls.push(input);
        return { text: "{\"status\":\"ok\"}" };
      }
    },
    ocr: { engine: "fixture-ocr/v1", async recognize() { return { text: "CELL" }; } },
    rasterSpec: {
      ...defaultRasterSpec,
      composition: { aspectRatio: 1, height: 2, width: 2 }
    }
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(calls.map(({ invocationId }) => invocationId), [
    "smoke_structured_generation",
    "smoke_image_generation"
  ]);
  assert.equal(result.operations.imageGeneration.verifiedLabelIds[0], "label-cell");
  assert.match(result.operations.structuredGeneration.responseSha256, /^[a-f0-9]{64}$/);
});
