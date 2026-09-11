import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ModelConnectionPanel } from "../app/features/models/ModelConnectionPanel";
import { hasDirectModelKey, saveDirectModelKey, deleteDirectModelKey, directModelTransport } from "../app/features/models/directModelTransport";

vi.mock("../app/features/models/directModelTransport", () => ({
  hasDirectModelKey: vi.fn(async () => false),
  saveDirectModelKey: vi.fn(async () => undefined),
  deleteDirectModelKey: vi.fn(async () => undefined),
  directModelTransport: vi.fn(async ({ onChunk }) => {
    onChunk?.(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"test transport answer"}}]}\n\ndata: [DONE]\n\n'));
    return "";
  })
}));

beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasDirectModelKey).mockResolvedValue(false); });

test("offers mainstream providers, editable endpoint/model, and password-masked credentials without a login", async () => {
  const onUpdateSetting = vi.fn();
  render(<ModelConnectionPanel onUpdateSetting={onUpdateSetting} />);
  expect(screen.getByText(/无需登录 Liteasy/)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anthropic / Claude" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Google Gemini" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("API 服务商"), { target: { value: "deepseek" } });
  expect(screen.getByLabelText("API 基础地址")).toHaveValue("https://api.deepseek.com");
  fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "custom-deepseek-model" } });
  const key = screen.getByLabelText("API key");
  expect(key).toHaveAttribute("type", "password");
  fireEvent.change(key, { target: { value: "test-only-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));
  await screen.findByText(/连接成功/);
  expect(screen.getByLabelText("测试响应")).toHaveValue("test transport answer");
  expect(saveDirectModelKey).toHaveBeenCalledWith(expect.objectContaining({ provider: "deepseek", model: "custom-deepseek-model" }), "test-only-secret");
  expect(onUpdateSetting).toHaveBeenCalledWith({ intent: "update_setting", target: "models.connection_mode", value: "direct" });
  expect(JSON.stringify(onUpdateSetting.mock.calls)).not.toContain("test-only-secret");
  expect(key).toHaveValue("");
});

test("keeps a saved key when left blank, and deletes it explicitly", async () => {
  vi.mocked(hasDirectModelKey).mockResolvedValue(true);
  render(<ModelConnectionPanel onUpdateSetting={vi.fn()} />);
  const remove = await screen.findByRole("button", { name: "删除密钥" });
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await screen.findByText(/配置已保存，可直接使用 AI/);
  expect(saveDirectModelKey).not.toHaveBeenCalled();
  fireEvent.click(remove);
  await waitFor(() => expect(deleteDirectModelKey).toHaveBeenCalled());
});

test("does not send or enable a direct request without a key", async () => {
  const onUpdateSetting = vi.fn();
  render(<ModelConnectionPanel onUpdateSetting={onUpdateSetting} />);
  fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));
  await screen.findByRole("alert");
  expect(directModelTransport).not.toHaveBeenCalled();
  expect(onUpdateSetting).not.toHaveBeenCalled();
});

test("changing the endpoint clears an unsaved credential and never forwards it to the new destination", () => {
  render(<ModelConnectionPanel onUpdateSetting={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "original-secret" } });
  fireEvent.change(screen.getByLabelText("API 基础地址"), { target: { value: "https://other.example.test/v1" } });
  expect(screen.getByLabelText("API key")).toHaveValue("");
  expect(saveDirectModelKey).not.toHaveBeenCalled();
});
