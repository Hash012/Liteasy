import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMineruFigures } from "./mineruFigureAnalysis.mjs";

const figures = [{
  alt: "Extracted figure 1",
  dataUrl: "data:image/png;base64,AQID",
  id: "mineru-figure-1",
  page: 2,
  sourcePath: "images/figure.png"
}];

test("sends every extracted figure through a strict OpenAI Responses request", async () => {
  let request;
  const result = await analyzeMineruFigures({
    fetchImpl: async (url, init) => {
      request = { body: JSON.parse(init.body), headers: init.headers, url };
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ figures: [{
          description: "A measured result.",
          id: "mineru-figure-1",
          importance: "primary",
          kind: "chart",
          placement: "results",
          selectionReason: "Central evidence.",
          title: "Main result"
        }] })
      }), { status: 200 });
    },
    figures,
    modelConfig: { apiKey: "provider-secret", baseUrl: "https://models.example/v1", model: "vision-model" },
    paperTitle: "Paper"
  });
  assert.equal(request.url, "https://models.example/v1/responses");
  assert.equal(request.headers.Authorization, "Bearer provider-secret");
  assert.equal(request.body.model, "vision-model");
  assert.equal(request.body.text.format.strict, true);
  assert.deepEqual(request.body.input[0].content.at(-1), {
    detail: "high",
    image_url: figures[0].dataUrl,
    type: "input_image"
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.selectedFigureIds, ["mineru-figure-1"]);
  assert.equal(result.figures[0].analysis.title, "Main result");
});

test("retries figure analysis without text.format and still normalizes the JSON result", async () => {
  const bodies = [];
  const result = await analyzeMineruFigures({
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1
        ? new Response("schema unsupported", { status: 502 })
        : new Response(JSON.stringify({
          output_text: JSON.stringify({ figures: [{
            description: "  Visible measured result.  ",
            id: "mineru-figure-1",
            importance: "primary",
            kind: "chart",
            placement: "results",
            selectionReason: "Central evidence.",
            title: "Main result"
          }] })
        }), { status: 200 });
    },
    figures,
    modelConfig: { apiKey: "provider-secret", baseUrl: "https://models.example/v1", model: "vision-model" },
    paperTitle: "Paper"
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].text.format.strict, true);
  assert.equal("text" in bodies[1], false);
  assert.equal(result.figures[0].analysis.description, "Visible measured result.");
});

test("does not retry figure analysis for authentication or rate-limit failures", async (t) => {
  for (const status of [401, 403, 429]) {
    await t.test(String(status), async () => {
      let calls = 0;
      await assert.rejects(() => analyzeMineruFigures({
        fetchImpl: async () => {
          calls += 1;
          return new Response("denied", { status });
        },
        figures,
        modelConfig: { apiKey: "provider-secret", baseUrl: "https://models.example/v1", model: "vision-model" },
        paperTitle: "Paper"
      }), new RegExp(`model response status ${status}`));
      assert.equal(calls, 1);
    });
  }
});

test("skips the model request without a configured provider", async () => {
  const result = await analyzeMineruFigures({ figures, modelConfig: undefined, paperTitle: "Paper" });
  assert.deepEqual(result, { figures, status: "skipped" });
});
