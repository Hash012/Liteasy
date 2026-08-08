import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  DockRegion,
  dockDynamicTabMimeType,
  dockItemMimeType
} from "../app/features/dock/DockRegion";

function createDataTransfer(itemId: string) {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
      this.types = [...values.keys()];
    },
    types: itemId ? [dockItemMimeType] : []
  };
}

describe("DockRegion", () => {
  test("renders accessible tabs and activates them by click and keyboard", async () => {
    const user = userEvent.setup();
    const onActivateItem = vi.fn();

    render(
      <DockRegion
        layout={{
          activeItemId: "library",
          itemIds: ["library", "organization"]
        }}
        onActivateItem={onActivateItem}
        onCloseItem={vi.fn()}
        onMoveItem={vi.fn()}
        regionId="left"
        renderItem={(itemId) => <div>{itemId} content</div>}
      />
    );

    const tabList = screen.getByRole("tablist", { name: "左栏标签页" });
    await user.click(within(tabList).getByRole("tab", { name: "组织" }));
    expect(onActivateItem).toHaveBeenCalledWith("organization");

    fireEvent.keyDown(within(tabList).getByRole("tab", { name: "文献库" }), {
      key: "ArrowRight"
    });
    expect(onActivateItem).toHaveBeenLastCalledWith("organization");
  });

  test("moves an allowed tool tab between regions from the keyboard", () => {
    const onMoveItem = vi.fn();
    render(
      <DockRegion
        layout={{ activeItemId: "assistant", itemIds: ["assistant"] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveItem={onMoveItem}
        regionId="right"
        renderItem={() => <div>assistant</div>}
      />
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Liteasy Chat" }), {
      altKey: true,
      key: "ArrowDown",
      shiftKey: true
    });

    expect(onMoveItem).toHaveBeenCalledWith("assistant", "bottom");
  });

  test("renders document tabs with a file icon and a truncatable title", () => {
    render(
      <DockRegion
        dynamicTabs={[
          {
            icon: <svg aria-label="PDF 文件" />,
            id: "pdf-colbert",
            kind: "document",
            onActivate: vi.fn(),
            onClose: vi.fn(),
            render: () => <div>PDF content</div>,
            selected: true,
            title: "ColBERT: Efficient and Effective Passage Search"
          }
        ]}
        layout={{ activeItemId: null, itemIds: [] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveItem={vi.fn()}
        regionId="main"
        renderItem={() => null}
      />
    );

    const documentTab = screen.getByRole("tab", { name: "ColBERT: Efficient and Effective Passage Search" });
    expect(documentTab).toHaveClass("dock-document-tab");
    expect(documentTab.querySelector("svg")).toBeInTheDocument();
    expect(within(documentTab).getByText("ColBERT: Efficient and Effective Passage Search")).toHaveClass("dock-tab-title");
  });

  test("shows only the shared logo when a region has no tabs", () => {
    render(
      <DockRegion
        layout={{ activeItemId: null, itemIds: [] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveItem={vi.fn()}
        regionId="right"
        renderItem={() => null}
      />
    );

    const region = screen.getByLabelText("右栏 Dock 区域");
    expect(within(region).getByRole("img", { name: "LiteasyClaw" })).toBeInTheDocument();
    expect(within(region).queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(region).queryByText(/暂无|请选择/)).not.toBeInTheDocument();
  });

  test("accepts a valid dock item drop and rejects an invalid one", () => {
    const onMoveItem = vi.fn();
    render(
      <DockRegion
        layout={{ activeItemId: null, itemIds: [] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveItem={onMoveItem}
        regionId="left"
        renderItem={() => null}
      />
    );
    const region = screen.getByLabelText("左栏 Dock 区域");

    const assistantTransfer = createDataTransfer("assistant");
    assistantTransfer.setData(dockItemMimeType, "assistant");
    fireEvent.dragOver(region, { dataTransfer: assistantTransfer });
    expect(region).toHaveClass("drop-active");
    fireEvent.drop(region, { dataTransfer: assistantTransfer });
    expect(onMoveItem).toHaveBeenCalledWith("assistant", "left");

    const unknownTransfer = createDataTransfer("unknown");
    unknownTransfer.setData(dockItemMimeType, "unknown");
    fireEvent.dragOver(region, { dataTransfer: unknownTransfer });
    expect(region).not.toHaveClass("drop-active");
    fireEvent.drop(region, { dataTransfer: unknownTransfer });
    expect(onMoveItem).toHaveBeenCalledTimes(1);
  });

  test("shows a close button for static dock tabs", async () => {
    const user = userEvent.setup();
    const onCloseItem = vi.fn();
    render(
      <DockRegion
        layout={{ activeItemId: "assistant", itemIds: ["assistant"] }}
        onActivateItem={vi.fn()}
        onCloseItem={onCloseItem}
        onMoveItem={vi.fn()}
        regionId="right"
        renderItem={() => <div>assistant</div>}
      />
    );

    await user.click(screen.getByRole("button", { name: "关闭 Liteasy Chat" }));

    expect(onCloseItem).toHaveBeenCalledWith("assistant");
  });

  test("moves a dynamic artifact tab to another dock region", () => {
    const onMoveDynamicTab = vi.fn();
    const { rerender } = render(
      <DockRegion
        dynamicTabs={[
          {
            draggable: true,
            id: "artifact-1",
            onActivate: vi.fn(),
            render: () => <div>artifact content</div>,
            selected: true,
            title: "ColBERT 文献树"
          }
        ]}
        layout={{ activeItemId: null, itemIds: [] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveDynamicTab={onMoveDynamicTab}
        onMoveItem={vi.fn()}
        regionId="main"
        renderItem={() => null}
      />
    );

    const artifactTab = screen.getByRole("tab", { name: "ColBERT 文献树" });
    const transfer = createDataTransfer("");
    fireEvent.dragStart(artifactTab, { dataTransfer: transfer });
    expect(transfer.getData(dockDynamicTabMimeType)).toBe("artifact-1");

    rerender(
      <DockRegion
        layout={{ activeItemId: "assistant", itemIds: ["assistant"] }}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onMoveDynamicTab={onMoveDynamicTab}
        onMoveItem={vi.fn()}
        regionId="right"
        renderItem={() => <div>assistant</div>}
      />
    );
    const rightRegion = screen.getByLabelText("右栏 Dock 区域");
    fireEvent.dragOver(rightRegion, { dataTransfer: transfer });
    expect(rightRegion).toHaveClass("drop-active");
    fireEvent.drop(rightRegion, { dataTransfer: transfer });

    expect(onMoveDynamicTab).toHaveBeenCalledWith("artifact-1", "right");
  });
});
