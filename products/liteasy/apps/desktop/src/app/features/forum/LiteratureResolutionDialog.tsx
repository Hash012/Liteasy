import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Textarea
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type {
  LiteratureDialogModel,
  LiteratureSearchDraft
} from "./literatureResolution.types";
import type { LiteratureIdentifierKind } from "../paper-identity/literature.types";
import {
  candidateVersionLabel,
  groupLiteratureCandidates,
  literatureProviderLabel,
  relationEvidenceLabel
} from "./literatureVersioning";

type LiteratureResolutionDialogProps = {
  model: LiteratureDialogModel;
  onCancel: () => void;
  onRetry: () => void;
  onSearch: (draft: LiteratureSearchDraft) => void;
  onSelectCandidate: (candidateKey: string) => void;
};

const identifierLabels: Record<LiteratureIdentifierKind, string> = {
  arxiv_id: "arXiv",
  dblp_key: "DBLP",
  doi: "DOI",
  openalex_id: "OpenAlex",
  openreview_id: "OpenReview",
  pmlr_id: "PMLR",
  semantic_scholar_id: "Semantic Scholar",
  title_authors_year_hash: "题名作者年份"
};

export function LiteratureResolutionDialog({
  model,
  onCancel,
  onRetry,
  onSearch,
  onSelectCandidate
}: LiteratureResolutionDialogProps) {
  const [title, setTitle] = useState(model.searchDraft?.title ?? "");
  const [authors, setAuthors] = useState(model.searchDraft?.authors.join("\n") ?? "");
  const [year, setYear] = useState(model.searchDraft?.year ? String(model.searchDraft.year) : "");
  const canCorrectSearch = new Set(["candidates", "conflict", "unavailable", "unresolved"]).has(model.kind);

  useEffect(() => {
    setTitle(model.searchDraft?.title ?? "");
    setAuthors(model.searchDraft?.authors.join("\n") ?? "");
    setYear(model.searchDraft?.year ? String(model.searchDraft.year) : "");
  }, [model.searchDraft]);

  const parsedAuthors = authors.split(/[;\n]+/u)
    .map((author) => author.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const parsedYear = Number(year);
  const canSearch = Boolean(title.trim() && parsedAuthors.length &&
    Number.isInteger(parsedYear) && parsedYear >= 1000 && parsedYear <= 9999);

  return (
    <Dialog
      modalType="modal"
      onOpenChange={(_, data) => {
        if (!data.open) onCancel();
      }}
      open
    >
      <DialogSurface aria-label="确认文献身份" className="workspace-modal-panel profile-dialog">
        <DialogBody>
          <DialogTitle>确认文献身份</DialogTitle>
          <DialogContent>
            {model.kind === "resolving" ? (
              <div className="profile-archive-card">正在识别文献</div>
            ) : null}

            {model.kind === "confirming" ? (
              <div className="profile-archive-card">正在确认 {model.candidate.record.title}</div>
            ) : null}

            {model.kind === "candidates" ? (
              <div className="literature-candidate-groups">
                {groupLiteratureCandidates(model.candidates).map((group, groupIndex) => (
                  <section
                    aria-label={group.versioned ? `文献版本组 ${groupIndex + 1}` : undefined}
                    className={group.versioned ? "literature-candidate-group" : undefined}
                    key={group.id}
                    role={group.versioned ? "group" : undefined}
                  >
                    {group.versioned ? (
                      <div className="literature-candidate-group-title">版本组 {groupIndex + 1}</div>
                    ) : null}
                    {group.candidates.map((candidate) => {
                      const primaryIdentifier = candidate.record.identifiers[0];
                      const relation = candidate.relations?.[0];
                      const pmlrEvidence = candidate.provider === "pmlr" ? candidate.sourceEvidence : undefined;
                      const pmlrDigest = pmlrEvidence?.artifactHash.slice("sha256:".length);
                      const pmlrAuditLabel = pmlrEvidence && pmlrDigest
                        ? ` · 官方卷 BibTeX v${pmlrEvidence.volume} · SHA-256 ${pmlrDigest.slice(0, 8)}…${pmlrDigest.slice(-8)}`
                        : "";
                      const byline = [
                        candidate.record.authors.join("、"),
                        candidate.record.year ? String(candidate.record.year) : ""
                      ].filter(Boolean).join(" · ");
                      return (
                        <div className="profile-archive-card literature-candidate-card" key={candidate.candidateKey}>
                          <div className="profile-dialog-title">{candidate.record.title}</div>
                          {group.versioned || relation ? (
                            <div className="literature-candidate-version">{candidateVersionLabel(candidate)}</div>
                          ) : null}
                          {byline ? <div>{byline}</div> : null}
                          {primaryIdentifier ? (
                            <div>{identifierLabels[primaryIdentifier.kind]} {primaryIdentifier.value}</div>
                          ) : null}
                          <div
                            className="literature-candidate-source"
                            title={pmlrEvidence ? `${pmlrEvidence.artifactUrl}\n${pmlrEvidence.artifactHash}` : undefined}
                          >
                            来源：{literatureProviderLabel(candidate.provider)}
                            {relation ? ` · 证据：${relationEvidenceLabel(relation.evidence)}` : ""}
                            {pmlrAuditLabel}
                          </div>
                          <Button
                            appearance="secondary"
                            aria-label={`选择 ${candidate.record.title}${group.versioned ? `（${literatureProviderLabel(candidate.provider)}）` : ""}`}
                            disabled={model.pending}
                            onClick={() => onSelectCandidate(candidate.candidateKey)}
                          >
                            选择
                          </Button>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            ) : null}

            {model.kind === "unavailable" ? (
          <div className="profile-archive-card">
            <div className="profile-dialog-title">文献检索暂时不可用</div>
            {model.unavailableProviders.length > 0 ? (
              <div>暂不可用：{model.unavailableProviders.map((provider) =>
                provider === "semantic_scholar" ? "Semantic Scholar" :
                  provider === "openalex" ? "OpenAlex" :
                    provider === "crossref" ? "Crossref" :
                      provider === "arxiv" ? "arXiv" :
                        provider === "openreview" ? "OpenReview" :
                          provider === "dblp" ? "DBLP" :
                            provider === "pmlr" ? "PMLR" : provider
              ).join("、")}</div>
            ) : null}
          </div>
            ) : null}

            {model.kind === "unresolved" || model.kind === "conflict" ? (
              <div className="profile-archive-card">
                <div className="profile-dialog-title">
                  {model.kind === "conflict" ? "来源信息存在冲突" : "文献身份尚未确认"}
                </div>
              </div>
            ) : null}

            {canCorrectSearch ? (
              <div className="literature-search-fields">
                <Field label="文献标题" required>
                  <Input
                    disabled={model.pending}
                    onChange={(_, data) => setTitle(data.value)}
                    value={title}
                  />
                </Field>
                <Field label="作者" required>
                  <Textarea
                    disabled={model.pending}
                    onChange={(_, data) => setAuthors(data.value)}
                    resize="vertical"
                    value={authors}
                  />
                </Field>
                <Field label="出版年份" required>
                  <Input
                    disabled={model.pending}
                    max={9999}
                    min={1000}
                    onChange={(_, data) => setYear(data.value)}
                    type="number"
                    value={year}
                  />
                </Field>
                <Button
                  appearance="secondary"
                  disabled={model.pending || !canSearch}
                  onClick={() => onSearch({
                    authors: parsedAuthors,
                    title: title.replace(/\s+/gu, " ").trim(),
                    year: parsedYear
                  })}
                >
                  按修正题录检索
                </Button>
              </div>
            ) : null}

            {model.message ? (
              <div aria-live="polite" className="organization-action-message">{model.message}</div>
            ) : null}
          </DialogContent>

          <DialogActions className="profile-dialog-actions">
            <Button
              appearance="secondary"
              onClick={onCancel}
            >
              关闭
            </Button>
            {model.kind === "unavailable" || model.kind === "unresolved" || model.kind === "conflict" ? (
              <Button appearance="primary" disabled={model.pending} onClick={onRetry}>
                重试检索
              </Button>
            ) : null}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
