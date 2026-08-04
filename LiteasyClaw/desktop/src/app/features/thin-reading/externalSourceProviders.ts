import type { ThinReadingExternalSource } from "./thinReading.types";

type ExternalSourceProvider = ThinReadingExternalSource["provider"];

type ProviderContract = {
  /** Whether a sufficiently descriptive title is enough when the provider supplies no abstract. */
  acceptsMetadataOnly: boolean;
  recordUrl: (sourceId: string) => string;
  validIdentity: (source: Partial<ThinReadingExternalSource>, sourceId: string) => boolean;
};

function isTopicResult(source: Partial<ThinReadingExternalSource>) {
  return source.relation === "topic_search";
}

/**
 * The client-side provenance boundary for every scholarly provider.
 *
 * Keeping it exhaustive means adding a provider to the shared source type cannot silently bypass
 * identity validation: TypeScript requires its contract here, while the reader stays provider
 * agnostic.
 */
export const externalSourceProviderContracts = {
  arxiv: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) => `https://arxiv.org/abs/${sourceId}`,
    validIdentity: (source, sourceId) =>
      /^(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/iu.test(sourceId) &&
      source.arxivId === sourceId &&
      source.url === `https://arxiv.org/abs/${sourceId}` &&
      isTopicResult(source)
  },
  crossref: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) => `https://api.crossref.org/works/${encodeURIComponent(sourceId)}`,
    validIdentity: (source, sourceId) =>
      /^[^\s/]+\/[^\s]+$/u.test(sourceId) &&
      source.doi === `https://doi.org/${sourceId}` &&
      source.url === `https://doi.org/${sourceId}` &&
      isTopicResult(source)
  },
  doaj: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) => `https://doaj.org/article/${encodeURIComponent(sourceId)}`,
    validIdentity: (source, sourceId) =>
      /^[A-Za-z0-9_-]{8,128}$/u.test(sourceId) && isTopicResult(source)
  },
  oapen: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) => `https://library.oapen.org/handle/${sourceId}`,
    validIdentity: (source, sourceId) =>
      /^\d+(?:\.\d+)+\/[^\s/?#]+$/u.test(sourceId) && isTopicResult(source)
  },
  openaire: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) =>
      `https://explore.openaire.eu/search/publication?articleId=${encodeURIComponent(sourceId)}`,
    validIdentity: (source, sourceId) =>
      sourceId.length <= 512 && !/\s/u.test(sourceId) && isTopicResult(source)
  },
  openalex: {
    acceptsMetadataOnly: false,
    recordUrl: (sourceId) => `https://openalex.org/${sourceId}`,
    validIdentity: (_source, sourceId) => /^W\d+$/iu.test(sourceId)
  },
  semantic_scholar: {
    acceptsMetadataOnly: true,
    recordUrl: (sourceId) => `https://www.semanticscholar.org/paper/${sourceId}`,
    validIdentity: (_source, sourceId) => /^[A-Za-z0-9-]{8,128}$/u.test(sourceId)
  }
} satisfies Record<ExternalSourceProvider, ProviderContract>;

export function externalSourceProviderContract(provider: unknown): ProviderContract | null {
  return typeof provider === "string" &&
    Object.prototype.hasOwnProperty.call(externalSourceProviderContracts, provider)
    ? externalSourceProviderContracts[provider as ExternalSourceProvider]
    : null;
}
