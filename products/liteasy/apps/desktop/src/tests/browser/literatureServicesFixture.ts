import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export const larimarTitle = "Larimar: Large Language Models with Episodic Memory Control";
export async function prepareMetadataFixture(page: Page) {
  const bibliography = await readFile(new URL("../../../../../../../development/test-data/literature/larimar-pmlr.bib", import.meta.url), "utf8");
  await page.route("https://proceedings.mlr.press/v235/das24a.html", (route) => route.fulfill({ contentType: "text/html", body:
    `<html><head><meta name="citation_publisher" content="PMLR"><meta name="citation_title" content="${larimarTitle}"><meta name="citation_abstract_html_url" content="https://proceedings.mlr.press/v235/das24a.html"></head><body><code id="bibtex">${bibliography}</code></body></html>` }));
  await page.route("https://proceedings.mlr.press/**/bibliography.bib", () => { throw new Error("Known paper should not download the whole PMLR volume"); });
}
export async function useBrowserMetadataStore(page: Page) {
  await page.evaluate(async () => {
    const modulePath = "/src/app/features/paper-identity/literatureMetadataRepository.ts";
    const { literatureMetadataRepository } = await import(/* @vite-ignore */ modulePath);
    const records = new Map();
    literatureMetadataRepository.load = async (id: string) => records.get(id);
    literatureMetadataRepository.save = async (id: string, record: unknown) => { records.set(id, record); };
  });
}
