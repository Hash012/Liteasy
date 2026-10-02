import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("50 real thumbnail open/close cycles release operator caches and canvases", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  let workersStarted = 0;
  let workersClosed = 0;
  page.on("worker", (worker) => { workersStarted++; worker.on("close", () => { workersClosed++; }); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/src/tests/browser/pdf-lifecycle-fixture.html");
  await expect.poll(() => page.evaluate(() => "pdfLifecycleFixture" in window)).toBe(true);
  const runs = [];
  for (let index = 0; index < 3; index++) {
    runs.push(await page.evaluate(async () => (window as unknown as { pdfLifecycleFixture: { run(): Promise<Record<string, number>> } }).pdfLifecycleFixture.run()));
  }
  await expect.poll(() => page.workers().length).toBe(0);
  const report = { browser: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency), workersStarted, workersClosed, remainingWorkers: page.workers().length, runs };
  const reportPath = testInfo.outputPath("pdf-thumbnail-lifecycle.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("thumbnail-lifecycle-measurements", { path: reportPath, contentType: "application/json" });
  expect(errors).toEqual([]);
  expect(workersStarted).toBe(3);
  expect(workersClosed).toBe(3);
  for (const run of runs) {
    expect(run.remainingOperatorLists).toBe(0);
    expect(run.remainingOperators).toBe(0);
    expect(run.maximumCanvasPixels).toBeLessThanOrEqual(1_000_000);
    expect(run.closedCanvasPixels).toBe(50);
  }
});
