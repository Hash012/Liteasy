import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PaperResourceTab, type TranslationRequestOptions } from "../app/features/import/PaperResourceTab";

const paper = { id: "paper-1", title: "A multimodal paper" };

test("renders MinerU figures as one ordered, reusable paper resource", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  const onPresent = vi.fn();
  render(
    <PaperResourceTab
      figures={[
        {
          alt: "Later figure",
          analysis: {
            description: "A result chart.",
            importance: "primary",
            kind: "chart",
            placement: "results",
            selectionReason: "Shows the key result.",
            title: "Result"
          },
          dataUrl: "data:image/png;base64,AA==",
          id: "figure-2",
          page: 4,
          sourcePath: "images/2.png"
        },
        {
          alt: "First figure",
          dataUrl: "data:image/png;base64,BB==",
          id: "figure-1",
          page: 1,
          sourcePath: "images/1.png"
        }
      ]}
      kind="figures"
      onCreatePresentation={onPresent}
      onUseInConversation={onAsk}
      paper={paper}
      textChunks={[]}
    />
  );

  expect(screen.getByRole("heading", { name: "论文插图" })).toBeInTheDocument();
  expect(screen.getByText("第 1 页")).toBeInTheDocument();
  expect(screen.getByText("第 4 页")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "用作提问材料" }));
  await user.click(screen.getByRole("button", { name: "制作展示内容" }));
  expect(onAsk).toHaveBeenCalledOnce();
  expect(onPresent).toHaveBeenCalledOnce();
});

test("does not auto-load remote URLs from persisted MinerU figure metadata", () => {
  render(
    <PaperResourceTab
      figures={[{
        alt: "Untrusted remote figure",
        dataUrl: "http://127.0.0.1:8791/private.png",
        id: "remote-figure",
        page: 1,
        sourcePath: "images/remote.png"
      }]}
      kind="figures"
      paper={paper}
      textChunks={[]}
    />
  );

  expect(screen.queryByRole("img", { name: "Untrusted remote figure" })).not.toBeInTheDocument();
  expect(screen.getByText("[无法安全加载图片：Untrusted remote figure]")).toBeInTheDocument();
});

test("renders page-sorted extracted text", () => {
  render(
    <PaperResourceTab
      figures={[]}
      kind="extracted_text"
      paper={paper}
      textChunks={[
        { page: 2, paperId: paper.id, paperTitle: paper.title, snippet: "second page", summary: "", tags: [], textExtraction: "mineru" },
        { page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "first page", summary: "", tags: [], textExtraction: "mineru" }
      ]}
    />
  );

  const text = screen.getByLabelText("按页排列的论文提取文本").textContent ?? "";
  expect(text.indexOf("first page")).toBeLessThan(text.indexOf("second page"));
});

test("renders MinerU Markdown with images, LaTeX, GFM and safe HTML tables", () => {
  const { container } = render(
    <PaperResourceTab
      figures={[]}
      kind="extracted_text"
      paper={paper}
      textChunks={[{
        page: 1,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet: "Flattened extraction text",
        sourceMarkdown: `# Objective\n\nThe **loss** is $L = x^2$.\n\n$$\n\\mathcal{L} = \\sum_i x_i\n$$\n\n- first observation\n- second observation\n\n| Metric | Score |\n| --- | --- |\n| F1 | 92.4 |\n\n![MinerU illustration](data:image/png;base64,AA==)\n\n<table><tr><td rowspan="2">Media</td><td colspan="2">Access time</td></tr><tr><td>Read</td><td>Write</td></tr><tr><td>DRAM</td><td>60ns</td><td>60ns</td></tr></table>`,
        summary: "",
        tags: [],
        textExtraction: "mineru"
      }]}
    />
  );

  expect(screen.getByRole("heading", { name: "Objective" })).toBeInTheDocument();
  expect(screen.getByText("完整论文")).toBeInTheDocument();
  expect(screen.queryByText("Flattened extraction text")).not.toBeInTheDocument();
  expect(screen.getByText("loss").tagName).toBe("STRONG");
  expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  expect(container.querySelector("ul")).toHaveTextContent("first observation");
  expect(screen.getByAltText("MinerU illustration")).toHaveAttribute("src", "data:image/png;base64,AA==");
  expect(container.querySelectorAll("table")).toHaveLength(2);
  expect(container.querySelector("td[rowspan=\"2\"]")).toHaveTextContent("Media");
  expect(container.querySelector("td[colspan=\"2\"]")).toHaveTextContent("Access time");
});

