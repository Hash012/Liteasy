import { expect, test, type Page, type Route } from "@playwright/test";
import { makeVisualizationArtifactFixture } from "../fixtures/visualizationArtifactFixtures";

type RequestCoordinates = {
  artifactId: string;
  nodeId: string;
  requestId: string;
  requestedArtifactCount: number;
};

async function mountFixture(
  page: Page,
  options: { authorized?: boolean; preserveStorage?: boolean; recover?: boolean } = {}
) {
  await page.goto("/");
  if (!options.preserveStorage) {
    await page.evaluate(() => window.localStorage.clear());
  }
  await page.evaluate(async (fixtureOptions) => {
    document.body.innerHTML = '<div id="thin-reading-orchestration-fixture"></div>';
    const fixture = await import(
      "/src/tests/fixtures/thinReadingVisualizationOrchestrationBrowserFixture.tsx"
    );
    fixture.mountThinReadingVisualizationOrchestrationBrowserFixture(
      document.getElementById("thin-reading-orchestration-fixture"),
      fixtureOptions
    );
  }, {
    authorized: options.authorized,
    recover: options.recover
  });
}

function activePayload(requestId: string) {
  return {
    requestId,
    resultArtifactIds: [],
    retryAfterMs: 250,
    status: "queued"
  };
}

function readyPayload(requestId: string, nodeId: string) {
  const artifactId = `viz-${requestId}-result`;
  return {
    artifacts: [{
      ...makeVisualizationArtifactFixture(),
      artifactId,
      nodeId
    }],
    requestId,
    resultArtifactIds: [artifactId],
    status: "succeeded"
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json",
    status
  });
}

