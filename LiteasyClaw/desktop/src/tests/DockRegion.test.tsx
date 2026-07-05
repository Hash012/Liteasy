import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  DockRegion,
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

    const readerTransfer = createDataTransfer("reader");
    readerTransfer.setData(dockItemMimeType, "reader");
    fireEvent.dragOver(region, { dataTransfer: readerTransfer });
    expect(region).not.toHaveClass("drop-active");
    fireEvent.drop(region, { dataTransfer: readerTransfer });
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
});
