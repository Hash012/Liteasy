import type { UIDslActionRef, UIDslDocument, UIDslNode } from "./generativeUi.types";
import { validateUIDslDocument } from "./uiDslValidator";
import { validateUIDslUx } from "./uxValidator";

type DynamicCanvasProps = {
  document: UIDslDocument;
  onAction: (action: UIDslActionRef) => void;
};

function getStringProp(props: Record<string, unknown>, key: string, fallback = "") {
  const value = props[key];
  return typeof value === "string" ? value : fallback;
}

function getStringArrayProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getNumberProp(props: Record<string, unknown>, key: string, fallback = 0) {
  const value = props[key];
  return typeof value === "number" ? value : fallback;
}

function getRecordArrayProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function renderNode(
  node: UIDslNode,
  actionsById: Map<string, UIDslActionRef>,
  onAction: (action: UIDslActionRef) => void
): JSX.Element {
  const children = node.children?.map((child) => renderNode(child, actionsById, onAction));

  if (node.component === "Stack") {
    return (
      <div className={`genui-stack gap-${getStringProp(node.props, "gap", "md")}`} key={node.id}>
        {children}
      </div>
    );
  }

  if (node.component === "Panel") {
    return (
      <section className="genui-panel" key={node.id}>
        {getStringProp(node.props, "title") ? <strong>{getStringProp(node.props, "title")}</strong> : null}
        {getStringProp(node.props, "text") ? <p>{getStringProp(node.props, "text")}</p> : null}
        {children}
      </section>
    );
  }

  if (node.component === "StatusBanner") {
    const text = getStringProp(node.props, "text");
    return (
      <section
        aria-label={`动态界面：${text}`}
        className={`genui-status ${getStringProp(node.props, "tone", "info")}`}
        key={node.id}
      >
        {text}
      </section>
    );
  }

  if (node.component === "EvidenceCard") {
    return (
      <section className="genui-evidence-card" key={node.id}>
        <strong>{getStringProp(node.props, "title", "证据")}</strong>
        <span>{getStringProp(node.props, "source")}</span>
        <p>{getStringProp(node.props, "snippet")}</p>
      </section>
    );
  }

  if (node.component === "EvidenceMatrix") {
    const rows = getRecordArrayProp(node.props, "rows");
    return (
      <section className="genui-evidence-matrix" key={node.id}>
        <strong>{getStringProp(node.props, "title", "证据矩阵")}</strong>
        {rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>文献</th>
                <th>证据</th>
                <th>摘录</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${node.id}-row-${index}`}>
                  <td>{getStringProp(row, "paper")}</td>
                  <td>{getStringProp(row, "evidence")}</td>
                  <td>{getStringProp(row, "snippet")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {children}
      </section>
    );
  }

  if (node.component === "MindMap") {
    const nodes = getRecordArrayProp(node.props, "nodes");
    return (
      <section className="genui-mindmap" key={node.id}>
        <strong>{getStringProp(node.props, "title", "思维导图")}</strong>
        <div className="genui-node-cloud">
          {nodes.map((item, index) => (
            <span className="genui-node-chip" key={`${node.id}-node-${index}`}>
              {getStringProp(item, "label")}
            </span>
          ))}
        </div>
        {children}
      </section>
    );
  }

  if (node.component === "CitationList") {
    const citations = getRecordArrayProp(node.props, "citations");
    return (
      <ul className="genui-citation-list" key={node.id}>
        {citations.map((citation, index) => (
          <li key={`${node.id}-${index}`}>
            {getStringProp(citation, "paperId")} · 第 {getStringProp(citation, "page")} 页
          </li>
        ))}
      </ul>
    );
  }

  if (node.component === "ArtifactLauncher") {
    return (
      <section className="genui-artifact-launcher" key={node.id}>
        <strong>{getStringProp(node.props, "title", "产物")}</strong>
        <span>{getStringProp(node.props, "artifactType")}</span>
      </section>
    );
  }

  if (node.component === "ComparisonTable") {
    const rows = getRecordArrayProp(node.props, "rows");
    return (
      <section className="genui-comparison-table" key={node.id}>
        <strong>{getStringProp(node.props, "title", "对比表")}</strong>
        {rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>文献</th>
                <th>关注点</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${node.id}-row-${index}`}>
                  <td>{getStringProp(row, "paper")}</td>
                  <td>{getStringProp(row, "focus")}</td>
                  <td>{getStringProp(row, "evidence")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    );
  }

  if (node.component === "TreeOutline") {
    const nodes = getRecordArrayProp(node.props, "nodes");
    return (
      <section className="genui-tree-outline" key={node.id}>
        <strong>{getStringProp(node.props, "title", "树形展开")}</strong>
        <ol>
          {nodes.map((item, index) => (
            <li
              key={`${node.id}-node-${index}`}
              style={{ marginLeft: `${Math.max(0, getNumberProp(item, "level", 1) - 1) * 16}px` }}
            >
              {getStringProp(item, "label")}
            </li>
          ))}
        </ol>
        {children}
      </section>
    );
  }

  if (node.component === "SlideDeck") {
    const slides = getRecordArrayProp(node.props, "slides");
    return (
      <section className="genui-slide-deck" key={node.id}>
        <strong>{getStringProp(node.props, "title", "PPT")}</strong>
        <div className="genui-slide-list">
          {slides.map((slide, index) => (
            <article className="genui-slide" key={`${node.id}-slide-${index}`}>
              <span>{getStringProp(slide, "title", `Slide ${index + 1}`)}</span>
              <ul>
                {getStringArrayProp(slide, "bullets").map((bullet) => (
                  <li key={`${node.id}-slide-${index}-${bullet}`}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        {children}
      </section>
    );
  }

  if (node.component === "ActionBar") {
    return (
      <div className="genui-action-bar" key={node.id}>
        {getStringArrayProp(node.props, "actionIds").map((actionId) => {
          const action = actionsById.get(actionId);
          if (!action) {
            return null;
          }

          return (
            <button
              className={`genui-action ${action.riskLevel}`}
              key={action.id}
              onClick={() => onAction(action)}
              type="button"
            >
              {action.label}
            </button>
          );
        })}
      </div>
    );
  }

  return <div key={node.id}>{children}</div>;
}

export function DynamicCanvas({ document, onAction }: DynamicCanvasProps) {
  const validation = validateUIDslDocument(document);
  const uxValidation = validation.valid ? validateUIDslUx(document) : { errors: [], valid: true };

  if (!validation.valid || !uxValidation.valid) {
    return (
      <section className="genui-fallback" aria-label="动态界面降级">
        <strong>动态界面暂时不可用</strong>
      </section>
    );
  }

  const actionsById = new Map(document.actions.map((action) => [action.id, action]));

  return (
    <section className="genui-canvas" data-trace-id={document.audit.traceId}>
      {renderNode(document.root, actionsById, onAction)}
    </section>
  );
}
