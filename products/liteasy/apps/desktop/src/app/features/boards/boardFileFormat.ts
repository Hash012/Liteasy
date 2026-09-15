import { z } from "zod";
import {
  objectRefSchema,
  objectText,
  refOf,
  type BoardConnection,
  type BoardSide,
  type ObjectEnvelope,
  type ObjectRef,
  type Placement,
} from "../objects/object.types";
import type {
  ObjectDraft,
  ObjectRepository,
} from "../objects/objectRepository";

// JSON Canvas 1.0: https://jsoncanvas.org/spec/1.0/
// Keep extension fields when writing an opened file; unsupported visual types
// are rejected before import so a save never quietly discards their contents.
const side = z.enum(["top", "right", "bottom", "left"]);
const nodeSchema = z
  .object({
    id: z.string().min(1).max(512),
    type: z.enum(["text", "file", "link", "group"]),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
    text: z.string().optional(),
    file: z.string().optional(),
    url: z.string().optional(),
    subpath: z.string().optional(),
  })
  .passthrough();
const edgeSchema = z
  .object({
    id: z.string().min(1).max(512),
    fromNode: z.string(),
    toNode: z.string(),
    fromSide: side.optional(),
    toSide: side.optional(),
    fromEnd: z.enum(["none", "arrow"]).optional(),
    toEnd: z.enum(["none", "arrow"]).optional(),
    label: z.string().optional(),
  })
  .passthrough();
const canvasSchema = z
  .object({
    nodes: z.array(nodeSchema).max(1000).default([]),
    edges: z.array(edgeSchema).max(1000).default([]),
  })
  .passthrough();
