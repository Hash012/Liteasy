import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PaperServicesSettingsPanel } from "../app/features/paper-services/PaperServicesSettingsPanel";
import { ExternalNavigation } from "../app/features/navigation/externalNavigation";
import * as transport from "../app/features/paper-services/paperServiceTransport";
import { clearStoredAccountSession } from "../app/features/account/accountSessionStorage";
import type { SettingsState } from "../app/features/settings/settings.types";

const config = { provider: "crossref" as const, endpoint: "https://connection-settings.example.test" };
const settings: Partial<SettingsState> = { "papers.metadata_provider": config.provider, "papers.metadata_endpoint": config.endpoint };
function success() { return Response.json({ message: { title: ["Deep learning"], DOI: "10.1038/nature14539" } }); }
function deferredFetch() {
  let complete!: (response: Response) => void;
  let signal!: AbortSignal;
  const fetch = vi.fn((_url: URL, init?: RequestInit) => { signal = init!.signal!; return new Promise<Response>((resolve) => { complete = resolve; }); });
  vi.stubGlobal("fetch", fetch);
  return { fetch, signal: () => signal, complete: (response: Response) => complete(response) };
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await transport.deletePaperServiceKey(config);
});

test("tests public queries and requires saving edited keys before testing stored credentials", async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => { requests.push(init!); return success(); }));
  render(<PaperServicesSettingsPanel settings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  expect(await screen.findByRole("status")).toHaveTextContent("连接正常，已读取公开测试论文《Deep learning》");
  expect(new Headers(requests[0].headers).has("Crossref-Plus-API-Token")).toBe(false);
  fireEvent.change(screen.getByLabelText("crossref API key"), { target: { value: "saved-private-key" } });
  expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
  expect(screen.getByText("请先保存新密钥，再测试连接。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("密钥已保存"));
  expect(screen.getByLabelText("crossref API key")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接正常"));
  expect(new Headers(requests[1].headers).get("Crossref-Plus-API-Token")).toBe("Bearer saved-private-key");
  fireEvent.click(screen.getByRole("button", { name: "删除密钥" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("密钥已删除"));
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接正常"));
  expect(new Headers(requests[2].headers).has("Crossref-Plus-API-Token")).toBe(false);
});

test("cancels the old endpoint test and ignores a late result after the new endpoint succeeds", async () => {
  const pending = deferredFetch();
  const view = render(<PaperServicesSettingsPanel settings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  const oldSignal = pending.signal();
  view.rerender(<PaperServicesSettingsPanel settings={{ ...settings, "papers.metadata_endpoint": "https://next-connection.example.test" }} />);
  expect(oldSignal.aborted).toBe(true);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  pending.fetch.mockImplementationOnce(async () => success());
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接正常"));
  await act(async () => { pending.complete(new Response("old credentials rejected", { status: 401 })); });
  expect(screen.getByRole("status")).toHaveTextContent("连接正常");
  expect(screen.queryByText(/服务未接受/)).not.toBeInTheDocument();
});

test("cancels on provider changes and clears the previous credential state", async () => {
  await transport.savePaperServiceKey(config, "old-key");
  const pending = deferredFetch();
  const view = render(<PaperServicesSettingsPanel settings={settings} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "删除密钥" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  view.rerender(<PaperServicesSettingsPanel settings={{ "papers.metadata_provider": "openalex" }} />);
  expect(pending.signal().aborted).toBe(true);
  expect(screen.getByLabelText("openalex API key")).toHaveValue("");
  expect(screen.getByRole("button", { name: "删除密钥" })).toBeDisabled();
  await act(async () => { pending.complete(success()); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("supports cancellation and retry without allowing cancelled responses to replace the result", async () => {
  const pending = deferredFetch();
  render(<PaperServicesSettingsPanel settings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  fireEvent.click(screen.getByRole("button", { name: "取消测试" }));
  expect(pending.signal().aborted).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("测试已取消");
  pending.fetch.mockImplementationOnce(async () => success());
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接正常"));
  await act(async () => { pending.complete(new Response("old failure", { status: 429 })); });
  expect(screen.getByRole("status")).toHaveTextContent("连接正常");
});

test("deleting stored credentials cancels the active test and retains the deletion receipt", async () => {
  await transport.savePaperServiceKey(config, "old-key");
  const pending = deferredFetch();
  render(<PaperServicesSettingsPanel settings={settings} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "删除密钥" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  fireEvent.click(screen.getByRole("button", { name: "删除密钥" }));
  expect(pending.signal().aborted).toBe(true);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("密钥已删除"));
  await act(async () => { pending.complete(success()); });
  expect(screen.getByRole("status")).toHaveTextContent("密钥已删除");
  expect(await transport.hasPaperServiceKey(config)).toBe(false);
});

test("does not project a late credential save into another service", async () => {
  let finish!: () => void;
  vi.spyOn(transport, "savePaperServiceKey").mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = render(<PaperServicesSettingsPanel settings={settings} />);
  fireEvent.change(screen.getByLabelText("crossref API key"), { target: { value: "pending-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存密钥" }));
  view.rerender(<PaperServicesSettingsPanel settings={{ "papers.metadata_provider": "semantic-scholar" }} />);
  fireEvent.change(screen.getByLabelText("semantic-scholar API key"), { target: { value: "new-entry" } });
  await act(async () => { finish(); });
  expect(screen.getByLabelText("semantic-scholar API key")).toHaveValue("new-entry");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除密钥" })).toBeDisabled();
});

test.each(["unmount", "account"])("cancels a running test on %s", async (change) => {
  const pending = deferredFetch();
  const view = render(<PaperServicesSettingsPanel settings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  if (change === "unmount") view.unmount();
  else { clearStoredAccountSession(); view.rerender(<PaperServicesSettingsPanel settings={settings} />); }
  expect(pending.signal().aborted).toBe(true);
  await act(async () => { pending.complete(success()); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test.each([
  ["crossref", "了解 Crossref Plus 密钥", "https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/"],
  ["openalex", "获取 OpenAlex API key", "https://openalex.org/settings/api"],
  ["semantic-scholar", "申请 Semantic Scholar API key", "https://www.semanticscholar.org/product/api"]
] as const)("opens the %s official key page through desktop external navigation", async (provider, label, url) => {
  const open = vi.spyOn(ExternalNavigation, "open").mockResolvedValue();
  render(<PaperServicesSettingsPanel settings={{ "papers.metadata_provider": provider }} />);
  const link = screen.getByRole("link", { name: label });
  expect(link).toHaveAttribute("href", url);
  fireEvent.click(link);
  expect(open).toHaveBeenCalledWith(url);
  await act(async () => {});
});

test("does not offer a connection test that would upload to MinerU", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<PaperServicesSettingsPanel settings={{ "papers.metadata_provider": "cloud", "papers.mineru_mode": "official" }} />);
  expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("mineru API key")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存密钥" })).toBeInTheDocument();
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled();
});
