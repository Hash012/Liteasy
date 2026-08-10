import { Button, Select } from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  CopyRegular,
  DocumentAddRegular,
  DocumentArrowDownRegular,
  OpenRegular
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import type {
  LiteratureIdentifier,
  LiteratureRecord,
  LiteratureRelationsResult,
  LiteratureVersionRelation
} from "../paper-identity/literature.types";
import {
  createLiteratureCitationExport,
  literatureProviderLabel,
  preferredCitationLiterature,
  relationEvidenceLabel
} from "./literatureVersioning";

type LiteratureVersionRelationsProps = {
  copyText?: (value: string) => Promise<void>;
  currentLiterature: LiteratureRecord;
  loadRelations?: (literatureId: string) => Promise<LiteratureRelationsResult>;
  onAcquireVersion?: (
    literature: LiteratureRecord,
    relation: LiteratureVersionRelation["relation"]
  ) => Promise<{ created: boolean; documentId: string } | void>;
  onOpenVersion?: (literature: LiteratureRecord, relation: LiteratureVersionRelation["relation"]) => void | Promise<void>;
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

async function defaultCopyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error("当前环境无法写入剪贴板。");
  await navigator.clipboard.writeText(value);
}

export function LiteratureVersionRelations({
  copyText = defaultCopyText,
  currentLiterature,
  loadRelations,
  onAcquireVersion,
  onOpenVersion
}: LiteratureVersionRelationsProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<LiteratureRelationsResult | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [citationLiteratureId, setCitationLiteratureId] = useState(currentLiterature.literatureId);
  const [pendingAcquisitionId, setPendingAcquisitionId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    if (!loadRelations) return;
    let active = true;
    setResult(null);
    setLoadState("loading");
    setActionMessage("");
    void loadRelations(currentLiterature.literatureId).then((value) => {
      if (!active || value.literatureId !== currentLiterature.literatureId) return;
      setResult(value);
      setCitationLiteratureId(preferredCitationLiterature(currentLiterature, value.versions).literatureId);
      setLoadState("ready");
    }).catch(() => {
      if (active) setLoadState("error");
    });
    return () => {
      active = false;
    };
  }, [currentLiterature, loadRelations, reloadKey]);

  const citationOptions = useMemo(() => {
    const options = [
      { label: "当前版本", record: currentLiterature },
      ...(result?.versions.map((version) => ({
        label: relationLabel(version),
        record: version.literature
      })) ?? [])
    ];
    return [...new Map(options.map((option) => [option.record.literatureId, option])).values()];
  }, [currentLiterature, result]);
  const citationLiterature = citationOptions.find((option) => option.record.literatureId === citationLiteratureId)?.record
    ?? currentLiterature;

  if (!loadRelations) return null;

  async function copyCitation(format: "citation" | "bibtex") {
    setActionMessage("");
    try {
      const citationExport = createLiteratureCitationExport({
        current: currentLiterature,
        format,
        selectedLiteratureId: citationLiteratureId,
        versions: result?.versions ?? []
      });
      await copyText(citationExport.text);
      setActionMessage(format === "bibtex" ? "BibTeX 已复制" : "引用已复制");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "引用复制失败，请重试。");
    }
  }

  async function acquireVersion(version: LiteratureVersionRelation) {
    if (!onAcquireVersion || pendingAcquisitionId) return;
    setPendingAcquisitionId(version.literature.literatureId);
    setActionMessage("正在加入文献库");
    try {
      const acquired = await onAcquireVersion(version.literature, version.relation);
      setActionMessage(acquired?.created === false ? "该版本已在文献库中" : "已加入文献库");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "关联版本加入失败，请重试。");
    } finally {
      setPendingAcquisitionId(null);
    }
  }

  return (
    <section aria-label="关联文献版本" className="literature-version-relations">
      {loadState === "loading" ? (
        <div className="literature-version-state" role="status">正在加载版本关系</div>
      ) : null}
      {loadState === "error" ? (
        <div className="literature-version-state literature-version-error" role="status">
          <span>版本关系加载失败</span>
          <Button
            appearance="subtle"
            aria-label="重试加载版本关系"
            icon={<ArrowClockwiseRegular />}
            onClick={() => setReloadKey((current) => current + 1)}
            size="small"
            title="重试加载版本关系"
          />
        </div>
      ) : null}
      {loadState === "ready" && result?.versions.length === 0 ? (
        <div className="literature-version-state">暂无已确认的关联版本</div>
      ) : null}
      {result?.versions.map((version) => {
        const identifier = preferredIdentifier(version.literature.identifiers);
        return (
          <article className="literature-version-relation" key={`${version.relation.relationType}:${version.literature.literatureId}`}>
            <div className="literature-version-heading">
              <strong>{relationLabel(version)}</strong>
              <div className="literature-version-actions">
                {onAcquireVersion ? (
                  <Button
                    appearance="subtle"
                    aria-label={`将 ${version.literature.title} 加入文献库`}
                    disabled={pendingAcquisitionId !== null}
                    icon={<DocumentAddRegular />}
                    onClick={() => void acquireVersion(version)}
                    size="small"
                    title={pendingAcquisitionId === version.literature.literatureId
                      ? "正在加入文献库"
                      : `将 ${version.literature.title} 加入文献库`}
                  />
                ) : null}
                {onOpenVersion ? (
                  <Button
                    appearance="subtle"
                    aria-label={`打开 ${version.literature.title}`}
                    icon={<OpenRegular />}
                    onClick={() => void Promise.resolve(onOpenVersion(version.literature, version.relation)).catch((error) => {
                      setActionMessage(error instanceof Error ? error.message : "关联版本打开失败。");
                    })}
                    size="small"
                    title={`打开 ${version.literature.title}`}
                  />
                ) : null}
              </div>
            </div>
            <span>{version.literature.title}</span>
            {identifier ? (
              <span className="literature-version-identifier">
                {identifierLabels[identifier.kind]} {identifier.value}
              </span>
            ) : null}
            <span className="literature-version-evidence">
              来源：{literatureProviderLabel(version.relation.provider)} · 已确认
            </span>
            <span className="literature-version-evidence">
              证据：{relationEvidenceLabel(version.relation.evidence)}
            </span>
          </article>
        );
      })}
      {loadState === "ready" ? (
        <div className="literature-citation-export">
          <Select
            aria-label="引用版本"
            onChange={(event) => setCitationLiteratureId(event.target.value)}
            size="small"
            value={citationLiterature.literatureId}
          >
            {citationOptions.map((option) => (
              <option key={option.record.literatureId} value={option.record.literatureId}>
                {option.label} · {option.record.title}
              </option>
            ))}
          </Select>
          <div className="literature-citation-actions">
            <Button
              appearance="subtle"
              aria-label="复制引用"
              icon={<CopyRegular />}
              onClick={() => void copyCitation("citation")}
              size="small"
              title="复制引用"
            />
            <Button
              appearance="subtle"
              aria-label="复制 BibTeX"
              icon={<DocumentArrowDownRegular />}
              onClick={() => void copyCitation("bibtex")}
              size="small"
              title="复制 BibTeX"
            />
          </div>
        </div>
      ) : null}
      {actionMessage ? <div aria-live="polite" className="literature-version-action-message">{actionMessage}</div> : null}
    </section>
  );
}
