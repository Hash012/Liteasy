import {
  literatureConfirmInputSchema,
  literatureResolveInputSchema
} from "@intuecho/contracts";

const statuses = Object.freeze({
  INVALID_LITERATURE_QUERY: 400,
  INVALID_MANUAL_LITERATURE: 400,
  LITERATURE_CANDIDATE_NOT_FOUND: 404,
  LITERATURE_IDENTITY_CONFLICT: 409,
  LITERATURE_PROVIDER_UNAVAILABLE: 503,
  LITERATURE_RATE_LIMITED: 429
});

export class LiteratureRouteError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = statuses[code] ?? 400;
    this.name = "LiteratureRouteError";
  }
}

function routeUser(request, reply, { currentUser, requireUser }) {
  const current = currentUser(request);
  if (current) return current;
  return requireUser(request, reply);
}

function normalizedError(error, input) {
  if (error?.code === "LITERATURE_CONFIRMATION_INVALID" && input?.mode === "manual") {
    return new LiteratureRouteError("INVALID_MANUAL_LITERATURE");
  }
  if (statuses[error?.code]) return new LiteratureRouteError(error.code);
  throw error;
}

export function registerLiteratureRoutes(app, {
  currentUser,
  rateLimiter,
  requireDesktopUser,
  requireUser,
  resolver
}) {
  if (!app || !currentUser || !rateLimiter || !requireDesktopUser || !requireUser || !resolver) {
    throw new TypeError("literature route dependencies are required");
  }

  async function resolve(request, reply) {
    const user = routeUser(request, reply, { currentUser, requireUser });
    if (!user) return;
    const parsed = literatureResolveInputSchema.safeParse(request.body);
    if (!parsed.success) throw new LiteratureRouteError("INVALID_LITERATURE_QUERY");
    if (!rateLimiter.tryConsume("resolve", user.id)) throw new LiteratureRouteError("LITERATURE_RATE_LIMITED");
    try {
      const result = await resolver.resolve(user, parsed.data);
      if (result?.status === "unavailable") throw new LiteratureRouteError("LITERATURE_PROVIDER_UNAVAILABLE");
      return result;
    } catch (error) {
      throw normalizedError(error, parsed.data);
    }
  }

  async function confirm(request, reply) {
    const user = routeUser(request, reply, { currentUser, requireUser });
    if (!user) return;
    const parsed = literatureConfirmInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new LiteratureRouteError(request.body?.mode === "manual"
        ? "INVALID_MANUAL_LITERATURE"
        : "INVALID_LITERATURE_QUERY");
    }
    if (!rateLimiter.tryConsume("confirm", user.id)) throw new LiteratureRouteError("LITERATURE_RATE_LIMITED");
    try {
      return await resolver.confirm(user, parsed.data);
    } catch (error) {
      throw normalizedError(error, parsed.data);
    }
  }

  app.post("/v1/literature::resolve", resolve);
  app.post("/v1/literature::confirm", confirm);
}
