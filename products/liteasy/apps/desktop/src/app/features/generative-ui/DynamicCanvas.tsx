import type { UIDslActionRef, UIDslDocument, UIDslNode } from "./generativeUi.types";
import { GeneratedMindMap } from "./GeneratedMindMap";
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

function getRecordArrayProp(props: Record<string, unknown>, key: string) {
  const value = props[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

type VisualOutlineNode = {
  evidenceIds: string[];
  id: string;
  kind: string;
  label: string;
  parentId?: string;
};

const evidenceIdPattern = /\[?\bevidence-[a-z0-9][a-z0-9-]*\b\]?/gi;

function hideInternalEvidenceIds(value: string, replacement = "〔证据〕") {
  return value
    .replace(evidenceIdPattern, replacement)
    .replace(/(?:〔证据〕[\s,，、;；]*){2,}/g, "〔证据〕 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanOutlineLabel(value: string) {
  return hideInternalEvidenceIds(value, "").replace(/\s+([，。；：,.!?])/g, "$1");
}

function normalizeOutlineNodes(records: Record<string, unknown>[]): VisualOutlineNode[] {
  const hasExplicitParents = records.some((record) => typeof record.parentId === "string");
  const levelParents = new Map<number, string>();

  return records.map((record, index) => {
    const id = getStringProp(record, "id", `outline-node-${index}`);
    const level = typeof record.level === "number" ? Math.max(1, record.level) : 1;
    const parentId = hasExplicitParents
      ? getStringProp(record, "parentId") || undefined
      : level > 1
        ? levelParents.get(level - 1)
        : undefined;
    levelParents.set(level, id);
    for (const storedLevel of [...levelParents.keys()]) {
      if (storedLevel > level) {
        levelParents.delete(storedLevel);
      }
    }
    return {
      evidenceIds: getStringArrayProp(record, "evidenceIds"),
      id,
      kind: getStringProp(record, "kind", parentId ? "evidence" : "root"),
      label: cleanOutlineLabel(getStringProp(record, "label")) || "证据节点",
      parentId
    };
  });
}

function OutlineBranch({
  byParent,
  depth,
  node,
  variant,
  visited
}: {
  byParent: Map<string | undefined, VisualOutlineNode[]>;
  depth: number;
  node: VisualOutlineNode;
  variant: "mindmap" | "tree";
  visited: Set<string>;
}) {
  if (visited.has(node.id)) {
    return null;
  }
  const nextVisited = new Set(visited).add(node.id);
  const children = byParent.get(node.id) ?? [];
  const content = (
    <span className="genui-outline-label">
      <span className={`genui-outline-kind ${node.kind}`} aria-hidden="true" />
      <span>{node.label}</span>
      {node.evidenceIds.length > 0 ? (
        <small>{node.evidenceIds.length} 条证据</small>
      ) : null}
    </span>
  );

  return (
    <li
      className={`genui-outline-node kind-${node.kind}`}
      style={{ animationDelay: `${Math.min(depth * 90, 450)}ms` }}
    >
      {children.length > 0 ? (
        <details open={depth < 2}>
          <summary>{content}</summary>
          <ul>
            {children.map((child) => (
              <OutlineBranch
                byParent={byParent}
                depth={depth + 1}
                key={child.id}
                node={child}
                variant={variant}
                visited={nextVisited}
              />
            ))}
          </ul>
        </details>
      ) : (
        content
      )}
    </li>
  );
}

export function OutlineTree({
  nodes,
  variant
}: {
  nodes: Record<string, unknown>[];
  variant: "mindmap" | "tree";
}) {
  const normalized = normalizeOutlineNodes(nodes);
  if (variant === "mindmap") {
    return <GeneratedMindMap nodes={normalized} />;
  }
  const ids = new Set(normalized.map((node) => node.id));
  const byParent = new Map<string | undefined, VisualOutlineNode[]>();
  normalized.forEach((node) => {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : undefined;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(node);
    byParent.set(parentId, siblings);
  });

  return (
    <ul className={`genui-outline-tree ${variant}`}>
      {(byParent.get(undefined) ?? []).map((node) => (
        <OutlineBranch
          byParent={byParent}
          depth={0}
          key={node.id}
          node={node}
          variant={variant}
          visited={new Set()}
        />
      ))}
    </ul>
  );
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
        {getStringProp(node.props, "text") ? (
          <p>{hideInternalEvidenceIds(getStringProp(node.props, "text"))}</p>
        ) : null}
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
        <span>{hideInternalEvidenceIds(getStringProp(node.props, "source"))}</span>
        <p>{hideInternalEvidenceIds(getStringProp(node.props, "snippet"))}</p>
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
                  <td>{hideInternalEvidenceIds(getStringProp(row, "evidence"))}</td>
                  <td>{hideInternalEvidenceIds(getStringProp(row, "snippet"))}</td>
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
        <OutlineTree nodes={nodes} variant="mindmap" />
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
                  <td>{hideInternalEvidenceIds(getStringProp(row, "focus"))}</td>
                  <td>{hideInternalEvidenceIds(getStringProp(row, "evidence"))}</td>
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
        <OutlineTree nodes={nodes} variant="tree" />
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
                  <li key={`${node.id}-slide-${index}-${bullet}`}>
                    {hideInternalEvidenceIds(bullet)}
                  </li>
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