test("resolves relative MinerU images in the multimodal source and restores them in translation", async () => {
  const user = userEvent.setup();
  const figure = {
    alt: "Architecture diagram",
    dataUrl: "data:image/png;base64,CC==",
    id: "architecture",
    page: 1,
    sourcePath: "document/images/architecture.png"
  };
  const onTranslate = vi.fn(async (_source: string, _target: string, markedSource: string) => (
    markedSource
      .replace("Original explanation.", "中文解释。")
      .replace("![Architecture diagram](images/architecture.png)", "")
  ));
  render(
    <PaperResourceTab
      figures={[figure]}
      kind="multimodal"
      onTranslate={onTranslate}
      paper={paper}
      textChunks={[{
        page: 1,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet: "Flattened text",
        sourceMarkdown: "Original explanation.\n\n![Architecture diagram](images/architecture.png)",
        summary: "",
        tags: [],
        textExtraction: "mineru"
      }]}
    />
  );

  expect(screen.getByAltText("Architecture diagram")).toHaveAttribute("src", figure.dataUrl);
  await user.click(screen.getByRole("button", { name: "翻译文本" }));
  await user.click(await screen.findByRole("button", { name: "确认翻译为 中文" }));

  expect(await screen.findByText("中文解释。")).toBeInTheDocument();
  expect(screen.getAllByAltText("Architecture diagram")).toHaveLength(2);
  screen.getAllByAltText("Architecture diagram").forEach((image) => {
    expect(image).toHaveAttribute("src", figure.dataUrl);
  });
});

test("offers a saved translation for viewing when reopening an already translated paper", async () => {
  const user = userEvent.setup();
  const onLoadTranslations = vi.fn(async () => [{
    content: "<!-- liteasy-anchor:segment-001 -->\n已保存译文。",
    id: "saved-translation",
    paperId: paper.id,
    sourceFingerprint: "source-fingerprint",
    sourceLanguage: "English",
    targetLanguage: "中文",
    updatedAt: "2026-08-01T08:00:00.000Z",
    version: "liteasy.paper-translation/v1" as const
  }]);
  render(
    <PaperResourceTab
      figures={[]}
      kind="multimodal"
      onLoadTranslations={onLoadTranslations}
      onTranslate={vi.fn()}
      paper={paper}
      textChunks={[{
        page: 1,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet: "Original paper text.",
        summary: "",
        tags: [],
        textExtraction: "mineru"
      }]}
    />
  );

  expect(await screen.findByRole("button", { name: "查看译文" })).toBeInTheDocument();
  expect(screen.queryByText("已保存译文。")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看译文" }));
  expect(screen.getByText("已保存译文。")).toBeInTheDocument();
  expect(screen.getByLabelText("中文 译文")).toBeInTheDocument();
  expect(onLoadTranslations).toHaveBeenCalledWith(expect.stringContaining("Original paper text."));
});

test("renders an original-order MinerU multimodal resource and requests a translation", async () => {
  const user = userEvent.setup();
  const clipboardWrite = vi.spyOn(navigator.clipboard, "writeText");
  const onTranslate = vi.fn(async () => "<!-- liteasy-anchor:segment-001 -->\n# 中文译文\n\n<!-- liteasy-anchor:segment-002 -->\n第二页。");
  const { container } = render(
    <PaperResourceTab
      figures={[{ alt: "Page two chart", dataUrl: "data:image/png;base64,AA==", id: "chart-2", page: 2, sourcePath: "chart.png" }]}
      kind="multimodal"
      onTranslate={onTranslate}
      paper={paper}
      textChunks={[
        { page: 2, paperId: paper.id, paperTitle: paper.title, snippet: "second page text", summary: "", tags: [], textExtraction: "mineru" },
        { page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "first page text", summary: "", tags: [], textExtraction: "mineru" }
      ]}
    />
  );

  const multimodal = screen.getByLabelText("按论文原文顺序排列的图文版").textContent ?? "";
  expect(multimodal.indexOf("first page text")).toBeLessThan(multimodal.indexOf("second page text"));
  expect(container.querySelector(".paper-resource-tab__multimodal-page img")).toHaveAttribute("alt", "Page two chart");
  await user.click(screen.getByRole("button", { name: "翻译文本" }));
  expect(screen.getByRole("dialog", { name: "选择翻译语言" })).toBeInTheDocument();
  expect(screen.getByLabelText("翻译源语言")).toHaveTextContent("English");
  expect(screen.getByLabelText("翻译目标语言")).toHaveTextContent("中文");
  await user.click(screen.getByRole("button", { name: "确认翻译为 中文" }));
  expect(onTranslate).toHaveBeenCalledWith(
    "English",
    "中文",
    expect.stringContaining("<!-- liteasy-anchor:segment-001 -->"),
    expect.objectContaining({ onProgress: expect.any(Function), signal: expect.any(AbortSignal) })
  );
  expect(await screen.findByText("中文译文")).toBeInTheDocument();
  expect(screen.getByLabelText("原文")).toBeInTheDocument();
  expect(screen.getByLabelText("中文 译文")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "仅看译文" }));
  expect(screen.queryByLabelText("原文")).not.toBeInTheDocument();
  expect(screen.getByLabelText("中文 译文")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制 Markdown" }));
  expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("中文译文"));
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
});

