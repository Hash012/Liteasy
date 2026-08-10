import { describe, expect, test } from "vitest";
import { createSafeSvgScene } from "../app/features/visualization/rendering/safeSvgScene";

describe("createSafeSvgScene", () => {
  test("escapes labels and rejects external resources", () => {
    const scene = createSafeSvgScene({
      width: 640,
      height: 360,
      nodes: [
        {
          id: "n-1",
          label: "<script>alert(1)</script>",
          x: 20,
          y: 20,
          width: 120,
          height: 40
        }
      ],
      edges: []
    });

    expect(scene.svg).not.toContain("<script>");
    expect(scene.svg).not.toContain("href=");
    expect(scene.svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("rejects scene geometry outside bounded dimensions", () => {
    expect(() => createSafeSvgScene({
      width: 64,
      height: 360,
      nodes: [],
      edges: []
    })).toThrow("scene_size_invalid");
  });
});
