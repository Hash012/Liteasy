import type { MineruFigure } from "../import/import.types";

export type ThinReadingSourceFigure = {
  evidenceIds: readonly string[];
  figure: MineruFigure;
  reason: string;
  recommendedBy: "agent" | "fallback";
};

function placementLabel(placement: NonNullable<MineruFigure["analysis"]>["placement"] | undefined) {
  switch (placement) {
    case "method": return "方法图解";
    case "results": return "结果证据";
    case "evidence": return "关键证据";
    default: return "核心图解";
  }
}

export function ThinReadingSourceFigures({ figures }: { figures: readonly ThinReadingSourceFigure[] }) {
  return (
    <section aria-label="论文原图" className="thin-reading__source-figures" data-testid="thin-reading-source-figures">
      <h3>论文原图</h3>
      {figures.length === 0 ? (
        <p className="thin-reading__source-figures-empty">本节没有可核对的原图。</p>
      ) : (
        <div className="thin-reading__source-figure-grid">
          {figures.map(({ figure, reason, recommendedBy }) => (
            <figure className="thin-reading__figure-embed" key={figure.id}>
              <div className="thin-reading__figure-media">
                <img alt={figure.analysis?.title ?? figure.alt} loading="lazy" src={figure.dataUrl} />
              </div>
              <figcaption>
                <div className="thin-reading__figure-kicker">
                  <span>{placementLabel(figure.analysis?.placement)}</span>
                  <span>原文第 {figure.page} 页</span>
                </div>
                <h4>{figure.analysis?.title ?? figure.alt}</h4>
                <p>{figure.analysis?.description ?? "这张原文图表可回到论文核对。"}</p>
                <small>{recommendedBy === "agent" ? "建议先看" : "相关性建议"}：{reason}</small>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
