import { validateContext, validateUuid } from "./contextValidation.mjs";
import { apiVersion } from "./contextError.mjs";

export class ContextEntryService {
  constructor(repository) { this.repository = repository; }
  whoami(identity) { return this.repository.whoami(identity); }
  write(identity, input) {
    validateContext("write", input);
    const normalized = { ...input, operationId: validateUuid(input.operationId),
      ...(input.entryId ? { entryId: validateUuid(input.entryId) } : {}),
      ...(input.entry ? { entry: { status: "active", tags: [], sourceRefs: [], attributes: {}, ...input.entry } } : {}) };
    return this.repository.write(identity, normalized);
  }
  get(identity, id) { return this.repository.get(identity, validateUuid(id)); }
  list(identity, filters) { validateContext("filters", filters); return this.repository.list(identity, filters); }
  history(identity, id, filters) { validateContext("filters", filters); return this.repository.history(identity, validateUuid(id), filters); }
  operation(identity, id) { return this.repository.operation(identity, validateUuid(id)); }
  async query(identity, input) {
    validateContext("queryRequest", input);
    const { schemaVersion, maxChars, ...filters } = input;
    const effectiveFilters = { status: "active", ...filters, limit: filters.limit ?? 100 };
    const page = await this.repository.list(identity, effectiveFilters);
    const selectedEntries = []; const omitted = []; let usedChars = 0;
    for (const entry of page.entries) {
      const length = Array.from(entry.title).length + Array.from(entry.bodyMarkdown).length;
      if (usedChars + length <= maxChars) { selectedEntries.push(entry); usedChars += length; }
      else omitted.push({ id: entry.id, revision: entry.revision, scopeKey: entry.scopeKey, kind: entry.kind, title: entry.title, length, reason: "budget" });
    }
    return { schemaVersion: apiVersion, selectedEntries, omitted, generatedAt: new Date().toISOString(),
      filters: effectiveFilters,
      budget: { maxChars, usedChars, unit: "unicode_code_point" }, nextCursor: page.nextCursor };
  }
}
