import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { loadUserPaperArtifact, saveUserPaperArtifact } from "../app/features/library/userPaperArtifactClient";
import { usePdfCitationParsing } from "../app/features/pdf/usePdfCitationParsing";

vi.mock("../app/features/library/userPaperArtifactClient", () => ({
  loadUserPaperArtifact: vi.fn(),
  saveUserPaperArtifact: vi.fn()
}));

const paper = { id: "paper-1", sourcePath: "C:/papers/paper.pdf", title: "Paper" };
const pageTexts = { 1: "Self-attention follows prior work [1]." };
const tei = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>
  Self-attention follows prior work <ref type="bibr" target="#b0" coords="1,1,1,1,1">[1]</ref>.
  </p><back><listBibl><biblStruct xml:id="b0"><analytic><title>Prior work</title></analytic>
  </biblStruct></listBibl></back></body></text></TEI>`;

describe("usePdfCitationParsing", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("never reads or uploads PDF bytes without explicit consent", async () => {
    vi.mocked(loadUserPaperArtifact).mockResolvedValue(undefined);
    const loadPdfSource = vi.fn(async () => new TextEncoder().encode("%PDF-1.7"));
    const { result } = renderHook(() => usePdfCitationParsing({
      activePaper: paper,
      allowServerPdfParsing: false,
      endpoint: "http://127.0.0.1:8787",
      fullDocumentTextReady: true,
      loadPdfSource,
      pageTexts
    }));

    await waitFor(() => expect(result.current.warning).toContain("已关闭"));
    expect(loadPdfSource).not.toHaveBeenCalled();
  });

  test("uploads only the PDF bytes after consent and persists structured citation output", async () => {
    vi.mocked(loadUserPaperArtifact).mockResolvedValue(undefined);
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 fixture");
    const loadPdfSource = vi.fn(async () => pdfBytes);
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => ({
      json: async () => ({
        contentFingerprint: "a".repeat(64),
        parser: "grobid",
        parserVersion: 1,
        tei
      }),
      ok: true,
      status: 200,
      uploadedBody: options.body
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePdfCitationParsing({
      activePaper: paper,
      allowServerPdfParsing: true,
      endpoint: "http://127.0.0.1:8787",
      fullDocumentTextReady: true,
      loadPdfSource,
      pageTexts
    }));

    await waitFor(() => expect(result.current.parser).toBe("grobid"));
    expect(loadPdfSource).toHaveBeenCalledWith(paper.sourcePath);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/research/parse-pdf",
      expect.objectContaining({ body: expect.anything(), method: "POST" })
    );
    // The parsed snapshot is what gets stored; interpreting it belongs to whoever reads the
    // `citations` artifact back, which is thin reading rather than the reader.
    expect(saveUserPaperArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactKind: "citations",
      paperId: paper.id
    }));
  });
});
