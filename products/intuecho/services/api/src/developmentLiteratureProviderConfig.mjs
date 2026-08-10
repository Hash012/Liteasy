const mappings = Object.freeze([
  ["INTUECHO_ARXIV_ENDPOINT", "arxivEndpoint"],
  ["INTUECHO_CROSSREF_ENDPOINT", "crossrefEndpoint"],
  ["INTUECHO_OPENALEX_API_KEY", "openAlexApiKey"],
  ["INTUECHO_OPENALEX_ENDPOINT", "openAlexEndpoint"],
  ["INTUECHO_SEMANTIC_SCHOLAR_API_KEY", "semanticScholarApiKey"],
  ["INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT", "semanticScholarEndpoint"]
]);

export function loadDevelopmentLiteratureProviderConfig(env = process.env) {
  const config = {};
  for (const [environmentName, configName] of mappings) {
    const value = env[environmentName]?.trim();
    if (value) config[configName] = value;
  }
  return Object.freeze(config);
}