test.describe("thin-reading visualization orchestration", () => {
  for (const viewport of [
    { height: 900, name: "desktop", width: 1440 },
    { height: 844, name: "mobile", width: 390 }
  ]) {
    test(`starts through the account API and preserves region order on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      const requestsById = new Map<string, RequestCoordinates>();
      let postCount = 0;
      await page.route("**/v1/account/visualization/requests**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.endsWith("/requests")) {
          postCount += 1;
          const coordinates = request.postDataJSON() as RequestCoordinates;
          requestsById.set(coordinates.requestId, coordinates);
          expect(coordinates).toEqual({
            artifactId: "artifact-thin-fixture",
            nodeId: expect.any(String),
            requestId: expect.any(String),
            requestedArtifactCount: 1
          });
          expect(request.headers().authorization).toBe("Bearer browser-visualization-token");
          await fulfillJson(route, activePayload(coordinates.requestId), 202);
          return;
        }
        if (request.method() === "GET") {
          const requestId = path.split("/").at(-1) ?? "";
          const coordinates = requestsById.get(requestId);
          if (coordinates) {
            await fulfillJson(route, readyPayload(coordinates.requestId, coordinates.nodeId));
            return;
          }
        }
        await route.abort();
      });
      await mountFixture(page);

      await page.getByRole("button", { name: "Start visualization" }).click();
      await expect(page.getByTestId("visualization-orchestration-status")).toHaveText("ready");
      expect(postCount).toBe(1);
      await expect(page.getByTestId("thin-reading-visuals")).toBeVisible();
      await expect(page.getByTestId("thin-reading-prose")).toBeVisible();
      await expect(page.getByTestId("thin-reading-source-figures")).toBeVisible();
      const order = await page.evaluate(() => {
        const rectangle = (id: string) => (
          document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.getBoundingClientRect()
        );
        const visual = rectangle("thin-reading-visuals");
        const prose = rectangle("thin-reading-prose");
        const source = rectangle("thin-reading-source-figures");
        return Boolean(visual && prose && source &&
          visual.bottom <= prose.top && prose.bottom <= source.top);
      });
      expect(order).toBe(true);
    });
  }

  test("denies unauthorized generation without an account API request", async ({ page }) => {
    let requests = 0;
    await page.route("**/v1/account/visualization/requests**", async (route) => {
      requests += 1;
      await route.abort();
    });
    await mountFixture(page, { authorized: false });

    await page.getByRole("button", { name: "Start visualization" }).click();
    await expect(page.getByTestId("visualization-orchestration-status")).toHaveText(
      "omitted:capability_unavailable"
    );
    expect(requests).toBe(0);
  });

  for (const scenario of [
    {
      action: "Disable visualization",
      expectedStatus: "omitted:preference_disabled",
      name: "preference-off",
      reason: "preference_disabled"
    },
    {
      action: "Cancel visualization",
      expectedStatus: "omitted:stale_request",
      name: "explicit user",
      reason: "user_cancelled"
    },
    {
      action: "Log out",
      expectedStatus: "logged_out",
      name: "logout",
      reason: "workflow_disposed"
    }
  ]) {
    test(`${scenario.name} cancellation reaches the account API`, async ({ page }) => {
      let coordinates: RequestCoordinates | undefined;
      let cancellationBody: Record<string, unknown> | undefined;
      await page.route("**/v1/account/visualization/requests**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.endsWith("/requests")) {
          coordinates = request.postDataJSON() as RequestCoordinates;
          await fulfillJson(route, activePayload(coordinates.requestId), 202);
          return;
        }
        if (request.method() === "POST" && path.endsWith("/cancel") && coordinates) {
          cancellationBody = request.postDataJSON() as Record<string, unknown>;
          await fulfillJson(route, {
            requestId: coordinates.requestId,
            resultArtifactIds: [],
            status: "cancelled"
          });
          return;
        }
        if (request.method() === "GET" && coordinates) {
          await fulfillJson(route, activePayload(coordinates.requestId));
          return;
        }
        await route.abort();
      });
      await mountFixture(page);
      await page.getByRole("button", { name: "Start visualization" }).click();
      await expect(page.getByTestId("visualization-orchestration-status")).toHaveText("generating");

      await page.getByRole("button", { name: scenario.action }).click();
      await expect(page.getByTestId("visualization-orchestration-status")).toHaveText(
        scenario.expectedStatus
      );
      await expect.poll(() => cancellationBody).toEqual({
        idempotencyKey: expect.stringMatching(`:cancel:${scenario.reason}$`)
      });
    });
  }

  test("reload resumes polling with the original request coordinates", async ({ page }) => {
    let coordinates: RequestCoordinates | undefined;
    let recoveryReady = false;
    let postCount = 0;
    const statusRequestIds: string[] = [];
    await page.route("**/v1/account/visualization/requests**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path.endsWith("/requests")) {
        postCount += 1;
        coordinates = request.postDataJSON() as RequestCoordinates;
        await fulfillJson(route, activePayload(coordinates.requestId), 202);
        return;
      }
      if (request.method() === "POST" && path.endsWith("/cancel")) {
        await route.abort();
        return;
      }
      if (request.method() === "GET" && coordinates) {
        statusRequestIds.push(path.split("/").at(-1) ?? "");
        await fulfillJson(route, recoveryReady
          ? readyPayload(coordinates.requestId, coordinates.nodeId)
          : activePayload(coordinates.requestId));
        return;
      }
      await route.abort();
    });
    await mountFixture(page);
    await page.getByRole("button", { name: "Start visualization" }).click();
    await expect(page.getByTestId("visualization-orchestration-status")).toHaveText("generating");
    await expect.poll(() => coordinates?.requestId).toBeTruthy();

    recoveryReady = true;
    await mountFixture(page, { preserveStorage: true, recover: true });
    await expect(page.getByTestId("visualization-orchestration-status")).toHaveText("ready");
    expect(postCount).toBe(1);
    expect(statusRequestIds).toContain(coordinates?.requestId);
  });

  test("rejects malformed terminal artifacts", async ({ page }) => {
    await page.route("**/v1/account/visualization/requests**", async (route) => {
      const request = route.request();
      const coordinates = request.postDataJSON() as RequestCoordinates;
      await fulfillJson(route, {
        artifacts: [{ artifactId: "malformed-result" }],
        requestId: coordinates.requestId,
        resultArtifactIds: ["malformed-result"],
        status: "succeeded"
      });
    });
    await mountFixture(page);

    await page.getByRole("button", { name: "Start visualization" }).click();
    await expect(page.getByTestId("visualization-orchestration-status")).toHaveText(
      "omitted:result_invalid"
    );
  });
});
