import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import type { LiteratureDialogModel } from "./literatureResolution.types";
import type { LiteratureIdentifierKind } from "../paper-identity/literature.types";

type LiteratureResolutionDialogProps = {
  model: LiteratureDialogModel;
  onCancel: () => void;
  onRetry: () => void;
  onSelectCandidate: (candidateKey: string) => void;
};

const identifierLabels: Record<LiteratureIdentifierKind, string> = {
  arxiv_id: "arXiv",
  doi: "DOI",
  openalex_id: "OpenAlex",
  semantic_scholar_id: "Semantic Scholar",
  title_authors_year_hash: "题名作者年份"
};

export function LiteratureResolutionDialog({
  model,
  onCancel,
  onRetry,
  onSelectCandidate
}: LiteratureResolutionDialogProps) {
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

            {model.kind === "unresolved" || model.kind === "conflict" ? (
              <div className="profile-archive-card">
                <div className="profile-dialog-title">
                  {model.kind === "conflict" ? "来源信息存在冲突" : "文献身份尚未确认"}
                </div>
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
