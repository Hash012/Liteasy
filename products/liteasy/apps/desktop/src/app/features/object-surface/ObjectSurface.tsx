import { formatPaperAnchorText } from "../paper-anchors/paperAnchorEntity";
import { ResourceLocationButton } from "../resource-filesystem/ResourceLocationButton";
import { PaperAnchorReferences } from "../paper-anchors/PaperAnchorReferences";
import { ObjectAssetImage } from "./ObjectAssetImage";
import { useEffect, useState, type ReactNode } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import {
  ChatAddRegular,
  CopyRegular,
  LinkRegular,
} from "@fluentui/react-icons";
import {
  objectLink,
  objectText,
  refOf,
  type ObjectEnvelope,
  type ObjectRef,
} from "../objects/object.types";
import { MarkdownContent } from "../markdown/MarkdownContent";
import {
  makeObjectTransfer,
  writeObjectTransfer,
} from "../object-transfer/objectTransfer";
import type { ObjectRepository } from "../objects/objectRepository";
// Local assets are rendered by ObjectAssetImage after permission-checked loading.
// Keep their captions in the text without handing attachment: URLs to Markdown.
export function objectDisplayText(
  object: ObjectEnvelope,
  hideDrawingCaption = false,
) {
  return objectText(object).replace(
    /!\[([^\]\n]*)\]\(\s*attachment:[^)]+\)/g,
    (_, caption: string) =>
      hideDrawingCaption && /^手绘笔记（\d+ 笔）$/.test(caption) ? "" : caption,
  );
}
export type ObjectSurfaceState =
  | "loading"
  | "ready"
  | "partial"
  | "unsupported"
  | "missing"
  | "forbidden"
  | "error";
