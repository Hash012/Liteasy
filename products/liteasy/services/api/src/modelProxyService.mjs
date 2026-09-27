import { ModelUpstreamError } from "./modelUpstreamProviders.mjs";

const maximumPromptChars = 240_000;
const maximumOutputChars = 2_000_000;
const maximumSchemaBytes = 64 * 1024;

export class ModelProxyError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ModelProxyError";
    this.code = code;
    this.status = status;
  }
}

function exactFields(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ModelProxyError(code);
  }
}

function outputFormat(value) {
  if (value === undefined) return undefined;
  exactFields(value, new Set(["name", "schema", "strict"]), "model_output_format_invalid");
  if (typeof value.name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.name) ||
    value.strict !== true || !value.schema || typeof value.schema !== "object" || Array.isArray(value.schema)) {
    throw new ModelProxyError("model_output_format_invalid");
  }
  const serialized = JSON.stringify(value.schema);
  if (Buffer.byteLength(serialized, "utf8") > maximumSchemaBytes) {
    throw new ModelProxyError("model_output_format_too_large", 413);
  }
  return {
    name: value.name,
    schema: value.schema,
    strict: true
  };
}

function imageInputs(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) throw new ModelProxyError("model_images_invalid");
  let totalBytes = 0;
  return value.map((image) => {
    exactFields(image, new Set(["mediaType", "base64", "label"]), "model_images_invalid");
    if (typeof image.mediaType !== "string" || !/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType) ||
      typeof image.label !== "string" || image.label.length > 1000 || image.label.includes("\u0000") ||
      typeof image.base64 !== "string" || !image.base64.length)
      throw new ModelProxyError("model_images_invalid");
    if (image.base64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4) throw new ModelProxyError("model_images_too_large", 413);
    if (image.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) throw new ModelProxyError("model_images_invalid");
    const bytes = Buffer.from(image.base64, "base64");
    if (bytes.toString("base64") !== image.base64 || bytes.length < 12) throw new ModelProxyError("model_images_invalid");
    totalBytes += bytes.length;
    if (totalBytes > 5 * 1024 * 1024) throw new ModelProxyError("model_images_too_large", 413);
    const signatureMatches = image.mediaType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image.mediaType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : image.mediaType === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!signatureMatches) throw new ModelProxyError("model_images_invalid");
    return { mediaType: image.mediaType, base64: image.base64, label: image.label };
  });
}

function generationInput(value) {
  exactFields(value, new Set([
    "model", "outputFormat", "prompt", "provider", "requireLive", "source", "images"
  ]), "model_request_invalid");
  if (typeof value.prompt !== "string" || value.prompt.trim().length === 0 || value.prompt.includes("\u0000")) {
    throw new ModelProxyError("model_prompt_invalid");
  }
  if (value.prompt.length > maximumPromptChars) {
    throw new ModelProxyError("model_prompt_too_large", 413);
  }
  if (typeof value.provider !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.provider) ||
    typeof value.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.model) ||
    value.source !== "cloud_proxy" ||
    (value.requireLive !== undefined && typeof value.requireLive !== "boolean")) {
    throw new ModelProxyError("model_request_invalid");
  }
  return {
    model: value.model,
    outputFormat: outputFormat(value.outputFormat),
    prompt: value.prompt,
    provider: value.provider,
    requireLive: value.requireLive === true,
    source: "cloud_proxy",
    ...(value.images !== undefined ? { images: imageInputs(value.images) } : {})
  };
}

function publicResult(answer, provider) {
  return {
    answer,
    execution: {
      backend: "cloud",
      mode: "live",
      provider
    }
  };
}

function publicError(error) {
  if (error instanceof ModelProxyError) return error;
  if (error instanceof ModelUpstreamError) {
    return new ModelProxyError(error.code, error.status);
  }
  return new ModelProxyError("model_provider_unavailable", 503);
}

function providerForRequest(providers, policy, input) {
  if (input.provider !== policy.defaultProvider) {
    throw new ModelProxyError("model_provider_not_allowed", 403);
  }
  const provider = providers[input.provider];
  if (!provider) throw new ModelProxyError("model_provider_unavailable", 503);
  if (input.model !== provider.model) {
    throw new ModelProxyError("model_not_allowed", 403);
  }
  if (input.images?.length && provider.supportsImages !== true) throw new ModelProxyError("model_images_unsupported", 415);
  return provider;
}

export class ModelProxyService {
  constructor({ loadPolicy, logger = console, providers }) {
    this.loadPolicy = loadPolicy;
    this.logger = logger;
    this.providers = providers;
  }

  async #prepare(body) {
    const input = generationInput(body);
    const policy = await this.loadPolicy();
    const provider = providerForRequest(this.providers, policy, input);
    return { input, provider };
  }

  #log(level, event) {
    this.logger[level]?.("[model-proxy]", event);
  }

  async generate(body, context) {
    let input;
    const startedAt = Date.now();
    try {
      const prepared = await this.#prepare(body);
      input = prepared.input;
      const answer = await prepared.provider.generate({ ...input, signal: context.signal });
      if (typeof answer !== "string" || answer.length === 0 || answer.length > maximumOutputChars) {
        throw new ModelUpstreamError(
          "model_provider_response_invalid",
          502,
          `answer length ${typeof answer === "string" ? answer.length : "invalid"}`
        );
      }
      this.#log("info", {
        durationMs: Date.now() - startedAt,
        outputChars: answer.length,
        promptChars: input.prompt.length,
        provider: input.provider,
        status: "completed",
        subjectId: context.subjectId,
        traceId: context.traceId
      });
      return publicResult(answer, input.provider);
    } catch (error) {
      const mapped = publicError(error);
      this.#log("error", {
        code: mapped.code,
        detail: error instanceof ModelUpstreamError ? error.internalDetail : undefined,
        durationMs: Date.now() - startedAt,
        promptChars: input?.prompt.length,
        provider: input?.provider,
        status: "failed",
        subjectId: context.subjectId,
        traceId: context.traceId
      });
      throw mapped;
    }
  }

  async *generateStream(body, context) {
    let input;
    let outputChars = 0;
    const startedAt = Date.now();
    try {
      const prepared = await this.#prepare(body);
      input = prepared.input;
      for await (const delta of prepared.provider.stream({ ...input, signal: context.signal })) {
        if (typeof delta !== "string" || delta.length === 0) continue;
        outputChars += delta.length;
        if (outputChars > maximumOutputChars) {
          throw new ModelUpstreamError(
            "model_provider_response_invalid",
            502,
            `stream output exceeded ${maximumOutputChars} characters`
          );
        }
        yield delta;
      }
      if (outputChars === 0) {
        throw new ModelUpstreamError("model_provider_response_invalid", 502, "stream returned no output");
      }
      this.#log("info", {
        durationMs: Date.now() - startedAt,
        outputChars,
        promptChars: input.prompt.length,
        provider: input.provider,
        status: "completed",
        subjectId: context.subjectId,
        traceId: context.traceId
      });
    } catch (error) {
      const mapped = publicError(error);
      this.#log("error", {
        code: mapped.code,
        detail: error instanceof ModelUpstreamError ? error.internalDetail : undefined,
        durationMs: Date.now() - startedAt,
        promptChars: input?.prompt.length,
        provider: input?.provider,
        status: "failed",
        subjectId: context.subjectId,
        traceId: context.traceId
      });
      throw mapped;
    }
  }
}
