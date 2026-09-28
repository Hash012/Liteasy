import { normalizeLiteratureRecord } from "../../app/features/paper-identity/literatureRecord";
export function confirmedLiterature(title: string, doi = "10.1234/confirmed") {
  return normalizeLiteratureRecord({ title, authors: ["Alice Researcher"], year: 2024,
    literatureId: "confirmed-paper", status: "confirmed", revision: 1,
    identifiers: [{ kind: "doi", source: "public_registry", value: doi }],
    provenance: { mode: "public_registry", provider: "crossref", confirmedAt: "2026-09-28T00:00:00Z" }
  });
}
