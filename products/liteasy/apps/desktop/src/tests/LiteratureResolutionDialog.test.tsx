import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LiteratureResolutionDialog } from "../app/features/forum/LiteratureResolutionDialog";
import type { LiteratureDialogModel } from "../app/features/forum/literatureResolution.types";

function actions() {
  return {
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onSelectCandidate: vi.fn(),
    onSubmitManual: vi.fn()
  };
}

const candidatesModel: LiteratureDialogModel = {
  candidates: [{
    candidateKey: "candidate:doi:10.1000/test",
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace", "Grace Hopper"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/test" }],
      title: "A Test Paper",
      year: 2026
    },
    recordUrl: "https://doi.org/10.1000/test"
  }],
  kind: "candidates",
  pending: false,
  unavailableProviders: []
};

describe("LiteratureResolutionDialog", () => {
  test("shows resolving immediately with focus trapped on an enabled cancel path", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "resolving",
      pending: true,
      unavailableProviders: []
    }} />);

    expect(screen.getByText("正在识别文献")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "确认文献身份" });
    const cancel = screen.getByRole("button", { name: "取消公开" });
    expect(cancel).toBeEnabled();
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    await user.tab();
    expect(cancel).toHaveFocus();
  });

  test("shows the exact candidate while confirmation is pending", () => {
    render(<LiteratureResolutionDialog {...actions()} model={{
      candidate: candidatesModel.candidates[0],
      kind: "confirming",
      pending: true,
      unavailableProviders: []
    }} />);

    expect(screen.getByText("正在确认 A Test Paper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消公开" })).toBeEnabled();
  });

  test("cancels the modal with Escape", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={candidatesModel} />);

    await user.keyboard("{Escape}");

    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  test("renders accessible candidates and selects one by its stable key", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={candidatesModel} />);

    const dialog = screen.getByRole("dialog", { name: "确认文献身份" });
    expect(within(dialog).getByText("A Test Paper")).toBeInTheDocument();
    expect(within(dialog).getByText("Ada Lovelace、Grace Hopper · 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("DOI 10.1000/test")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "选择 A Test Paper" }));
    expect(callbacks.onSelectCandidate).toHaveBeenCalledWith("candidate:doi:10.1000/test");
  });

  test("shows retry without exposing manual entry when providers are unavailable", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "unavailable",
      pending: false,
      unavailableProviders: ["crossref", "openalex"]
    }} />);

    expect(screen.getByText("文献检索暂时不可用")).toBeInTheDocument();
    expect(screen.queryByLabelText("文献标题")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试检索" }));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  });

  test("submits manual title plus authors and year without claiming verification", () => {
    const callbacks = actions();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    const dialog = screen.getByRole("dialog", { name: "确认文献身份" });
    expect(within(dialog).queryByText(/已验证/)).not.toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "确认文献信息" });
    fireEvent.change(within(dialog).getByLabelText("文献标题"), {
      target: { value: "Manual Paper" }
    });
    fireEvent.change(within(dialog).getByLabelText("作者"), {
      target: { value: "Ada Lovelace; Grace Hopper" }
    });
    fireEvent.change(within(dialog).getByLabelText("年份"), {
      target: { value: "2025" }
    });
    fireEvent.click(submit);

    expect(callbacks.onSubmitManual).toHaveBeenCalledWith({
      authors: ["Ada Lovelace", "Grace Hopper"],
      identifiers: [],
      title: "Manual Paper",
      year: 2025
    });
  });

  test("accepts a title and external identifier without author-year metadata", () => {
    const callbacks = actions();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    const dialog = screen.getByRole("dialog", { name: "确认文献身份" });
    const submit = within(dialog).getByRole("button", { name: "确认文献信息" });
    fireEvent.change(within(dialog).getByLabelText("文献标题"), {
      target: { value: "Manual DOI Paper" }
    });
    fireEvent.change(within(dialog).getByLabelText("外部标识类型"), {
      target: { value: "doi" }
    });
    fireEvent.change(within(dialog).getByLabelText("外部标识"), {
      target: { value: "10.1000/manual" }
    });
    fireEvent.click(submit);

    expect(callbacks.onSubmitManual).toHaveBeenCalledWith({
      authors: [],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      title: "Manual DOI Paper"
    });
  });

  test("requires title and one supported identity path", () => {
    const callbacks = actions();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    const submit = screen.getByRole("button", { name: "确认文献信息" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("文献标题"), {
      target: { value: "Incomplete Paper" }
    });
    fireEvent.change(screen.getByLabelText("作者"), {
      target: { value: "Ada Lovelace" }
    });
    expect(submit).toBeDisabled();
  });

  test("forwards cancel and disables resolution actions while pending", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    const { rerender } = render(<LiteratureResolutionDialog {...callbacks} model={candidatesModel} />);

    await user.click(screen.getByRole("button", { name: "取消公开" }));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);

    rerender(<LiteratureResolutionDialog {...callbacks} model={{ ...candidatesModel, pending: true }} />);
    expect(screen.getByRole("button", { name: "选择 A Test Paper" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消公开" })).toBeEnabled();
  });
});
