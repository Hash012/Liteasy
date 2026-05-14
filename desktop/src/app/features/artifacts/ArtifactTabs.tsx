import type { ArtifactTab } from "./artifact.types";
import { ReaderPane } from "../reader/ReaderPane";
import type { Highlight } from "../reader/reader.store";

type ArtifactTabsProps = {
  tabs: ArtifactTab[];
  readerFilePaths: Map<string, string>;   // paperId → filePath
  readerPageNumber: number;
  readerScale: number;
  readerHighlights: Highlight[];
  onReaderPageChange: (n: number) => void;
  onReaderScaleChange: (s: number) => void;
  onTotalPages: (n: number) => void;
  onTextSelect: (text: string, pageNo: number, bbox: string | null, menuX: number, menuY: number) => void;
};

export function ArtifactTabs({
  tabs,
  readerFilePaths,
  readerPageNumber,
  readerScale,
  readerHighlights,
  onReaderPageChange,
  onReaderScaleChange,
  onTotalPages,
  onTextSelect,
}: ArtifactTabsProps) {
  if (tabs.length === 0) {
    return <p className="reader-placeholder">文献阅读与多模态标签页区域</p>;
  }

  const active = tabs[tabs.length - 1];
  const isReader = active.artifactType === "reader" || active.id === "reader-default";
  const hasReaderContent = isReader && active.paperId;

  return (
    <div className="artifact-tabs">
      <div className="artifact-tab-bar">
        {tabs.map((tab) => (
          <span
            className={`artifact-tab-label ${tab.id === active.id ? "artifact-tab-label--active" : ""}`}
            key={tab.id}
          >
            {tab.title}
          </span>
        ))}
      </div>
      <div className="artifact-tab-content">
        {hasReaderContent && active.paperId ? (
          <ReaderPane
            filePath={readerFilePaths.get(active.paperId) ?? ""}
            pageNumber={readerPageNumber}
            scale={readerScale}
            highlights={readerHighlights}
            onPageChange={onReaderPageChange}
            onScaleChange={onReaderScaleChange}
            onTotalPages={onTotalPages}
            onTextSelect={onTextSelect}
          />
        ) : active.content ? (
          <pre className="artifact-pre">{active.content}</pre>
        ) : (
          <p className="reader-placeholder">文献阅读与多模态标签页区域</p>
        )}
      </div>
    </div>
  );
}
