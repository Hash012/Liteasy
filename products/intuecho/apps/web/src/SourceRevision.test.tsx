import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SourceRevision } from "./SourceRevision";
import { communityApi } from "./communityApi";
vi.mock("./communityApi", () => ({ communityApi: { sourceRevision: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const reference = { sourceNamespace: "intuecho.reply" as const, sourceId: "reply/1", revision: 3, locator: { kind: "source_passage" as const, page: 7, anchorHash: "anchor-v3" } };
test("explicit revision inspection distinguishes historical and current and pins the Desktop link", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.sourceRevision).mockResolvedValue({ ...reference, currentRevision: 4, historical: true, body: "Historical permitted reply" });
  render(<SourceRevision reference={reference} />);
  expect(communityApi.sourceRevision).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "在 Liteasy 打开此来源版本" })).toHaveAttribute("href", "liteasy://community-sources/intuecho.reply/reply%2F1?revision=3&page=7&anchorHash=anchor-v3");
  await user.click(screen.getByRole("button", { name: "核对引用版本" }));
  expect(await screen.findByText("历史引用：修订 3；当前修订 4")).toBeInTheDocument();
  expect(communityApi.sourceRevision).toHaveBeenCalledWith(reference);
});
test("withdrawn or unauthorized source responses erase a previously loaded body", async () => {
  const user = userEvent.setup();
  vi.mocked(communityApi.sourceRevision).mockResolvedValueOnce({ ...reference, currentRevision: 3, historical: false, body: "ORG_BODY" }).mockRejectedValueOnce(new Error("SOURCE_NOT_FOUND"));
  render(<SourceRevision reference={reference} />);
  await user.click(screen.getByRole("button", { name: "核对引用版本" }));
  await screen.findByText("ORG_BODY");
  await user.click(screen.getByRole("button", { name: "核对引用版本" }));
  expect(await screen.findByRole("status")).toHaveTextContent("无法访问此来源版本");
  expect(screen.queryByText("ORG_BODY")).not.toBeInTheDocument();
});
