import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { builtInQuickAskPresets } from "../app/features/quick-ask-presets/quickAskPresets";
import { quickAskPresetOptions } from "../app/features/quick-ask-presets/quickAskPresetPresentation";
import { QuickAskPresetPicker } from "../app/features/quick-ask-presets/QuickAskPresetPicker";
import { operationIds, operationLabels } from "../app/features/workflows/operationCatalog";
import { recommendationIdentifier } from "../app/features/recommendations/recommendationPresentation";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { compileObjectDocument } from "../app/features/document-export/objectExportAdapter";
import { renderDocumentMarkdown, renderMarkdownPackage } from "../app/features/document-export/documentMarkdown";
import { ResourceLink } from "../app/features/resource-links/ResourceReferenceView";

test("same-name presets use instruction summaries and stable ordinal labels while selecting exact identities", async () => {
  const base = builtInQuickAskPresets("scope")[0];
  const first = { ...base, id: "personal-internal-a-98adf1", name: "同名", instruction: "检查因果边界", builtIn: false, pinned: false };
  const second = { ...first, id: "personal-internal-b-88cde2", instruction: "逐项核对公式" };
  const presets = [first, second];
  const options = quickAskPresetOptions(presets);
  expect(options[0].label).toContain(first.instruction);
  expect(options[0].description).toContain("个人");
  expect(options.map(({ label, description }) => label + description).join()).not.toMatch(/98adf1|88cde2/);
  expect(quickAskPresetOptions([...presets].reverse()).find(item => item.value === first.id)?.label).toBe(options[0].label);
  const select = vi.fn();
  render(<QuickAskPresetPicker presets={presets} selectedPresetId={first.id} onSelect={select} />);
  fireEvent.click(screen.getByRole("combobox", { name: "更多速问任务" }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(second.instruction) }));
  expect(select).toHaveBeenCalledWith(second.id);
});

test("workflow operation choices have names while public literature identifiers remain useful", () => {
  for (const id of operationIds) { expect(operationLabels[id]).toBeTruthy(); expect(operationLabels[id]).not.toBe(id); }
  const item = (canonicalId: string) => ({ id: "internal-document-key", canonicalId } as RecommendationItem);
  expect(recommendationIdentifier(item("doi:10.1000/182"))).toEqual([{ kind: "doi", value: "10.1000/182" }]);
  expect(recommendationIdentifier(item("arxiv:2401.12345"))).toEqual([{ kind: "arxiv_id", value: "2401.12345" }]);
  expect(recommendationIdentifier(item("user:internal-subject-8b39"))).toBeUndefined();
});

test("object export preserves user-authored hashes in text and exact revision only in provenance metadata", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const scope = crypto.randomUUID();
  const repository = createObjectRepository(createObjectStorage(scope, () => scope), scope);
  const authoredHash = "a".repeat(64);
  const note = await repository.create({ kind: "content.note", title: authoredHash,
    content: { schema: "liteasy.note/v1", payload: { text: "用户代码 `object:1234` 应保持原样。", origin: "user" } } });
  const document = await compileObjectDocument(note, {});
  const markdown = renderDocumentMarkdown(document);
  expect(markdown).toContain(authoredHash);
  expect(markdown).toContain("object:1234");
  expect(markdown).not.toContain(note.revision);
  const packaged = await renderMarkdownPackage(document);
  expect(packaged.extension).toBe("zip");
  const files = unzipSync(packaged.bytes);
  expect(JSON.parse(strFromU8(files["assets/provenance/object.json"]))).toMatchObject({ objectId: note.objectId, revision: note.revision });
  vi.unstubAllGlobals();
});

test("link failure gives a recovery message and keeps the exact failure behind explicit technical details", async () => {
  const failure = "object:internal-982b36 failed at revision aaaa-1234";
  render(<ResourceLink locator="ignored" preview={<span>预览</span>} onOpen={async () => { throw new Error(failure); }}>打开资料</ResourceLink>);
  fireEvent.click(screen.getByRole("link", { name: "打开资料" }));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("预览暂不可用，请重试。");
  expect(within(status).queryByText(failure)).not.toBeVisible();
  fireEvent.click(within(status).getByText("技术错误详情"));
  expect(await screen.findByText(failure)).toBeVisible();
});
