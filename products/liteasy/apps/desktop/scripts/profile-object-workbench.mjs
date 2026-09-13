// Run against the desktop Vite dev server; isolated Chromium profile, no model/network calls.
// PLAYWRIGHT_BASE_URL=http://127.0.0.1:1435 node scripts/profile-object-workbench.mjs
import { chromium } from "@playwright/test";
import os from "node:os";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:1435");
  const timings = await page.evaluate(async () => {
    const { createObjectStorage } =
      await import("/src/app/features/objects/objectStorage.ts");
    const { createObjectRepository } =
      await import("/src/app/features/objects/objectRepository.ts");
    const scope = "performance-fixture";
    const storage = createObjectStorage(scope, () => scope);
    const repo = createObjectRepository(storage, scope);
    const now = new Date().toISOString();
    for (let start = 0; start < 10000; start += 200) {
      const changes = [];
      for (let i = start; i < start + 200; i++) {
        const objectId = crypto.randomUUID(),
          revision = crypto.randomUUID();
        const title = `Research ${String(i).padStart(5, "0")}`;
        const object = {
          schemaVersion: "liteasy.object/v1",
          objectId,
          revision,
          title,
          scopeId: scope,
          createdAt: now,
          updatedAt: now,
          createdBy: { type: "user", id: scope },
          assets: [],
          provenance: { sourceRefs: [] },
          lifecycle: "active",
          kind: "content.note",
          content: {
            schema: "liteasy.note/v1",
            payload: { text: "Research evidence. ".repeat(30), origin: "user" },
          },
        };
        for (const [key, value] of [
          [`head/${objectId}`, object],
          [`revision/${objectId}/${revision}`, object],
          [`title/${objectId}`, { objectId, title, lifecycle: "active" }],
        ])
          changes.push({
            key,
            expected: null,
            row: { key, version: revision, value },
          });
      }
      await storage.commit(changes);
    }
    const list = [],
      search = [];
    for (let i = 0; i < 21; i++) {
      let start = performance.now();
      await repo.search();
      if (i) list.push(performance.now() - start);
      start = performance.now();
      const result = await repo.search("09999");
      if (result.objects.length !== 1)
        throw new Error("Search fixture mismatch");
      if (i) search.push(performance.now() - start);
    }
    const local = createObjectRepository(
      createObjectStorage("local", () => "local"),
      "local",
    );
    const board = await local.create({
      kind: "workspace.board",
      title: "100 card fixture",
      content: { schema: "liteasy.board/v1", payload: { description: "" } },
    });
    const refs = [];
    for (let i = 0; i < 100; i++) {
      const object = await local.create({
        kind: "content.note",
        title: `Card ${i}`,
        content: {
          schema: "liteasy.note/v1",
          payload: {
            text: `Evidence ${i}. A short research note for interaction measurement.`,
            origin: "user",
          },
        },
      });
      refs.push({ objectId: object.objectId, revision: object.revision });
    }
    await local.applyBoardPatch({
      boardRef: { objectId: board.objectId, revision: board.revision },
      operationId: crypto.randomUUID(),
      add: refs,
    });
    return { list, search, ref: refs[0], boardId: board.objectId };
  });
  await page.getByRole("button", { name: "研究白板", exact: true }).click();
  await page
    .locator(".object-placement")
    .nth(99)
    .waitFor({ state: "attached" });
  const drop = await page.evaluate(async ({ ref, boardId }) => {
    const { makeObjectTransfer, writeObjectTransfer } =
      await import("/src/app/features/object-transfer/objectTransfer.ts");
    const { createObjectStorage } =
      await import("/src/app/features/objects/objectStorage.ts");
    const { createObjectRepository } =
      await import("/src/app/features/objects/objectRepository.ts");
    const repo = createObjectRepository(
      createObjectStorage("local", () => "local"),
      "local",
    );
    const samples = [];
    for (let i = 0; i < 21; i++) {
      const before = new Set(
        [...document.querySelectorAll(".object-placement")].map(
          (el) => el.dataset.placementId,
        ),
      );
      const data = new DataTransfer();
      writeObjectTransfer(data, makeObjectTransfer([ref], "Evidence"));
      const start = performance.now();
      document.querySelector(".object-board").dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error("Drop render timed out"));
        }, 10000);
        const observer = new MutationObserver(() => {
          const cards = [...document.querySelectorAll(".object-placement")];
          const added = cards.find((el) => !before.has(el.dataset.placementId));
          if (cards.length === 101 && added?.querySelector(".object-surface")) {
            added.scrollIntoView({ block: "nearest" });
            observer.disconnect();
            clearTimeout(timeout);
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }
        });
        observer.observe(document.querySelector(".object-board"), {
          childList: true,
          subtree: true,
        });
      });
      if (i) samples.push(performance.now() - start);
      // Use the actual UI removal path so the controller refreshes before the next sample.
      const placements = await repo.listPlacements(boardId);
      const last = placements.find((p) => !before.has(p.placementId));
      const card =
        last &&
        document.querySelector(`[data-placement-id="${last.placementId}"]`);
      if (!card) throw new Error("Missing newly placed card");
      [...card.querySelectorAll("button")]
        .find((button) => button.textContent === "移除卡片")
        .click();
      while (document.querySelectorAll(".object-placement").length !== 100)
        await new Promise((r) => setTimeout(r, 10));
    }
    return samples;
  }, timings);
  const summary = (values) => ({
    samples: values.length,
    p50: values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.5) - 1],
    p95: values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1],
  });
  console.log(
    JSON.stringify(
      {
        environment: {
          cpu: os.cpus()[0].model,
          logicalCpus: os.cpus().length,
          memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
          platform: os.platform(),
          node: process.version,
          chromium: browser.version(),
          mode: "Vite dev; Chromium; synthetic DOM drop through real UI handlers",
        },
        objectCount: 10000,
        cardCount: 100,
        milliseconds: {
          list: summary(timings.list),
          titleSearch: summary(timings.search),
          referenceDropThroughNextPaint: summary(drop),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
