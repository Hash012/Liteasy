import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { WebDavSettingsPanel } from "../app/features/webdav/WebDavSettingsPanel";
import { disconnectWebDav } from "../app/features/webdav/webdavClient";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke, isTauri: bridge.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => bridge.unlisten) }));
const settings = { endpoint: "https://dav.example.test/", username: "researcher", collection: "personal", autoSync: false };
const conflict = { path: "article.pdf", local: { hash: "a", size: 12, documentId: "doc-1" }, remote: null };

beforeEach(async () => {
  bridge.invoke.mockReset(); bridge.isTauri.mockReturnValue(true); bridge.unlisten.mockClear();
  bridge.invoke.mockResolvedValue(undefined);
  await disconnectWebDav();
  bridge.invoke.mockClear();
  bridge.invoke.mockImplementation(async (command) => {
    if (command === "get_webdav_settings") return settings;
    if (command === "sync_webdav") return { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [conflict] };
  });
});

describe("WebDAV settings", () => {
  test("requires saving changed settings and does not return saved passwords to the form", async () => {
    render(<WebDavSettingsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "立即同步" })).toBeEnabled());
    expect(screen.getByLabelText("WebDAV 密码")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("WebDAV 服务器地址"), { target: { value: "https://dav.example.test/new/" } });
    expect(screen.getByRole("button", { name: "立即同步" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("WebDAV 密码"), { target: { value: "application-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(screen.getByLabelText("WebDAV 密码")).toHaveValue(""));
    expect(bridge.invoke).toHaveBeenCalledWith("save_webdav_settings", { settings: { ...settings, endpoint: "https://dav.example.test/new/" }, password: "application-secret" });
    expect(screen.queryByText("application-secret")).not.toBeInTheDocument();
  });
  test("sends the exact conflict versions with the user's chosen resolution", async () => {
    render(<WebDavSettingsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "立即同步" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    expect(await screen.findByText("article.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保留本地版本" }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("sync_webdav", { resolutions: [{ conflict, choice: "local" }] }));
    await waitFor(() => expect(bridge.unlisten).toHaveBeenCalledTimes(2));
  });
  test("shows the remote filename for document rename conflicts", async () => {
    const renamed = { ...conflict, remote: conflict.local, remotePath: "renamed/article.pdf" };
    bridge.invoke.mockImplementation(async (command) => command === "get_webdav_settings" ? settings : { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [renamed] });
    render(<WebDavSettingsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "立即同步" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    expect(await screen.findByText("远端路径：renamed/article.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用远端版本" }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith("sync_webdav", { resolutions: [{ conflict: renamed, choice: "remote" }] }));
    await waitFor(() => expect(bridge.unlisten).toHaveBeenCalledTimes(2));
  });
  test("reports connection failures and releases the operation lock for retry", async () => {
    bridge.invoke.mockImplementation(async (command) => {
      if (command === "get_webdav_settings") return settings;
      if (command === "verify_webdav") throw new Error("WebDAV 身份验证失败");
    });
    render(<WebDavSettingsPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "验证服务器" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "验证服务器" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("身份验证失败");
    expect(screen.getByRole("button", { name: "验证服务器" })).toBeEnabled();
  });
  test("browser mode makes no native connection calls", async () => {
    bridge.isTauri.mockReturnValue(false);
    render(<WebDavSettingsPanel />);
    await act(async () => {});
    expect(screen.getByText("请在桌面版中配置 WebDAV 同步。")).toBeInTheDocument();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
});
