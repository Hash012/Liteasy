import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AccountDataExportPanel } from "../app/features/account/AccountDataExportPanel";
import type { AccountDataExportPlan } from "../app/features/account/accountDataExport";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import { PersonalCenterPanel } from "../app/features/profile/PersonalCenterPanel";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

const session = { endpoint: "https://cloud.example.invalid", issuer: "https://id.example.invalid", userId: "verified-a",
  sessionId: "a-token", email: "a@example.invalid", name: "A", expiresAt: "2030-01-01T00:00:00Z" };
const plan: AccountDataExportPlan = { subject: session.userId, endpoint: session.endpoint,
  expiresAt: "2030-01-01T00:00:00Z", documentCount: 2,
  artifacts: [{ artifactId: "own", title: "My artifact" }, { artifactId: "org", title: "Organization artifact", excludedReason: "含组织来源" }],
  exclusions: ["本机笔记", "组织资产", "登录凭据"] };

function fixture() {
  storeAccountSession(session);
  const client = { prepare: vi.fn(async (_signal?: AbortSignal) => plan),
    export: vi.fn(async (_plan: AccountDataExportPlan, _ids: readonly string[], _signal?: AbortSignal) => ({ artifactCount: 1, documentCount: 2 })) };
  const createClient = vi.fn(() => client);
  return { client, createClient };
}
afterEach(clearStoredAccountSession);

describe("AccountDataExportPanel", () => {
  test("exposes the cloud package separately from the existing local profile export", () => {
    storeAccountSession(session);
    render(<PersonalCenterPanel accountSession={session} academicProfile={defaultAcademicProfile}
      onClearProfile={vi.fn()} onLogout={vi.fn()} onOpenAcademicArchive={vi.fn()}
      onToggleProfileSampling={vi.fn()} onUpdateAcademicProfile={vi.fn()} organizationSummary={null}
      profileSamplingEnabled={false} profileTags={[]} readPaperCount={0} />);
    fireEvent.click(screen.getByRole("tab", { name: "数据管理" }));
    expect(screen.getByRole("button", { name: "查看与导出档案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览本人云资料包" })).toBeEnabled();
  });
  test("requires a verified cloud session without browsing or reading local data", () => {
    const f = fixture();
    render(<AccountDataExportPanel session={null} createClient={f.createClient} />);
    expect(screen.getByRole("button", { name: "预览本人云资料包" })).toBeDisabled();
    expect(screen.getByText(/PDF、本机笔记、组织资料/)).toBeInTheDocument();
    expect(f.client.prepare).not.toHaveBeenCalled();
  });

  test("previews the owner and exclusions, selects explicitly and submits only confirmed artifacts", async () => {
    const f = fixture();
    render(<AccountDataExportPanel session={session} createClient={f.createClient} />);
    fireEvent.click(screen.getByRole("button", { name: "预览本人云资料包" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/verified-a/)).toBeInTheDocument();
    expect(within(dialog).getByText(/不是全产品账号数据备份/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "My artifact" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Organization artifact" })).toBeDisabled();
    expect(f.client.export).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "My artifact" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "导出所选资料（1 份产物）" }));
    await waitFor(() => expect(f.client.export).toHaveBeenCalledWith(plan, ["own"], expect.any(AbortSignal)));
    expect(await screen.findByRole("status")).toHaveTextContent("已发起 ZIP 下载");
  });

  test("cancels preview without starting export", async () => {
    const f = fixture();
    render(<AccountDataExportPanel session={session} createClient={f.createClient} />);
    fireEvent.click(screen.getByRole("button", { name: "预览本人云资料包" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(f.client.export).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("已取消");
  });

  test("aborts a pending preparation and never renders the old account's late preview", async () => {
    const f = fixture();
    let finish!: (value: AccountDataExportPlan) => void;
    f.client.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<AccountDataExportPanel session={session} createClient={f.createClient} />);
    fireEvent.click(screen.getByRole("button", { name: "预览本人云资料包" }));
    const signal = f.client.prepare.mock.calls[0][0]!;
    const b = { ...session, userId: "verified-b", sessionId: "b-token" };
    storeAccountSession(b);
    view.rerender(<AccountDataExportPanel session={b} createClient={f.createClient} />);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(plan); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/verified-a/)).not.toBeInTheDocument();
    expect(f.client.export).not.toHaveBeenCalled();
  });
});
