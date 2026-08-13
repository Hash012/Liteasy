import { VisualizationProviderError } from "./visualizationProviderGateway.mjs";

const structuredOutputFallbackStatuses = new Set([400, 422, 500, 502]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function responseText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text;
  if (!Array.isArray(body?.output)) return null;
  for (const output of body.output) {
    if (!Array.isArray(output?.content)) continue;
    for (const content of output.content) {
      if (typeof content?.text === "string" && content.text.trim()) return content.text;
    }
  }
  return null;
}

function usageUnits(value) {
  const usage = object(value);
  if (!usage) return null;
  const units = usage.total_tokens ?? usage.totalTokens ?? usage.units;
  return Number.isSafeInteger(units) && units >= 0 ? units : null;
}

function explicitCost(body) {
  const cost = object(body?.cost);
  const units = usageUnits(body?.usage);
  if (!cost || typeof body?.id !== "string" || !body.id.trim() || body.id.length > 240 ||
    typeof cost.amount !== "number" || !Number.isFinite(cost.amount) || cost.amount < 0 ||
    typeof cost.currency !== "string" || !/^[A-Z]{3}$/.test(cost.currency) || units === null) {
    return null;
  }
  return {
    amount: cost.amount,
    currency: cost.currency,
    providerRequestId: body.id,
    units
  };
}

function structuredPayload(payload) {
  if (!object(payload) || typeof payload.prompt !== "string" || !payload.prompt.trim() ||
    payload.prompt.length > 256 * 1024 || typeof payload.schemaName !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(payload.schemaName) || !object(payload.schema)) {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  return payload;
}

async function jsonResponse(response) {
  if (!response?.ok) throw new VisualizationProviderError("visualization_provider_unavailable");
  try {
    const value = await response.json();
    if (!object(value)) throw new Error("invalid response");
    return value;
  } catch (error) {
    if (error instanceof VisualizationProviderError) throw error;
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
}

async function requestStructuredResponse({ input, model, request, schema, schemaName, url }) {
  const send = (includeFormat) => request(url, {
    body: JSON.stringify({
      input: includeFormat ? input : [
        input,
        "Return exactly one JSON object and no Markdown or code fences.",
        `The JSON object must conform to schema ${schemaName}:`,
        JSON.stringify(schema)
      ].join("\n"),
      model,
      ...(includeFormat ? {
        text: {
          format: { name: schemaName, schema, strict: true, type: "json_schema" }
        }
      } : {})
    }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  let response = await send(true);
  if (structuredOutputFallbackStatuses.has(response?.status)) {
    await response.body?.cancel?.().catch(() => {});
    response = await send(false);
  }
  return response;
}

async function generateStructured({ payload: payloadInput, request, route }) {
  if (typeof request !== "function" || !object(route) || typeof route.model !== "string") {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  const payload = structuredPayload(payloadInput);
  const response = await requestStructuredResponse({
    input: payload.prompt,
    model: route.model,
    request,
    schema: payload.schema,
    schemaName: payload.schemaName,
    url: route.endpoint
  });
  const body = await jsonResponse(response);
  const text = responseText(body);
  if (!text) throw new VisualizationProviderError("visualization_provider_response_invalid");
  const cost = explicitCost(body);
  return { ...(cost ? { cost } : {}), text };
}

function imagePayload(payload) {
  if (!object(payload) || typeof payload.prompt !== "string" || !payload.prompt.trim() || payload.prompt.length > 32_000 ||
    !Number.isSafeInteger(payload.width) || !Number.isSafeInteger(payload.height) || payload.width < 1 || payload.height < 1 ||
    payload.width > 4096 || payload.height > 4096) {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  return payload;
}

async function generateImage({ payload: payloadInput, request, route }) {
  if (typeof request !== "function" || !object(route) || typeof route.model !== "string") {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  const payload = imagePayload(payloadInput);
  const response = await request(route.endpoint, {
    body: JSON.stringify({
      model: route.model,
      output_format: "png",
      prompt: payload.prompt,
      quality: "medium",
      size: `${payload.width}x${payload.height}`
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    responseMaxBytes: 16 * 1024 * 1024
  });
  const body = await jsonResponse(response);
  const encoded = body?.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || encoded.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) {
    throw new VisualizationProviderError("visualization_provider_response_invalid");
  }
  const cost = explicitCost(body);
  return { bytes, ...(cost ? { cost } : {}), mimeType: "image/png" };
}

async function probe({ request, route }) {
  if (typeof request !== "function" || !object(route) || typeof route.model !== "string") {
    throw new VisualizationProviderError("visualization_provider_request_invalid");
  }
  const response = await requestStructuredResponse({
    input: "Return an empty JSON object.",
    model: route.model,
    request,
    schema: { additionalProperties: false, properties: {}, required: [], type: "object" },
    schemaName: "liteasy_visualization_probe",
    url: route.endpoint
  });
  const body = await jsonResponse(response);
  if (!responseText(body)) throw new VisualizationProviderError("visualization_provider_response_invalid");
  return {
    authenticated: true,
    capabilities: ["structured_generation", "validation"],
    reachable: true
  };
}

export const openAiCompatibleVisualizationAdapter = Object.freeze({
  generateImage,
  generateStructured,
  probe
});

export const productionVisualizationProviderAdapters = Object.freeze({
  openai: openAiCompatibleVisualizationAdapter,
  "openai-compatible": openAiCompatibleVisualizationAdapter
});
