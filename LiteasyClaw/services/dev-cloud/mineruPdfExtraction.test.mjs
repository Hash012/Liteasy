import test from "node:test";
import assert from "node:assert/strict";
import {
  figureAssets,
  findMatchingContentItemForImagePath,
  normalizeMineruAssetPath
} from "./mineruPdfExtraction.mjs";

test("normalizeMineruAssetPath canonicalizes slash and dot noise", () => {
  assert.equal(
    normalizeMineruAssetPath(".\\output//draft/../Images/./page_1\\Figure-1.png"),
    "output/images/page_1/figure-1.png"
  );
  assert.equal(normalizeMineruAssetPath("/images//figure.png/"), "images/figure.png");
  assert.equal(normalizeMineruAssetPath(null), "");
});

test("findMatchingContentItemForImagePath matches normalized suffixes in both directions", () => {
  const contentList = [
    { img_path: "paper/images/figure-1.png", page_idx: 2 },
    { image_path: "images/figure-2.png", page_idx: 6 }
  ];

  assert.equal(
    findMatchingContentItemForImagePath(contentList, ".\\output\\..\\images\\FIGURE-1.png"),
    contentList[0]
  );
  assert.equal(
    findMatchingContentItemForImagePath(contentList, "paper/output/images/figure-2.png"),
    contentList[1]
  );
});

test("figureAssets enforces cumulative byte budget and stable page matching in one pass", () => {
  const sevenMiB = new Uint8Array(7 * 1024 * 1024);
  const twoMiB = new Uint8Array(2 * 1024 * 1024);
  const oneMiB = new Uint8Array(1024 * 1024);

  const figures = figureAssets(
    [
      { name: "figure-1.png", data: sevenMiB, path: ".\\images\\figure-1.png" },
      { name: "figure-2.png", data: twoMiB, path: "images/figure-2.png" },
      { name: "figure-3.png", data: oneMiB, path: "output/images/figure-3.png" }
    ],
    [
      { img_path: "paper/images/figure-1.png", page_idx: 0 },
      { image_path: ".\\images\\figure-2.png", page_idx: 4 },
      { path: "./images//figure-3.png", page_idx: 8 }
    ]
  );

  assert.equal(figures.length, 2);
  assert.deepEqual(
    figures.map((figure) => ({ id: figure.id, page: figure.page, sourcePath: figure.sourcePath })),
    [
      { id: "mineru-figure-1", page: 1, sourcePath: ".\\images\\figure-1.png" },
      { id: "mineru-figure-2", page: 9, sourcePath: "output/images/figure-3.png" }
    ]
  );
  assert.match(figures[0].dataUrl, /^data:image\/png;base64,/);
});
