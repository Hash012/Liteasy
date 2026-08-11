const mappings = Object.freeze([
  ["INTUECHO_ARXIV_ENDPOINT", "arxivEndpoint"],
  ["INTUECHO_CROSSREF_ENDPOINT", "crossrefEndpoint"],
  ["INTUECHO_DBLP_RECORD_ENDPOINT", "dblpRecordEndpoint"],
  ["INTUECHO_DBLP_SEARCH_ENDPOINT", "dblpSearchEndpoint"],
  ["INTUECHO_OPENALEX_API_KEY", "openAlexApiKey"],
  ["INTUECHO_OPENALEX_ENDPOINT", "openAlexEndpoint"],
  ["INTUECHO_OPENREVIEW_ENDPOINT", "openReviewEndpoint"],
  ["INTUECHO_OPENREVIEW_SEARCH_ENDPOINT", "openReviewSearchEndpoint"],
  ["INTUECHO_PMLR_ENDPOINT", "pmlrEndpoint"],
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