test("shows batch progress and lets the reader cancel without a failure alert", async () => {
  const user = userEvent.setup();
  let requestOptions: TranslationRequestOptions | undefined;
  const onTranslate = vi.fn((_source: string, _target: string, _marked: string, options: TranslationRequestOptions) => {
    requestOptions = options;
    return new Promise<string>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
    });
  });
  render(
    <PaperResourceTab
      figures={[]}
      kind="extracted_text"
      onTranslate={onTranslate}
      paper={paper}
      textChunks={[{ page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "source", summary: "", tags: [], textExtraction: "mineru" }]}
    />
  );

  await user.click(screen.getByRole("button", { name: "翻译文本" }));
  await user.click(screen.getByRole("button", { name: "确认翻译为 中文" }));
  expect(screen.getByRole("status")).toHaveTextContent("正在检查本地翻译服务");
  act(() => requestOptions?.onProgress({ completedBatches: 1, message: "正在翻译第 2 个分段", phase: "translating", totalBatches: 3 }));
  expect(screen.getByRole("status")).toHaveTextContent("已完成 1 / 3 个分段");
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(requestOptions?.signal.aborted).toBe(true);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows an actionable error without calling the model when extracted text is empty", async () => {
  const user = userEvent.setup();
  const onTranslate = vi.fn();
  render(
    <PaperResourceTab
      figures={[]}
      kind="extracted_text"
      onTranslate={onTranslate}
      paper={paper}
      textChunks={[{ page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "   ", summary: "", tags: [], textExtraction: "mineru" }]}
    />
  );

  await user.click(screen.getByRole("button", { name: "翻译文本" }));
  await user.click(screen.getByRole("button", { name: "确认翻译为 中文" }));

  expect(screen.getByRole("alert")).toHaveTextContent("没有可翻译的论文文本");
  expect(screen.getByRole("alert")).toHaveTextContent("请先重新解析或重新导入这篇论文");
  expect(screen.queryByRole("button", { name: "重试翻译" })).not.toBeInTheDocument();
  expect(onTranslate).not.toHaveBeenCalled();
});

test("keeps the previous translation visible when retranslation fails and supports retry", async () => {
  const user = userEvent.setup();
  const first = "<!-- liteasy-anchor:segment-001 -->\n第一版译文";
  const recovered = "<!-- liteasy-anchor:segment-001 -->\n重试后的译文";
  const onTranslate = vi.fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error("模型服务请求失败（cloud_proxy 502）：OpenAI Responses API 请求失败（524，endpoint=https://api.mosshubs.com/v1）"))
    .mockResolvedValueOnce(recovered);
  render(
    <PaperResourceTab
      figures={[]}
      kind="extracted_text"
      onTranslate={onTranslate}
      paper={paper}
      textChunks={[{ page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "source", summary: "", tags: [], textExtraction: "mineru" }]}
    />
  );

  await user.click(screen.getByRole("button", { name: "翻译文本" }));
  await user.click(screen.getByRole("button", { name: "确认翻译为 中文" }));
  expect(await screen.findByText("第一版译文")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新翻译" }));
  await user.click(await screen.findByRole("button", { name: "确认翻译为 中文" }));
  expect(await screen.findByText("本地翻译服务仍在使用旧配置")).toBeInTheDocument();
  expect(screen.getByText("第一版译文")).toBeInTheDocument();
  expect(screen.getByText("技术详情")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重试翻译" }));
  expect(await screen.findByText("重试后的译文")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
