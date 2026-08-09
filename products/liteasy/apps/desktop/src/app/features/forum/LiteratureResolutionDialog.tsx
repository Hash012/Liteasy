import { useState } from "react";
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
  Select,
  Textarea
} from "@fluentui/react-components";
import type { LiteratureDialogModel } from "./literatureResolution.types";
import type {
  LiteratureIdentifierKind,
  ManualLiteratureInput
} from "../paper-identity/literature.types";

type LiteratureResolutionDialogProps = {
  model: LiteratureDialogModel;
  onCancel: () => void;
  onRetry: () => void;
  onSelectCandidate: (candidateKey: string) => void;
  onSubmitManual: (record: ManualLiteratureInput) => void;
};

const identifierLabels: Record<LiteratureIdentifierKind, string> = {
  arxiv_id: "arXiv",
  doi: "DOI",
  openalex_id: "OpenAlex",
  semantic_scholar_id: "Semantic Scholar",
  title_authors_year_hash: "题名作者年份"
};

type ManualIdentifierKind = Exclude<LiteratureIdentifierKind, "title_authors_year_hash">;

function parseAuthors(value: string) {
  return value.split(/\s*(?:;|；|、|\n)\s*/).map((author) => author.trim()).filter(Boolean);
}

export function LiteratureResolutionDialog({
  model,
  onCancel,
  onRetry,
  onSelectCandidate,
  onSubmitManual
}: LiteratureResolutionDialogProps) {
  const [authors, setAuthors] = useState("");
  const [identifierKind, setIdentifierKind] = useState<ManualIdentifierKind>("doi");
  const [identifierValue, setIdentifierValue] = useState("");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const parsedAuthors = parseAuthors(authors);
  const parsedYear = /^\d{4}$/.test(year) ? Number(year) : undefined;
  const canSubmitManual = Boolean(title.trim()) && (
    Boolean(identifierValue.trim()) || (parsedAuthors.length > 0 && parsedYear !== undefined)
  );

  function submitManual() {
    if (!canSubmitManual) return;
    onSubmitManual({
      authors: parsedAuthors,
      identifiers: identifierValue.trim() ? [{
        kind: identifierKind,
        source: "manual",
        value: identifierValue.trim()
      }] : [],
      title: title.trim(),
      ...(parsedYear !== undefined ? { year: parsedYear } : {})
    });
  }

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
              <div>
                {model.candidates.map((candidate) => {
                  const primaryIdentifier = candidate.record.identifiers[0];
                  const byline = [
                    candidate.record.authors.join("、"),
                    candidate.record.year ? String(candidate.record.year) : ""
                  ].filter(Boolean).join(" · ");
                  return (
                    <div className="profile-archive-card" key={candidate.candidateKey}>
                      <div className="profile-dialog-title">{candidate.record.title}</div>
                      {byline ? <div>{byline}</div> : null}
                      {primaryIdentifier ? (
                        <div>{identifierLabels[primaryIdentifier.kind]} {primaryIdentifier.value}</div>
                      ) : null}
                      <Button
                        appearance="secondary"
                        aria-label={`选择 ${candidate.record.title}`}
                        disabled={model.pending}
                        onClick={() => onSelectCandidate(candidate.candidateKey)}
                      >
                        选择
                      </Button>
                    </div>
                  );
                })}
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
                      provider === "arxiv" ? "arXiv" : provider
              ).join("、")}</div>
            ) : null}
          </div>
            ) : null}

            {model.kind === "manual" ? (
          <div className="profile-archive-card">
            <Field label="文献标题" required>
              <Input
                aria-label="文献标题"
                disabled={model.pending}
                onChange={(_, data) => setTitle(data.value)}
                value={title}
              />
            </Field>
            <Field label="作者">
              <Textarea
                aria-label="作者"
                disabled={model.pending}
                onChange={(_, data) => setAuthors(data.value)}
                value={authors}
              />
            </Field>
            <Field label="年份">
              <Input
                aria-label="年份"
                disabled={model.pending}
                inputMode="numeric"
                maxLength={4}
                onChange={(_, data) => setYear(data.value.replace(/\D/g, ""))}
                value={year}
              />
            </Field>
            <Field label="外部标识类型">
              <Select
                aria-label="外部标识类型"
                disabled={model.pending}
                onChange={(_, data) => setIdentifierKind(data.value as ManualIdentifierKind)}
                value={identifierKind}
              >
                <option value="doi">DOI</option>
                <option value="arxiv_id">arXiv</option>
                <option value="semantic_scholar_id">Semantic Scholar</option>
                <option value="openalex_id">OpenAlex</option>
              </Select>
            </Field>
            <Field label="外部标识">
              <Input
                aria-label="外部标识"
                disabled={model.pending}
                onChange={(_, data) => setIdentifierValue(data.value)}
                value={identifierValue}
              />
            </Field>
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
              取消公开
            </Button>
            {model.kind === "unavailable" ? (
              <Button appearance="primary" disabled={model.pending} onClick={onRetry}>
                重试检索
              </Button>
            ) : null}
            {model.kind === "manual" ? (
              <Button appearance="primary" disabled={model.pending || !canSubmitManual} onClick={submitManual}>
                确认文献信息
              </Button>
            ) : null}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
