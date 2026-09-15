import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  ObjectWorkbench,
  type WorkbenchViewModel,
} from "../app/features/boards/ObjectWorkbench";
import {
  ObjectPlacementCard,
  resizeCardGeometry,
} from "../app/features/boards/ObjectPlacementCard";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { refOf, type Placement } from "../app/features/objects/object.types";
import { readObjectTransfer } from "../app/features/object-transfer/objectTransfer";
import {
  ObjectSurface,
  objectDisplayText,
} from "../app/features/object-surface/ObjectSurface";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  // jsdom does not implement PointerEvent; preserve pointer coordinates in interaction tests.
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
async function fixture() {
  const scope = crypto.randomUUID();
  const repository = createObjectRepository(
    createObjectStorage(scope, () => scope),
    scope,
  );
  const note = await repository.create({
    kind: "content.note",
    title: "研究笔记",
    content: {
      schema: "liteasy.note/v1",
      payload: { text: "已有笔记正文", origin: "user" },
    },
  });
  const board = await repository.create({
    kind: "workspace.board",
    title: "白板",
    content: { schema: "liteasy.board/v1", payload: { description: "" } },
  });
  const placement: Placement = {
    placementId: "placement",
    revision: "original",
    boardId: board.objectId,
    ref: refOf(note),
    position: { x: 100, y: 100 },
    size: { width: 270, height: 200 },
    viewId: "card",
    collapsed: false,
  };
  const model: WorkbenchViewModel = {
    repository,
    visible: true,
    objects: [note, board],
    board,
    placements: [],
    tray: [],
    status: "",
    busy: false,
    contextTitle: () => "",
    setVisible: vi.fn(),
    closeOpened: vi.fn(),
    setTray: vi.fn(),
    setStatus: vi.fn(),
    addToTray: vi.fn(),
    cancel: vi.fn(),
    openLink: vi.fn(),
    importLegacyArtifacts: vi.fn(),
    selectBoard: vi.fn(),
    createBoard: vi.fn(),
    createNote: vi.fn(),
    place: vi.fn(),
    removePlacement: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    editPlacement: vi.fn().mockResolvedValue(undefined),
    drop: vi.fn().mockResolvedValue(undefined),
    previewContext: vi.fn(),
    submit: vi.fn(),
    saveAnswer: vi.fn(),
    openSource: vi.fn(),
    refresh: vi.fn(),
  };
  return { repository, note, board, placement, model };
}

test("the close action remains in the board header and also closes an active detail view", async () => {
  const f = await fixture();
  function Host() {
    const [visible, setVisible] = useState(true);
    return <ObjectWorkbench model={{ ...f.model, visible, setVisible }} />;
  }
  render(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "已保存的内容" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "研究笔记", exact: true }),
  );
  expect(screen.getByLabelText("内容详情")).toBeInTheDocument();
  expect(
    screen
      .getByRole("button", { name: "关闭白板", exact: true })
      .closest("header"),
  ).toHaveClass("object-workbench-header");
  fireEvent.click(
    screen.getByRole("button", { name: "关闭白板", exact: true }),
  );
  expect(screen.queryByLabelText("研究白板")).not.toBeInTheDocument();
  expect(f.model.closeOpened).toHaveBeenCalledOnce();
});

test("single click edits the note in place, preserves a failed draft and retries the same placement", async () => {
  const f = await fixture();
  const edit = vi
    .fn()
    .mockRejectedValueOnce(new Error("存储已满"))
    .mockResolvedValueOnce(undefined);
  render(
    <ObjectPlacementCard
      p={f.placement}
      object={f.note}
      selected={false}
      setSelected={vi.fn()}
      setDetails={vi.fn()}
      actions={{ current: { ...f.model, editPlacement: edit } }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑笔记正文" }));
  const editor = screen.getByRole("textbox", { name: "编辑卡片正文" });
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: "更新的研究笔记" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("存储已满");
  expect(editor).toHaveValue("更新的研究笔记");
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "编辑卡片正文" }),
    ).not.toBeInTheDocument(),
  );
  expect(edit).toHaveBeenNthCalledWith(1, f.placement, "更新的研究笔记");
  expect(edit).toHaveBeenNthCalledWith(2, f.placement, "更新的研究笔记");
});