export function ObjectSurface({
  object,
  onAdd,
  onSource,
  onDetails,
  onError,
  presentation = "card",
  onEdit,
  editor,
  sourceText,
}: {
  object: ObjectEnvelope;
  presentation?: "full" | "card" | "inline" | "canvas";
  onAdd(ref: ObjectRef): void;
  onSource(): void;
  onDetails(): void;
  onError(message: string): void;
  onEdit?(): void;
  editor?: ReactNode;
  sourceText?: string;
}) {
  const partial =
    (object.kind === "content.fragment" ||
      object.kind === "conversation.message") &&
    object.content.payload.partial;
  const displayText = objectDisplayText(object, presentation === "canvas");
  const text = sourceText?.trim() === displayText.trim() ? "" : displayText;
  if (presentation === "canvas" && !text.trim() && !editor && !sourceText)
    return null;
  return (
    <article
      className={`object-surface object-${presentation}${editor ? " has-editor" : ""}`}
      aria-label={formatPaperAnchorText(object.title, object.paperAnchors)}
    >
      {presentation !== "canvas" ? (
        <>
          <strong>{formatPaperAnchorText(object.title, object.paperAnchors)}</strong>
          <span className="object-meta">
            {partial ? "未完成快照 · " : ""}已保存到本机
          </span>
        </>
      ) : partial ? (
        <span className="object-meta">未完成快照</span>
      ) : null}
      {editor ??
        (text.trim() ? (
          <div
            className={`object-body${onEdit ? " is-editable" : ""}`}
            role={onEdit ? "button" : undefined}
            tabIndex={onEdit ? 0 : undefined}
            aria-label={
              onEdit
                ? object.kind === "content.fragment"
                  ? "编辑摘录为笔记"
                  : "编辑笔记正文"
                : undefined
            }
            onClick={
              onEdit
                ? (event) => {
                    if (
                      (event.target as Element).closest(
                        "a, button, input, textarea",
                      )
                    )
                      return;
                    onEdit();
                  }
                : undefined
            }
            onKeyDown={
              onEdit
                ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onEdit();
                    }
                  }
                : undefined
            }
          >
            <MarkdownContent value={text} paperAnchors={object.paperAnchors} />
          </div>
        ) : null)}
      {object.lifecycle !== "tombstoned" ? <PaperAnchorReferences anchors={object.paperAnchors ?? []} /> : null}
      {sourceText ? (
        <details className="object-source-quote" open>
          <summary
            aria-label="展开或收起原文"
            onClick={(event) => event.stopPropagation()}
          >
            原文
          </summary>
          <blockquote><MarkdownContent value={sourceText} /></blockquote>
        </details>
      ) : null}
      {presentation !== "canvas" ? (
        <div className="object-toolbar">
          <ResourceLocationButton target={{ kind: "object", ref: refOf(object) }} />
          <Tooltip
            content="拖入白板或对话；点击复制带来源链接的文字"
            relationship="description"
          >
            <Button
              size="small"
              icon={<CopyRegular />}
              aria-label="复制或拖动内容"
              draggable
              onDragStart={(event) =>
                writeObjectTransfer(
                  event.dataTransfer,
                  makeObjectTransfer([refOf(object)], text),
                )
              }
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${text}\n\n${objectLink(refOf(object))}`)
                  .catch(() => onError("复制失败，请重试。"))
              }
            />
          </Tooltip>
          <Tooltip content="加入对话" relationship="description">
            <Button
              size="small"
              icon={<ChatAddRegular />}
              aria-label="加入对话"
              onClick={() => onAdd(refOf(object))}
            />
          </Tooltip>
          <Tooltip content="查看来源" relationship="description">
            <Button
              size="small"
              icon={<LinkRegular />}
              aria-label="查看来源"
              onClick={onSource}
              disabled={object.provenance.sourceRefs.length === 0}
            />
          </Tooltip>
          <Button size="small" onClick={onDetails}>
            关联与历史
          </Button>
        </div>
      ) : null}
    </article>
  );
}
export function ObjectDetails({
  object,
  repository,
  onOpen,
  onClose,
  onError,
}: {
  object: ObjectEnvelope;
  repository: ObjectRepository;
  onOpen(object: ObjectEnvelope): void;
  onClose(): void;
  onError(message: string): void;
}) {
  const [run, setRun] = useState<{
    status: string;
    createdAt: string;
    question: string;
  }>();
  const [history, setHistory] = useState<ObjectEnvelope[]>([]);
  const [relations, setRelations] = useState<
    Awaited<ReturnType<ObjectRepository["listRelations"]>>
  >([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      repository.history(object.objectId),
      repository.listRelations(refOf(object)),
    ])
      .then(([h, r]) => {
        if (alive) {
          setHistory(h);
          setRelations(r);
        }
      })
      .catch((e) => onError(e.message));
    return () => {
      alive = false;
    };
  }, [repository, object]);
  useEffect(() => {
    let active = true;
    setRun(undefined);
    if (object.provenance.runId)
      void repository
        .getRunRecord(object.provenance.runId)
        .then((record) => {
          if (active) setRun(record);
        })
        .catch((e) => onError(e.message));
    return () => {
      active = false;
    };
  }, [repository, object]);
  const open = (ref: ObjectRef) =>
    void repository
      .get(ref)
      .then(onOpen)
      .catch((e) => onError(e.message));
  return (
    <section className="object-details" aria-label="内容详情">
      <Button onClick={onClose}>关闭详情</Button>
      <h3>{object.title}</h3>
      <MarkdownContent value={objectDisplayText(object)} paperAnchors={object.paperAnchors} />
      <PaperAnchorReferences anchors={object.paperAnchors ?? []} />
      {object.assets.map((asset) => (
        <ObjectAssetImage
          key={asset.assetId}
          assetId={asset.assetId}
          repository={repository}
        />
      ))}
      <p>来源</p>
      {object.provenance.sourceRefs.map((ref) => (
        <Button key={ref.objectId + ref.revision} onClick={() => open(ref)}>
          打开来源
        </Button>
      ))}
      {object.provenance.derivedFrom?.length ? (
        <p>此内容是独立副本，原文保持不变。</p>
      ) : null}
      <p>关联</p>
      {relations.length === 0 ? (
        <p>暂无关联</p>
      ) : (
        relations.map((r) => (
          <p key={r.relationId}>
            <Button
              onClick={() =>
                open(r.from.objectId === object.objectId ? r.to : r.from)
              }
            >
              {
                {
                  references: "引用",
                  related_to: "相关",
                  derived_from: "派生",
                  member_of: "所属白板",
                }[r.predicate]
              }
            </Button>{" "}
            {r.basis.reason} ·{" "}
            {r.basis.type === "operation" ? "操作记录" : "用户已采纳"}
          </p>
        ))
      )}
      {run ? (
        <details>
          <summary>执行记录</summary>
          <p>{run.question}</p>
          <p>
            {new Date(run.createdAt).toLocaleString()} ·{" "}
            {run.status === "completed" ? "已完成" : "未完成"}
          </p>
        </details>
      ) : null}
      <p>修改记录</p>
      {history.map((version) => (
        <Button key={version.revision} onClick={() => onOpen(version)}>
          {new Date(version.updatedAt).toLocaleString()}
        </Button>
      ))}
      <Button
        onClick={() => {
          const blob = new Blob(
            [
              `${object.title}\n\n${objectText(object)}\n\n来源：\n${object.provenance.sourceRefs.map(objectLink).join("\n")}\n版本：${object.revision}`,
            ],
            { type: "text/markdown" },
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "research-note.md";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        导出 Markdown
      </Button>
    </section>
  );
}
