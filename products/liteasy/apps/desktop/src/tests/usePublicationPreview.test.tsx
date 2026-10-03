import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { usePublicationPreview } from "../app/features/forum/usePublicationPreview";
import type { PublicationActorBinding } from "../app/features/forum/publicationActorBinding";

const owner: PublicationActorBinding = { endpoint: "https://forum.example.test", issuer: "https://identity.example.test", subject: "owner", scopeType: "user", scopeId: "owner", sessionGeneration: "epoch:1" };

describe("local publication preview", () => {
  test("shows the frozen public author fields and every selected evidence excerpt", async () => {
    const profile = { author: { id: owner.subject, name: "Synthetic Scholar", initials: "SS" }, profile: { revision: 2, educationStage: "graduate", institutions: [{ name: "Synthetic Institute" }] } };
    function Host() {
      const controller = usePublicationPreview(() => owner);
      return <><button onClick={() => void controller.confirm({ title: "发送预览", recipient: "公开论坛", body: "My summary", authorProfiles: [{ label: "公开作者资料", profile }], excerpts: [
        { label: "正文引用", text: "First source excerpt" }, { label: "证据引用", text: "Second actual wire excerpt" }
      ] })}>预览</button>{controller.dialog}</>;
    }
    render(<Host />);
    fireEvent.click(screen.getByText("预览"));
    profile.author.name = "Changed after preview";
    expect(screen.getByLabelText("公开作者资料")).toHaveTextContent("Synthetic Scholar");
    expect(screen.getByLabelText("公开作者资料")).toHaveTextContent("Synthetic Institute");
    expect(screen.getByText("Second actual wire excerpt")).toBeVisible();
    expect(screen.queryByText("Changed after preview")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "取消" })); });
  });

  test("takes a fixed local snapshot and requires a separate confirmation", async () => {
    const completed = vi.fn();
    const preview = { title: "发送预览", recipient: "公开论坛", body: "Only this selected note" };
    function Host() {
      const controller = usePublicationPreview(() => owner);
      return <><button onClick={() => void controller.confirm(preview).then(completed)}>预览</button>{controller.dialog}</>;
    }
    render(<Host />);
    fireEvent.click(screen.getByText("预览"));
    preview.body = "Other private content";
    expect(screen.getByLabelText("批注正文")).toHaveTextContent("Only this selected note");
    expect(screen.queryByText("Other private content")).not.toBeInTheDocument();
    expect(completed).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "确认发送" })); });
    expect(completed).toHaveBeenCalledWith(true);
  });

  test("switching accounts dismisses the preview without approval", async () => {
    const completed = vi.fn();
    function Host({ actor }: { actor: PublicationActorBinding }) {
      const controller = usePublicationPreview(() => actor);
      return <><button onClick={() => void controller.confirm({ title: "发送预览", recipient: "公开论坛", body: "A's text" }).then(completed)}>预览</button>{controller.dialog}</>;
    }
    const view = render(<Host actor={owner} />);
    fireEvent.click(screen.getByText("预览"));
    await act(async () => { view.rerender(<Host actor={{ ...owner, subject: "B", scopeId: "B", sessionGeneration: "epoch:2" }} />); });
    expect(completed).toHaveBeenCalledWith(false);
    expect(screen.queryByText("A's text")).not.toBeInTheDocument();
  });
});