test("all four corners and edges resize with actual screen scale, and cancelled drags do not persist", async () => {
  const f = await fixture();
  const { container } = render(
    <ObjectPlacementCard
      p={f.placement}
      object={f.note}
      selected={false}
      setSelected={vi.fn()}
      setDetails={vi.fn()}
      actions={{ current: f.model }}
    />,
  );
  const card = container.querySelector(".object-placement")!;
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    width: 540,
  } as DOMRect);
  expect(
    screen.queryAllByRole("button", { name: /^调整卡片大小/ }),
  ).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "编辑笔记正文" }));
  expect(screen.getAllByRole("button", { name: /^调整卡片大小/ })).toHaveLength(
    8,
  );
  const southeast = screen.getByRole("button", {
    name: "调整卡片大小：右下角",
  });
  fireEvent.pointerDown(southeast, {
    button: 0,
    pointerId: 5,
    clientX: 500,
    clientY: 400,
  });
  fireEvent.pointerMove(southeast, {
    pointerId: 5,
    clientX: 600,
    clientY: 460,
  });
  expect(card).toHaveStyle({ width: "320px", height: "230px" });
  fireEvent.pointerUp(southeast, { pointerId: 5, clientX: 600, clientY: 460 });
  expect(f.model.resize).toHaveBeenCalledWith(f.placement, {
    position: { x: 100, y: 100 },
    size: { width: 320, height: 230 },
  });
  await waitFor(() => expect(card).toHaveStyle({ width: "270px" }));
  const northwest = screen.getByRole("button", {
    name: "调整卡片大小：左上角",
  });
  fireEvent.pointerDown(northwest, {
    button: 0,
    pointerId: 6,
    clientX: 500,
    clientY: 400,
  });
  fireEvent.pointerMove(northwest, {
    pointerId: 6,
    clientX: 400,
    clientY: 300,
  });
  fireEvent.pointerCancel(northwest, { pointerId: 6 });
  expect(f.model.resize).toHaveBeenCalledTimes(1);
  expect(card).toHaveStyle({
    left: "100px",
    top: "100px",
    width: "270px",
    height: "200px",
  });
  fireEvent.keyDown(
    screen.getByRole("button", { name: "调整卡片大小：左边" }),
    { key: "ArrowLeft" },
  );
  expect(f.model.resize).toHaveBeenLastCalledWith(f.placement, {
    position: { x: 80, y: 100 },
    size: { width: 290, height: 200 },
  });
  expect(resizeCardGeometry(f.placement, "nw", 1000, 1000)).toEqual({
    position: { x: 250, y: 220 },
    size: { width: 120, height: 80 },
  });
  expect(resizeCardGeometry(f.placement, "nw", -1000, -1000)).toEqual({
    position: { x: 0, y: 0 },
    size: { width: 370, height: 300 },
  });
});

test("saved notes have an explicit drag handle carrying their existing reference", async () => {
  const f = await fixture();
  render(<ObjectWorkbench model={f.model} />);
  fireEvent.click(screen.getByRole("button", { name: "已保存的内容" }));
  const handle = await screen.findByRole("button", { name: "拖动研究笔记" });
  const payload = new Map<string, string>();
  const data = {
    effectAllowed: "",
    setData: (type: string, value: string) => payload.set(type, value),
    getData: (type: string) => payload.get(type) ?? "",
  };
  fireEvent.dragStart(handle, { dataTransfer: data });
  expect(readObjectTransfer(data)?.refs).toEqual([refOf(f.note)]);
  fireEvent.drop(screen.getByLabelText("白板卡片区域"), { dataTransfer: data });
  expect(f.model.drop).toHaveBeenCalledWith(data);
});

