import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LiteratureResolutionDialog } from "../app/features/forum/LiteratureResolutionDialog";
import type { LiteratureDialogModel } from "../app/controllers/usePdfAnnotationPublicationController";

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

  test("submits manual title plus authors and year without claiming verification", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    const dialog = screen.getByRole("dialog", { name: "确认文献身份" });
    expect(within(dialog).queryByText(/已验证/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("文献标题"), "Manual Paper");
    await user.type(within(dialog).getByLabelText("作者"), "Ada Lovelace; Grace Hopper");
    await user.type(within(dialog).getByLabelText("年份"), "2025");
    await user.click(within(dialog).getByRole("button", { name: "确认文献信息" }));

    expect(callbacks.onSubmitManual).toHaveBeenCalledWith({
      authors: ["Ada Lovelace", "Grace Hopper"],
      identifiers: [],
      title: "Manual Paper",
      year: 2025
    });
  });

  test("accepts a title and external identifier without author-year metadata", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    await user.type(screen.getByLabelText("文献标题"), "Manual DOI Paper");
    await user.selectOptions(screen.getByLabelText("外部标识类型"), "doi");
    await user.type(screen.getByLabelText("外部标识"), "10.1000/manual");
    await user.click(screen.getByRole("button", { name: "确认文献信息" }));

    expect(callbacks.onSubmitManual).toHaveBeenCalledWith({
      authors: [],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      title: "Manual DOI Paper"
    });
  });

  test("requires title and one supported identity path", async () => {
    const callbacks = actions();
    const user = userEvent.setup();
    render(<LiteratureResolutionDialog {...callbacks} model={{
      kind: "manual",
      pending: false,
      unavailableProviders: []
    }} />);

    const submit = screen.getByRole("button", { name: "确认文献信息" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("文献标题"), "Incomplete Paper");
    await user.type(screen.getByLabelText("作者"), "Ada Lovelace");
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
