import "./library.css";
import { ImportButton } from "../import/ImportButton";

const papers = [
  { id: "demo-1", title: "Attention Is All You Need" },
  { id: "demo-2", title: "BERT: Pre-training of Deep Bidirectional Transformers" }
];

export function LibraryPane() {
  return (
    <div className="library-pane">
      <div className="library-toolbar">
        <ImportButton onImport={() => undefined} />
        <button className="library-button ghost" type="button">
          锁定选择
        </button>
      </div>

      <div className="library-section">
        <div className="library-section-title">我的文献库</div>
        <ul className="library-list">
          {papers.map((paper) => (
            <li className="library-item" key={paper.id}>
              <label>
                <input type="checkbox" />
                <span>{paper.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="library-section muted">
        <div className="library-section-title">联网收藏</div>
        <p>当前还没有收藏内容。</p>
      </div>

      <div className="library-section muted">
        <div className="library-section-title">关联推荐</div>
        <p>后续会在这里展示相关文献推荐。</p>
      </div>
    </div>
  );
}