test("a whole card drag moves its existing placement using canvas scale and retains its outward object reference", async () => {
  const f = await fixture();
  const { container } = render(
    <ObjectWorkbench model={{ ...f.model, placements: [f.placement] }} />,
  );
  await screen.findByRole("button", { name: "编辑笔记正文" });
  const card = container.querySelector<HTMLElement>(".object-placement")!;
  const canvas = container.querySelector<HTMLElement>(".object-board-canvas")!;
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    left: 220,
    top: 240,
    width: 540,
  } as DOMRect);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 20,
    top: 40,
    width: 820,
  } as DOMRect);
  const payload = new Map<string, string>();
  const data = {
    effectAllowed: "",
    setData: (type: string, value: string) => payload.set(type, value),
    getData: (type: string) => payload.get(type) ?? "",
  };
  // jsdom has no DragEvent constructor, so use MouseEvent for screen coordinates.
  vi.stubGlobal("DragEvent", MouseEvent);
  fireEvent.dragStart(card, { dataTransfer: data, clientX: 260, clientY: 280 });
  expect(readObjectTransfer(data)?.refs).toEqual([refOf(f.note)]);
  fireEvent.drop(screen.getByLabelText("白板卡片区域"), {
    dataTransfer: data,
    clientX: 420,
    clientY: 540,
  });
  expect(f.model.move).toHaveBeenCalledWith(f.placement, { x: 180, y: 230 });
  expect(f.model.drop).not.toHaveBeenCalled();
  fireEvent.drop(screen.getByLabelText("白板卡片区域"), {
    dataTransfer: data,
    ctrlKey: true,
  });
  expect(f.model.drop).toHaveBeenCalledWith(data);
});

test("annotation cards show their original quote once, start expanded and keep source separate from editing", async () => {
  const f = await fixture();
  const fragment = await f.repository.create({
    kind: "content.fragment",
    title: "批注",
    content: {
      schema: "liteasy.fragment/v1",
      payload: {
        text: "我的理解",
        partial: false,
        anchors: [
          {
            type: "pdf",
            sourceRef: refOf(f.note),
            page: 1,
            quote: { exact: "不可改动的论文原文", prefix: "", suffix: "" },
            rects: [],
            extractor: "test",
            normalization: "test",
            precision: "page",
          },
        ],
      },
    },
  });
  const { container } = render(
    <ObjectPlacementCard
      p={{ ...f.placement, ref: refOf(fragment) }}
      object={fragment}
      selected={false}
      setSelected={vi.fn()}
      setDetails={vi.fn()}
      actions={{ current: f.model }}
    />,
  );
  expect(screen.getByText("不可改动的论文原文")).toBeVisible();
  expect(container.querySelector("details")).toHaveAttribute("open");
  fireEvent.click(screen.getByLabelText("展开或收起原文"));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑摘录为笔记" }));
  expect(screen.getByRole("textbox", { name: "编辑卡片正文" })).toHaveValue(
    "我的理解",
  );
  expect(screen.getAllByText("不可改动的论文原文")).toHaveLength(1);
});

test("editing a source excerpt explicitly creates a note and Escape keeps the original reference", async () => {
  const f = await fixture();
  const fragment = await f.repository.create({
    kind: "content.fragment",
    title: "论文摘录",
    content: {
      schema: "liteasy.fragment/v1",
      payload: {
        text: "论文原文",
        partial: false,
        anchors: [
          {
            type: "semantic",
            sourceRef: refOf(f.note),
            semanticObjectId: "annotation",
          },
        ],
      },
    },
  });
  const placement = { ...f.placement, ref: refOf(fragment) };
  render(
    <ObjectPlacementCard
      p={placement}
      object={fragment}
      selected={false}
      setSelected={vi.fn()}
      setDetails={vi.fn()}
      actions={{ current: f.model }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑摘录为笔记" }));
  expect(screen.getByText("保存为笔记，并保留摘录来源")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "保存为笔记", exact: true }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "编辑卡片正文" }), {
    target: { value: "我对原文的理解" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "编辑卡片正文" }), {
    key: "Escape",
  });
  expect(f.model.editPlacement).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "编辑摘录为笔记" }),
  ).toHaveTextContent("论文原文");
});

