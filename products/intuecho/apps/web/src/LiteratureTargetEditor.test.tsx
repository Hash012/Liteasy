import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LiteratureTargetEditor } from "./LiteratureTargetEditor";
import { communityApi } from "./communityApi";
import type { AnnotationTarget } from "./community.types";

vi.mock("./communityApi", () => ({
  communityApi: {
    resolveLiterature: vi.fn(),
    confirmLiterature: vi.fn()
  }
}));

const resolveLiterature = vi.mocked(communityApi.resolveLiterature);
const confirmLiterature = vi.mocked(communityApi.confirmLiterature);

const candidate = {
  candidateKey: "crossref:doi:10.1000/test",
  provider: "crossref" as const,
  record: {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/test" }],
    title: "A Reliable Paper",
    year: 2024
  }
};

const confirmed = {
  ...candidate.record,
  identifiers: [{ ...candidate.record.identifiers[0] }],
  literatureId: "literature-1",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const }
};

function renderEditor(onChange = vi.fn(), targets: AnnotationTarget[] = []) {
  return { onChange, ...render(<LiteratureTargetEditor onChange={onChange} required targets={targets} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("LiteratureTargetEditor", () => {
  test("searches title or identifiers and auto-confirms an exact result", async () => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "exact", candidate, unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const view = renderEditor();
    const { onChange } = view;

    await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "10.1000/test");
    await user.click(screen.getByRole("button", { name: "检索" }));

    expect(await screen.findByText("A Reliable Paper")).toBeVisible();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-1" } }]));
    expect(screen.queryByLabelText("身份类型")).not.toBeInTheDocument();
  });

  test.each([
    ["arXiv", "arxiv:2401.01234"],
    ["Semantic Scholar", "S2:abcdef123456"],
    ["OpenAlex", "W123456789"]
  ])("submits a %s identifier explicitly without title debounce", async (_label, queryValue) => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "exact", candidate, unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const { onChange } = renderEditor();
    const query = screen.getByRole("combobox", { name: "检索关联文献" });

    await user.type(query, queryValue);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(resolveLiterature).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "检索" }));

    await waitFor(() => expect(resolveLiterature).toHaveBeenCalledWith({ purpose: "forum_compose", query: queryValue }));
    await waitFor(() => expect(confirmLiterature).toHaveBeenCalledWith({ candidateKey: candidate.candidateKey, mode: "candidate" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-1" } }]));
    expect(resolveLiterature).toHaveBeenCalledTimes(1);
  });

  test("lets the author choose an ambiguous candidate and keeps unavailable results retryable", async () => {
    const user = userEvent.setup();
    resolveLiterature
      .mockResolvedValueOnce({ status: "ambiguous", candidates: [candidate, { ...candidate, candidateKey: "openalex:openalex_id:W1", provider: "openalex", record: { ...candidate.record, title: "Another Paper", identifiers: [{ kind: "openalex_id", source: "public_registry", value: "W1" }] } }], unavailableProviders: [] })
      .mockResolvedValueOnce({ status: "unavailable", retryable: true, unavailableProviders: ["crossref"] })
      .mockResolvedValueOnce({ status: "not_found", candidates: [], unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const view = renderEditor();
    const { onChange } = view;

    const query = screen.getByRole("combobox", { name: "检索关联文献" });
    await user.type(query, "paper");
    await user.click(screen.getByRole("button", { name: "检索" }));
    expect(await screen.findByText("Another Paper")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "选择 A Reliable Paper" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-1" } }]));

    await user.clear(query);
    await user.type(query, "retry");
    await user.click(screen.getByRole("button", { name: "检索" }));
    expect(await screen.findByText(/暂时不可用/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试检索" }));
    await waitFor(() => expect(resolveLiterature).toHaveBeenCalledTimes(3));
    expect(screen.queryByLabelText("手动文献标题")).not.toBeInTheDocument();
  });

  test("debounces title search after three characters", async () => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "not_found", candidates: [], unavailableProviders: [] });
    renderEditor();
    await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "abc");
    await waitFor(() => expect(resolveLiterature).toHaveBeenCalledWith({ purpose: "forum_compose", query: "abc" }));
  });

  test("allows manual fallback only after not found and enforces minimum metadata", async () => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "not_found", candidates: [], unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: { ...confirmed, literatureId: "manual-1", provenance: { confirmedAt: confirmed.provenance.confirmedAt, mode: "manual" }, identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }] } });
    const { onChange } = renderEditor();
    const query = screen.getByRole("combobox", { name: "检索关联文献" });
    await user.type(query, "unknown");
    await user.click(screen.getByRole("button", { name: "检索" }));
    expect(await screen.findByText(/没有找到/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "手动添加文献" }));
    await user.click(screen.getByRole("button", { name: "确认文献" }));
    expect(screen.getByLabelText("手动文献标题")).toBeVisible();
    await user.type(screen.getByLabelText("手动文献标题"), "Manual Paper");
    await user.type(screen.getByLabelText("手动文献 DOI"), "10.1000/manual");
    await user.click(screen.getByRole("button", { name: "确认文献" }));
    await waitFor(() => expect(confirmLiterature).toHaveBeenCalledWith(expect.objectContaining({ mode: "manual", record: expect.objectContaining({ title: "Manual Paper" }) })));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "manual-1" } }]));
  });

  test("confirms manual literature with authors and year when no identifier is known", async () => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "not_found", candidates: [], unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: {
      ...confirmed,
      literatureId: "manual-authors-year",
      provenance: { confirmedAt: confirmed.provenance.confirmedAt, mode: "manual" },
      identifiers: [{ kind: "title_authors_year_hash", source: "manual", value: "manual-paper|author-one|2025" }]
    }});
    renderEditor();

    await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "Unlisted Manual Paper");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await user.click(await screen.findByRole("button", { name: "手动添加文献" }));
    await user.type(screen.getByLabelText("手动文献标题"), "Manual Paper Without ID");
    await user.type(screen.getByLabelText("手动文献作者"), "Author One; Author Two");
    await user.type(screen.getByLabelText("手动文献年份"), "2025");
    await user.click(screen.getByRole("button", { name: "确认文献" }));

    await waitFor(() => expect(confirmLiterature).toHaveBeenCalledWith({
      mode: "manual",
      record: {
        authors: ["Author One", "Author Two"],
        identifiers: [],
        title: "Manual Paper Without ID",
        year: 2025
      }
    }));
  });

  test("supports source-passage details, multiple records, and removal", async () => {
    const user = userEvent.setup();
    resolveLiterature.mockResolvedValue({ status: "exact", candidate, unavailableProviders: [] });
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const view = renderEditor();
    const { onChange } = view;
    await user.selectOptions(screen.getByLabelText("目标范围"), "source_passage");
    await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "paper");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await user.type(screen.getByLabelText("页码"), "3");
    await user.type(screen.getByLabelText("原文摘录"), "Important passage");
    await user.click(screen.getByRole("button", { name: "添加已确认文献" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ kind: "source_passage", literature: { literatureId: "literature-1" }, page: 3, excerpt: "Important passage" })]));
    const selectedTargets = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? [];
    const secondTarget: AnnotationTarget = { kind: "whole_document", literature: { literatureId: "literature-2" } };
    view.rerender(<LiteratureTargetEditor onChange={onChange} required targets={[...selectedTargets, secondTarget]} />);
    expect(screen.getAllByText("A Reliable Paper").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "移除关联文献" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "移除关联文献" })[0]);
    expect(onChange).toHaveBeenLastCalledWith([secondTarget]);
  });
});
