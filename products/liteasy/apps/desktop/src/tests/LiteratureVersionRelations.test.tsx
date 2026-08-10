import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LiteratureVersionRelations } from "../app/features/forum/LiteratureVersionRelations";

const currentLiterature = {
  authors: ["A. Author"],
  documentType: "preprint",
  identifiers: [{ kind: "arxiv_id" as const, source: "public_registry" as const, value: "2401.01234" }],
  literatureId: "literature-preprint",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "arxiv" as const },
  revision: 1,
  status: "confirmed" as const,
  title: "Preprint Version",
  year: 2026
};

describe("LiteratureVersionRelations", () => {
  test("shows an evidenced published version without merging it into the current preprint", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);
    const onAcquireVersion = vi.fn(async () => ({ created: true, documentId: "metadata-publication" }));
    const onOpenVersion = vi.fn();
    const loadRelations = vi.fn(async () => ({
      literatureId: "literature-preprint",
      versions: [{
        direction: "from_current" as const,
        literature: {
          authors: ["A. Author"],
          identifiers: [{ kind: "doi" as const, source: "public_registry" as const, value: "10.1000/publication" }],
          literatureId: "literature-publication",
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry" as const, provider: "crossref" as const },
          revision: 1,
          status: "confirmed" as const,
          title: "Published Version",
          year: 2026
        },
        relation: {
          createdAt: "2026-08-09T00:00:00.000Z",
          evidence: { recordUrl: "https://registry.example.test/relation" },
          fromLiteratureId: "literature-preprint",
          provider: "crossref" as const,
          relationType: "is_preprint_of" as const,
          toLiteratureId: "literature-publication",
          verificationStatus: "confirmed" as const
        }
      }]
    }));

    render(<LiteratureVersionRelations
      copyText={copyText}
      currentLiterature={currentLiterature}
      loadRelations={loadRelations}
      onAcquireVersion={onAcquireVersion}
      onOpenVersion={onOpenVersion}
    />);

    expect(await screen.findByText("已有正式发表版")).toBeInTheDocument();
    expect(screen.getByText("Published Version")).toBeInTheDocument();
    expect(screen.getByText("DOI 10.1000/publication")).toBeInTheDocument();
    expect(screen.getByText("来源：Crossref · 已确认")).toBeInTheDocument();
    expect(loadRelations).toHaveBeenCalledWith("literature-preprint");

    await user.click(screen.getByRole("button", { name: "打开 Published Version" }));
    expect(onOpenVersion).toHaveBeenCalledWith(expect.objectContaining({ literatureId: "literature-publication" }), expect.any(Object));
    await user.click(screen.getByRole("button", { name: "将 Published Version 加入文献库" }));
    expect(onAcquireVersion).toHaveBeenCalledWith(expect.objectContaining({ literatureId: "literature-publication" }), expect.any(Object));
    expect(await screen.findByText("已加入文献库")).toBeInTheDocument();

    expect(screen.getByRole("combobox", { name: "引用版本" })).toHaveValue("literature-publication");
    await user.click(screen.getByRole("button", { name: "复制 BibTeX" }));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("doi = {10.1000/publication}"));
  });

  test("stays quiet when no authenticated relation loader is available", () => {
    const { container } = render(<LiteratureVersionRelations currentLiterature={currentLiterature} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows a visible retry state after relation loading fails", async () => {
    const user = userEvent.setup();
    const loadRelations = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ literatureId: currentLiterature.literatureId, versions: [] });

    render(<LiteratureVersionRelations currentLiterature={currentLiterature} loadRelations={loadRelations} />);

    expect(await screen.findByText("版本关系加载失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试加载版本关系" }));
    expect(loadRelations).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("暂无已确认的关联版本")).toBeInTheDocument();
  });
});