test("asset-backed image markdown keeps its caption without rendering an unusable attachment URL", async () => {
  const f = await fixture();
  const note = {
    ...f.note,
    content: {
      schema: "liteasy.note/v1" as const,
      payload: {
        text: "说明\n\n![涂鸦笔记](attachment:asset-id)",
        origin: "user" as const,
      },
    },
  };
  expect(objectDisplayText(note)).toBe("说明\n\n涂鸦笔记");
  render(
    <ObjectSurface
      object={note}
      onAdd={vi.fn()}
      onSource={vi.fn()}
      onDetails={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(screen.getByRole("article")).toHaveTextContent("涂鸦笔记");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("resting cards show only content and keyboard context menus retain selection, movement and deletion", async () => {
  const f = await fixture();
  const selection = vi.fn();
  const { container } = render(
    <ObjectPlacementCard
      p={f.placement}
      object={f.note}
      selected={false}
      setSelected={selection}
      setDetails={vi.fn()}
      actions={{ current: f.model }}
    />,
  );
  const card = container.querySelector(".object-placement") as HTMLElement;
  expect(card.querySelector("strong")).toBeNull();
  expect(card).not.toHaveTextContent("已保存到本机");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "移除卡片" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(card, { key: "F10", shiftKey: true });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "选择卡片", exact: true }),
  );
  expect(selection).toHaveBeenCalledOnce();
  fireEvent.keyDown(card, { key: "ContextMenu" });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "移动卡片", exact: true }),
  );
  fireEvent.keyDown(card, { key: "ArrowDown" });
  expect(f.model.move).toHaveBeenCalledWith(f.placement, { x: 100, y: 120 });
  fireEvent.keyDown(card, { key: "Escape" });
  expect(card).not.toHaveClass("is-moving");
  fireEvent.keyDown(card, { key: "ContextMenu" });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "移除卡片", exact: true }),
  );
  expect(f.model.removePlacement).toHaveBeenCalledWith(f.placement.placementId);
});

test("canvas controls start collapsed and expand only their chosen tool", async () => {
  const f = await fixture();
  render(<ObjectWorkbench model={f.model} />);
  await act(async () => {
    await f.repository.listPlacements(f.board.objectId);
  });
  expect(
    screen.queryByRole("textbox", { name: "笔记内容" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "白板对话" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "添加笔记", exact: true }),
  );
  expect(screen.getByRole("textbox", { name: "笔记内容" })).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "画布设置", exact: true }),
  );
  expect(
    screen.queryByRole("textbox", { name: "笔记内容" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "显示点阵" }));
  expect(screen.getByLabelText("白板卡片区域")).not.toHaveClass("has-grid");
  fireEvent.click(
    screen.getByRole("button", { name: "收起工具", exact: true }),
  );
  expect(
    screen.queryByRole("checkbox", { name: "显示点阵" }),
  ).not.toBeInTheDocument();
});

test("canvas drawing captions stay in the image description instead of duplicating visible content", async () => {
  const f = await fixture();
  const drawing = {
    ...f.note,
    content: {
      schema: "liteasy.note/v1" as const,
      payload: {
        text: "![手绘笔记（3 笔）](attachment:asset-id)",
        origin: "user" as const,
      },
    },
  };
  expect(objectDisplayText(drawing)).toBe("手绘笔记（3 笔）");
  expect(objectDisplayText(drawing, true)).toBe("");
  const { container } = render(
    <ObjectSurface
      presentation="canvas"
      object={drawing}
      onAdd={vi.fn()}
      onSource={vi.fn()}
      onDetails={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("card midpoint handles connect by native drag or two clicks without editing or moving cards", async () => {
  const f = await fixture();
  const second = {
    ...f.placement,
    placementId: "other",
    position: { x: 440, y: 100 },
  };
  const connect = vi.fn().mockResolvedValue(undefined);
  render(
    <ObjectWorkbench
      model={{ ...f.model, placements: [f.placement, second], connect }}
    />,
  );
  const from = (
    await screen.findAllByRole("button", { name: "连接卡片：右边" })
  )[0];
  const to = screen.getAllByRole("button", { name: "连接卡片：左边" })[1];
  const payload = new Map<string, string>();
  const data = {
    types: [] as string[],
    setData(type: string, value: string) {
      payload.set(type, value);
      this.types.push(type);
    },
    getData: (type: string) => payload.get(type) ?? "",
    effectAllowed: "none",
    dropEffect: "none",
  };
  fireEvent.dragStart(from, { dataTransfer: data });
  fireEvent.dragOver(to, { dataTransfer: data });
  fireEvent.drop(to, { dataTransfer: data });
  expect(connect).toHaveBeenCalledWith(f.placement, "right", second, "left");
  expect(f.model.move).not.toHaveBeenCalled();
  expect(f.model.drop).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "编辑卡片正文" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "连接卡片：下边" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "连接卡片：上边" })[1]);
  expect(connect).toHaveBeenLastCalledWith(
    f.placement,
    "bottom",
    second,
    "top",
  );
});
