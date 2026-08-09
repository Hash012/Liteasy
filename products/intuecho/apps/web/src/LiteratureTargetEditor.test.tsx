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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
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

  test("ignores a superseded exact resolver response instead of opening manual fallback or writing a target", async () => {
    const user = userEvent.setup();
    const first = deferred<Awaited<ReturnType<typeof communityApi.resolveLiterature>>>();
    const second = deferred<Awaited<ReturnType<typeof communityApi.resolveLiterature>>>();
    resolveLiterature.mockImplementation(({ query }) => query?.endsWith("first") ? first.promise : second.promise);
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const { onChange } = renderEditor();
    const query = screen.getByRole("combobox", { name: "检索关联文献" });

    await user.type(query, "10.1000/first");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await user.clear(query);
    await user.type(query, "10.1000/second");
    await user.keyboard("{Enter}");
    second.resolve({ status: "not_found", candidates: [], unavailableProviders: [] });
    expect(await screen.findByText(/没有找到/)).toBeVisible();
    first.resolve({ status: "exact", candidate, unavailableProviders: [] });
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "手动添加文献" })).toBeVisible();
    expect(confirmLiterature).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("ignores a superseded not-found response after a newer exact target is confirmed", async () => {
    const user = userEvent.setup();
    const first = deferred<Awaited<ReturnType<typeof communityApi.resolveLiterature>>>();
    resolveLiterature.mockImplementation(({ query }) => query?.endsWith("first") ? first.promise : Promise.resolve({ status: "exact", candidate, unavailableProviders: [] }));
    confirmLiterature.mockResolvedValue({ literature: confirmed });
    const { onChange } = renderEditor();
    const query = screen.getByRole("combobox", { name: "检索关联文献" });
    await user.type(query, "10.1000/first");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await user.clear(query);
    await user.type(query, "10.1000/new");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-1" } }]));
    first.resolve({ status: "not_found", candidates: [], unavailableProviders: [] });
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "手动添加文献" })).not.toBeInTheDocument();
  });

  test("does not apply a superseded candidate confirmation", async () => {
    const user = userEvent.setup();
    const confirm = deferred<{ literature: typeof confirmed }>();
    resolveLiterature
      .mockResolvedValueOnce({ status: "exact", candidate, unavailableProviders: [] })
      .mockResolvedValueOnce({ status: "not_found", candidates: [], unavailableProviders: [] });
    confirmLiterature.mockReturnValue(confirm.promise);
    const { onChange } = renderEditor();
    const query = screen.getByRole("combobox", { name: "检索关联文献" });
    await user.type(query, "10.1000/first");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await waitFor(() => expect(confirmLiterature).toHaveBeenCalled());
    await user.clear(query);
    await user.type(query, "10.1000/new");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(resolveLiterature).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/没有找到/)).toBeVisible();
    confirm.resolve({ literature: confirmed });
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "手动添加文献" })).toBeVisible();
  });

  test("keeps the newest candidate when two confirmations complete out of order", async () => {
    const user = userEvent.setup();
    const candidateA = { ...candidate, candidateKey: "crossref:doi:10.1000/a", record: { ...candidate.record, title: "Candidate A" } };
    const candidateB = { ...candidate, candidateKey: "crossref:doi:10.1000/b", record: { ...candidate.record, title: "Candidate B" } };
    const confirmationA = deferred<{ literature: typeof confirmed }>();
    const confirmationB = deferred<{ literature: typeof confirmed }>();
    resolveLiterature.mockResolvedValue({ status: "ambiguous", candidates: [candidateA, candidateB], unavailableProviders: [] });
    confirmLiterature.mockImplementation((input) => "candidateKey" in input && input.candidateKey === candidateA.candidateKey ? confirmationA.promise : confirmationB.promise);
    const { onChange } = renderEditor();
    await user.type(screen.getByRole("combobox", { name: "检索关联文献" }), "10.1000/candidates");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await user.click(await screen.findByRole("button", { name: "选择 Candidate A" }));
    await user.click(screen.getByRole("button", { name: "选择 Candidate B" }));

    confirmationB.resolve({ literature: { ...confirmed, literatureId: "literature-b", title: "Candidate B" } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-b" } }]));
    confirmationA.resolve({ literature: { ...confirmed, literatureId: "literature-a", title: "Candidate A" } });
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([{ kind: "whole_document", literature: { literatureId: "literature-b" } }]);
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
    const callsBeforeRetry = resolveLiterature.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "重试检索" }));
    await waitFor(() => expect(resolveLiterature).toHaveBeenCalledTimes(callsBeforeRetry + 1));
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

  test("uses the hydrated canonical record when reopening an existing target", () => {
    renderEditor(vi.fn(), [{
      kind: "whole_document",
      literature: { literatureId: "literature-1", literatureRecord: confirmed }
    }] as unknown as AnnotationTarget[]);

    expect(screen.getByText("A Reliable Paper")).toBeVisible();
    expect(screen.queryByText("文献 literature-1")).not.toBeInTheDocument();
  });
});
