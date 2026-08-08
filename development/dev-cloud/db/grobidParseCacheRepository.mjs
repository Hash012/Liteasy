function validFingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function createGrobidParseCacheRepository(database) {
  const find = database.prepare(
    "SELECT * FROM grobid_parse_cache WHERE content_fingerprint = ?"
  );
  const upsert = database.prepare(`
    INSERT INTO grobid_parse_cache (
      content_fingerprint, parser_version, tei_xml, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(content_fingerprint) DO UPDATE SET
      parser_version = excluded.parser_version,
      tei_xml = excluded.tei_xml,
      updated_at = excluded.updated_at
  `);

  return {
    get(contentFingerprint) {
      if (!validFingerprint(contentFingerprint)) return undefined;
      const row = find.get(contentFingerprint);
      return row
        ? {
            contentFingerprint: row.content_fingerprint,
            parserVersion: row.parser_version,
            tei: row.tei_xml
          }
        : undefined;
    },

    put({ contentFingerprint, parserVersion, tei }) {
      if (!validFingerprint(contentFingerprint) || !Number.isInteger(parserVersion) ||
        typeof tei !== "string" || !tei.includes("<TEI")) {
        throw new Error("invalid_grobid_cache_payload");
      }
      const now = new Date().toISOString();
      upsert.run(contentFingerprint, parserVersion, tei, now, now);
      return this.get(contentFingerprint);
    }
  };
}

