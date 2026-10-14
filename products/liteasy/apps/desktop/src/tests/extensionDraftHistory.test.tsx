import "fake-indexeddb/auto";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createExtensionDraftStore, type ExtensionDraft } from "../app/features/workflow-studio/extensionDraftStore";
import { paperLensPackage } from "../app/features/extensions/paperLensPackage";
import { ExtensionDraftHistory } from "../app/features/workflow-studio/ExtensionDraftHistory";

test("saved AI edits can be inspected and restored after reopening the draft", async () => {
  const scope = crypto.randomUUID(), storage = createObjectStorage(scope, () => scope);
  const store = createExtensionDraftStore(storage);
  const original = await store.create("Repair", { ...(await paperLensPackage()).files, "README.md": "Original explanation" });
  const edited = await store.patch(original.id, original.revision, [{ path: "README.md", text: "Incorrect AI edit" }]);
  const reopened = createExtensionDraftStore(storage);
  function Harness() {
    const [draft, setDraft] = useState<ExtensionDraft>(edited);
    return <ExtensionDraftHistory store={reopened} draft={draft} disabled={false} onRestore={setDraft} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "修改历史与恢复" }));
  await user.click(screen.getByRole("combobox", { name: "选择草稿历史" }));
  await user.click(await screen.findByRole("option", { name: /用户保存/ }));
  await screen.findByText("与当前内容有 1 个文件不同。");
  await user.click(screen.getByRole("button", { name: "README.md" }));
  expect(screen.getByText("Original explanation")).toBeVisible();
  expect(screen.getByText("Incorrect AI edit")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "恢复为此内容" }));
  await waitFor(async () => expect((await reopened.get(original.id)).files["README.md"]).toBe("Original explanation"));
  expect((await reopened.revision(original.id, edited.revision)).files["README.md"]).toBe("Incorrect AI edit");
});
