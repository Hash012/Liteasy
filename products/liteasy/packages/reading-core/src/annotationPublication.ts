/** Local ownership and session fence. Never a server authorization claim. */
export type PublicationActorBinding = {
  endpoint: string;
  issuer: string;
  subject: string;
  scopeType: "user" | "organization";
  scopeId: string;
  sessionGeneration: string;
};

function publicationEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function normalizePublicationActorBinding(value: unknown): PublicationActorBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<PublicationActorBinding>;
  const endpoint = publicationEndpoint(candidate.endpoint);
  const issuer = publicationEndpoint(candidate.issuer);
  if (!endpoint || !issuer ||
    typeof candidate.subject !== "string" || !candidate.subject.trim() ||
    (candidate.scopeType !== "user" && candidate.scopeType !== "organization") ||
    typeof candidate.scopeId !== "string" || !candidate.scopeId.trim() ||
    typeof candidate.sessionGeneration !== "string" || !candidate.sessionGeneration.trim()) return undefined;
  return { endpoint, issuer, subject: candidate.subject, scopeType: candidate.scopeType,
    scopeId: candidate.scopeId, sessionGeneration: candidate.sessionGeneration };
}

export function samePublicationActor(
  left: unknown,
  right: unknown,
  { includeGeneration = true }: { includeGeneration?: boolean } = {}
) {
  const first = normalizePublicationActorBinding(left);
  const second = normalizePublicationActorBinding(right);
  return Boolean(first && second && first.endpoint === second.endpoint && first.issuer === second.issuer &&
    first.subject === second.subject && first.scopeType === second.scopeType && first.scopeId === second.scopeId &&
    (!includeGeneration || first.sessionGeneration === second.sessionGeneration));
}

type ForumAnnotationPublicationOperationBase = {
  annotationId: string;
  queueKey: string;
  revision: number;
  updatedAt: string;
};

export type ForumAnnotationPublicationOperation =
  | (ForumAnnotationPublicationOperationBase & {
      body: string;
      literatureId: string;
      operation: "upsert";
      sourcePassage: {
        anchorHash: string;
        excerpt: string;
        page?: number;
        rects: Array<{ height: number; left: number; top: number; width: number }>;
      };
    })
  | (ForumAnnotationPublicationOperationBase & {
      operation: "retract";
      remoteAnnotationId: string;
    });
