import { useEffect, useState } from "react";
import type {
  LiteratureIdentifier,
  LiteratureRelationsResult,
  LiteratureVersionRelation
} from "../paper-identity/literature.types";

type LiteratureVersionRelationsProps = {
  literatureId: string;
  loadRelations?: (literatureId: string) => Promise<LiteratureRelationsResult>;
};

const identifierLabels: Record<LiteratureIdentifier["kind"], string> = {
  arxiv_id: "arXiv",
  doi: "DOI",
  openalex_id: "OpenAlex",
  semantic_scholar_id: "Semantic Scholar",
  title_authors_year_hash: "候选别名"
};

function relationLabel(version: LiteratureVersionRelation) {
  if (version.relation.relationType === "is_preprint_of") {
    return version.direction === "from_current" ? "已有正式发表版" : "关联预印本";
  }
  if (version.relation.relationType === "translation_of") {
    return version.direction === "from_current" ? "关联译本" : "原始版本";
  }
  return "关联版本";
}

function preferredIdentifier(identifiers: LiteratureIdentifier[]) {
  return identifiers.find((identifier) => identifier.kind === "doi")
    ?? identifiers.find((identifier) => identifier.kind === "arxiv_id")
    ?? identifiers.find((identifier) => identifier.kind === "openalex_id")
    ?? identifiers.find((identifier) => identifier.kind === "semantic_scholar_id")
    ?? identifiers[0];
}

export function LiteratureVersionRelations({
  literatureId,
  loadRelations
}: LiteratureVersionRelationsProps) {
  const [result, setResult] = useState<LiteratureRelationsResult | null>(null);

  useEffect(() => {
    if (!loadRelations) return;
    let active = true;
    setResult(null);
    void loadRelations(literatureId).then((value) => {
      if (active && value.literatureId === literatureId) setResult(value);
    }).catch(() => {
      if (active) setResult(null);
    });
    return () => {
      active = false;
    };
  }, [literatureId, loadRelations]);

  if (!loadRelations || !result?.versions.length) return null;

  return (
    <section aria-label="关联文献版本" className="literature-version-relations">
      {result.versions.map((version) => {
        const identifier = preferredIdentifier(version.literature.identifiers);
        return (
          <article className="literature-version-relation" key={`${version.relation.relationType}:${version.literature.literatureId}`}>
            <strong>{relationLabel(version)}</strong>
            <span>{version.literature.title}</span>
            {identifier ? (
              <span className="literature-version-identifier">
                {identifierLabels[identifier.kind]} {identifier.value}
              </span>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