export type CanvasDocument = z.infer<typeof canvasSchema>;
export type BoardFileBinding = {
  mountId: string;
  path: string;
  name: string;
  version: string | null;
  savedRevision: string;
  document: CanvasDocument;
};
export type BoardFileSnapshot = {
  mountId: string;
  path: string;
  name: string;
  text: string;
  version: string | null;
};
export function parseCanvasFile(text: string): CanvasDocument {
  if (text.length > 10_000_000) throw new Error("白板文件过大，请拆分后导入。");
  let result: ReturnType<typeof canvasSchema.safeParse>;
  try {
    result = canvasSchema.safeParse(JSON.parse(text));
  } catch {
    throw new Error("白板文件不是有效的 JSON Canvas 文件。");
  }
  if (!result.success) throw new Error("白板文件格式无效，请检查卡片和连接。");
  const document = result.data;
  const ids = new Set<string>();
  for (const node of document.nodes) {
    if (ids.has(node.id)) throw new Error("白板包含重复的卡片编号。");
    ids.add(node.id);
    if (node.type === "group")
      throw new Error("此白板包含分组卡片，暂不能导入；原文件未修改。");
    if (node.type === "text" && node.text === undefined)
      throw new Error("文字卡片缺少正文。");
    if (node.type === "file" && (!node.file || !/\.md$/i.test(node.file)))
      throw new Error(
        "此白板包含非 Markdown 文件卡片，暂不能导入；原文件未修改。",
      );
    if (node.type === "file" && node.subpath)
      throw new Error("此白板包含文件标题或块引用，暂不能导入；原文件未修改。");
    if (node.type === "link" && !node.url)
      throw new Error("链接卡片缺少地址。");
  }
  const edgeIds = new Set<string>();
  for (const edge of document.edges) {
    if (
      edgeIds.has(edge.id) ||
      !ids.has(edge.fromNode) ||
      !ids.has(edge.toNode)
    )
      throw new Error("白板连接指向不存在的卡片，或连接编号重复。");
    edgeIds.add(edge.id);
  }
  return document;
}
async function portableText(
  object: ObjectEnvelope,
  repository: ObjectRepository,
) {
  let text = objectText(object);
  for (const descriptor of object.assets) {
    const asset = await repository.readAsset(descriptor.assetId);
    const url = `data:${asset.mediaType};base64,${asset.base64}`;
    const attachment = `attachment:${descriptor.assetId}`;
    text = text.includes(attachment)
      ? text.split(attachment).join(url)
      : `${text}\n\n![附件](${url})`;
  }
  if (object.kind !== "content.fragment") return text;
  const quotes = [
    ...new Set(
      object.content.payload.anchors.flatMap((anchor) =>
        "quote" in anchor && anchor.quote.exact && anchor.quote.exact !== text
          ? [anchor.quote.exact]
          : [],
      ),
    ),
  ];
  return quotes.length
    ? `${text}\n\n<details open>\n<summary>原文</summary>\n\n${quotes.join("\n\n")}\n\n</details>`
    : text;
}
export async function prepareCanvasImport(input: {
  document: CanvasDocument;
  repository: ObjectRepository;
  file: BoardFileSnapshot;
  readFile: (mountId: string, path: string) => Promise<BoardFileSnapshot>;
}) {
  // Validate and read every external file first; a missing grant or file cannot
  // leave a half-created board or silently replace a file card with blank text.
  const readings = new Map<string, Promise<BoardFileSnapshot>>();
  const files = await Promise.all(
    input.document.nodes.map(async (node) => {
      if (node.type !== "file") return undefined;
      let reading = readings.get(node.file!);
      if (!reading) {
        reading = input.readFile(input.file.mountId, node.file!);
        readings.set(node.file!, reading);
      }
      return reading;
    }),
  );
  const projections = new Map<string, Promise<ObjectRef>>();
  const origin = {
    x: Math.min(0, ...input.document.nodes.map((node) => node.x)),
    y: Math.min(0, ...input.document.nodes.map((node) => node.y)),
  };
  const nodes = await Promise.all(
    input.document.nodes.map(async (node, index) => {
      let ref: ObjectRef | undefined;
      const file = files[index];
      if (file) {
        const key = `note-file-${file.mountId}-${file.path}`;
        let projection = projections.get(key);
        if (!projection) {
          projection = (async () => {
            const object = await input.repository.projectLegacy(key, {
              kind: "content.note",
              title: file.name,
              content: {
                schema: "liteasy.note/v1",
                payload: { text: file.text, origin: "external" },
              },
            });
            await input.repository.setObjectFileBinding(object.objectId, {
              mountId: file.mountId,
              path: file.path,
              version: file.version,
              objectRevision: object.revision,
            });
            return refOf(object);
          })();
          projections.set(key, projection);
        }
        ref = await projection;
      } else {
        const extension = node.liteasy as { ref?: unknown } | undefined;
        const candidate = objectRefSchema.safeParse(extension?.ref);
        if (candidate.success) {
          try {
            const existing = await input.repository.get(candidate.data);
            // A modified portable text node is user-authored content. Its old
            // extension must not hide an edit made in Obsidian.
            if (
              node.type !== "text" ||
              (await portableText(existing, input.repository)) === node.text
            )
              ref = candidate.data;
          } catch {
            /* Foreign/deleted references import as portable text. */
          }
        }
      }
      const text = node.type === "link" ? node.url! : (node.text ?? "");
      const draft: ObjectDraft = {
        kind: "content.note",
        title: text.split("\n")[0].slice(0, 80) || "笔记",
        content: {
          schema: "liteasy.note/v1",
          payload: { text, origin: "user" },
        },
      };
      return {
        id: node.id,
        ref,
        draft: ref ? undefined : draft,
        position: { x: node.x - origin.x, y: node.y - origin.y },
        size: { width: node.width, height: node.height },
      };
    }),
  );
  const edges: BoardConnection[] = input.document.edges.map((edge) => ({
    edgeId: edge.id,
    from: edge.fromNode,
    to: edge.toNode,
    fromSide: edge.fromSide,
    toSide: edge.toSide,
    fromEnd: edge.fromEnd,
    toEnd: edge.toEnd,
    label: edge.label,
    kind: "related_to",
  }));
  return { nodes, edges };
}
export async function serializeCanvasFile(input: {
  board: ObjectEnvelope;
  placements: Placement[];
  edges: BoardConnection[];
  repository: ObjectRepository;
  binding?: BoardFileBinding;
  destinationMountId?: string;
}): Promise<string> {
  const original = input.binding?.document;
  const origin = {
    x: Math.min(0, ...(original?.nodes.map((node) => node.x) ?? [])),
    y: Math.min(0, ...(original?.nodes.map((node) => node.y) ?? [])),
  };
  const nodes = await Promise.all(
    input.placements.map(async (placement) => {
      const object = await input.repository.get(placement.ref);
      const previous = original?.nodes.find(
        (node) => node.id === placement.placementId,
      );
      const file = await input.repository.getObjectFileBinding(object.objectId);
      const previousRef = (previous?.liteasy as { ref?: ObjectRef } | undefined)
        ?.ref;
      const canUseFile =
        file &&
        file.mountId === input.destinationMountId &&
        file.objectRevision === object.revision &&
        (await input.repository.resolveLatest(object.objectId)).revision ===
          object.revision &&
        (!previousRef ||
          JSON.stringify(previousRef) === JSON.stringify(placement.ref));
      const base = { ...previous };
      delete base.file;
      delete base.subpath;
      delete base.url;
      delete base.text;
      return {
        ...base,
        id: placement.placementId,
        x: Math.round(placement.position.x + origin.x),
        y: Math.round(placement.position.y + origin.y),
        width: Math.round(placement.size.width),
        height: Math.round(placement.size.height),
        ...(canUseFile
          ? { type: "file" as const, file: file.path }
          : previous?.type === "link" && previous.url === objectText(object)
            ? { type: "link" as const, url: previous.url }
            : {
                type: "text" as const,
                text: await portableText(object, input.repository),
              }),
        liteasy: { ref: placement.ref, title: object.title },
      };
    }),
  );
  const edges = input.edges.map((edge) => ({
    ...original?.edges.find((item) => item.id === edge.edgeId),
    id: edge.edgeId,
    fromNode: edge.from,
    toNode: edge.to,
    fromSide: edge.fromSide ?? "bottom",
    toSide: edge.toSide ?? "top",
    fromEnd: edge.fromEnd,
    toEnd: edge.toEnd,
    label: edge.label,
  }));
  return `${JSON.stringify({ ...original, nodes, edges, liteasy: { boardRef: refOf(input.board), title: input.board.title } }, null, 2)}\n`;
}
export function connectionPoint(
  placement: Pick<Placement, "position" | "size">,
  side: BoardSide,
) {
  const { x, y } = placement.position;
  const { width, height } = placement.size;
  return {
    x: side === "left" ? x : side === "right" ? x + width : x + width / 2,
    y: side === "top" ? y : side === "bottom" ? y + height : y + height / 2,
  };
}
type ConnectionPoint = { x: number; y: number };
type ConnectionBox = Pick<Placement, "position" | "size">;
const direction: Record<BoardSide, [number, number]> = {
  top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0],
};
function inside(point: ConnectionPoint, box: ConnectionBox) {
  return point.x > box.position.x && point.x < box.position.x + box.size.width &&
    point.y > box.position.y && point.y < box.position.y + box.size.height;
}
function crosses(a: ConnectionPoint, b: ConnectionPoint, box: ConnectionBox) {
  const left = box.position.x, right = left + box.size.width;
  const top = box.position.y, bottom = top + box.size.height;
  return a.x === b.x
    ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
    : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
}
function outward(point: ConnectionPoint, side: BoardSide, boxes: ConnectionBox[]) {
  const vector = direction[side];
  let distance = 24;
  // Close facing cards may have less than 48px between them. Keep the
  // outward segments inside that gap instead of extending into the other card.
  for (const box of boxes) {
    const left = box.position.x, right = left + box.size.width;
    const top = box.position.y, bottom = top + box.size.height;
    const hit = side === "right" && point.y > top && point.y < bottom ? left - point.x
      : side === "left" && point.y > top && point.y < bottom ? point.x - right
      : side === "bottom" && point.x > left && point.x < right ? top - point.y
      : side === "top" && point.x > left && point.x < right ? point.y - bottom : Infinity;
    if (hit > 0) distance = Math.min(distance, hit / 2);
  }
  return { x: point.x + vector[0] * distance, y: point.y + vector[1] * distance };
}
function outsideRoute(from: ConnectionPoint, fromSide: BoardSide, to: ConnectionPoint, toSide: BoardSide, boxes: ConnectionBox[]) {
  const start = outward(from, fromSide, boxes), end = outward(to, toSide, boxes);
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap(box => [box.position.x - 24, box.position.x + box.size.width + 24])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap(box => [box.position.y - 24, box.position.y + box.size.height + 24])])].sort((a, b) => a - b);
  const points = xs.flatMap(x => ys.map(y => ({ x, y })));
  const source = xs.indexOf(start.x) * ys.length + ys.indexOf(start.y);
  const target = xs.indexOf(end.x) * ys.length + ys.indexOf(end.y);
  const costs = new Map([[source, 0]]), previous = new Map<number, number>();
  const pending = new Set([source]), visited = new Set<number>();
  while (pending.size) {
    const current = [...pending].reduce((a, b) => costs.get(a)! <= costs.get(b)! ? a : b);
    pending.delete(current);
    if (current === target) break;
    visited.add(current);
    const x = Math.floor(current / ys.length), y = current % ys.length;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const next = nx * ys.length + ny, a = points[current], b = points[next];
      if (visited.has(next) || boxes.some(box => inside(b, box) || crosses(a, b, box))) continue;
      const cost = costs.get(current)! + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (Math.min(a.x, a.y, b.x, b.y) < 0 ? 0.01 : 0);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); previous.set(next, current); pending.add(next);
    }
  }
  if (!costs.has(target)) return undefined;
  const route = [to, end];
  for (let current = target; current !== source;) {
    current = previous.get(current)!;
    if (current === undefined) return undefined;
    route.push(points[current]);
  }
  route.push(from);
  return route.reverse().map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
}
export function connectionPath(
  from: ConnectionPoint,
  fromSide: BoardSide,
  to: ConnectionPoint,
  toSide: BoardSide,
  boxes?: [ConnectionBox, ConnectionBox],
) {
  const length = Math.max(40, Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const a = direction[fromSide], b = direction[toSide];
  const c1 = { x: from.x + a[0] * length, y: from.y + a[1] * length };
  const c2 = { x: to.x + b[0] * length, y: to.y + b[1] * length };
  const curve = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
  if (!boxes) return curve;
  for (let step = 1; step < 40; step++) {
    const t = step / 40, u = 1 - t;
    const point = { x: u ** 3 * from.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * to.x,
      y: u ** 3 * from.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * to.y };
    if (boxes.some(box => inside(point, box))) return outsideRoute(from, fromSide, to, toSide, boxes) ?? curve;
  }
  return curve;
}
