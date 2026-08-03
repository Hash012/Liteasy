import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryLocationPanel } from "../app/features/library/LibraryLocationPanel";

test("shows the current library root and opens it in the file manager", async () => {
  const onOpenInFileManager = vi.fn(async () => {});
  render(
    <LibraryLocationPanel
      onOpenInFileManager={onOpenInFileManager}
      rootPath="C:/Users/reader/AppData/Roaming/liteasy/user-library"
    />
  );

  expect(screen.getByText("C:/Users/reader/AppData/Roaming/liteasy/user-library")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "在文件管理器中打开" }));

  expect(onOpenInFileManager).toHaveBeenCalledTimes(1);
});

test("moves the library to a typed root and reports success", async () => {
  const onChangeRoot = vi.fn(async () => {});
  render(<LibraryLocationPanel onChangeRoot={onChangeRoot} rootPath="C:/old/user-library" />);

  const moveButton = screen.getByRole("button", { name: "移动文献库" });
  // Nothing to move to yet, so the action stays out of reach.
  expect(moveButton.hasAttribute("disabled")).toBe(true);

  await userEvent.type(screen.getByLabelText("新的文献库根目录完整路径"), "D:/papers/library");
  await userEvent.click(screen.getByRole("button", { name: "移动文献库" }));

  expect(onChangeRoot).toHaveBeenCalledWith("D:/papers/library");
  await waitFor(() => {
    expect(screen.getByText("文献库已迁移到新目录。")).toBeTruthy();
  });
});

test("surfaces the reason a move failed instead of failing silently", async () => {
  const onChangeRoot = vi.fn(async () => {
    throw new Error("目标目录中已存在 papers，请先清空该目录或另选位置。");
  });
  render(<LibraryLocationPanel onChangeRoot={onChangeRoot} rootPath="C:/old/user-library" />);

  await userEvent.type(screen.getByLabelText("新的文献库根目录完整路径"), "D:/taken");
  await userEvent.click(screen.getByRole("button", { name: "移动文献库" }));

  await waitFor(() => {
    expect(
      screen.getByText("目标目录中已存在 papers，请先清空该目录或另选位置。")
    ).toBeTruthy();
  });
});

test("says so plainly when the runtime cannot manage the library directory", () => {
  render(<LibraryLocationPanel rootPath={null} />);

  expect(screen.getByText("桌面端才能管理本地文献库目录。")).toBeTruthy();
});
