import { test, expect } from "@playwright/test";
import { docsAssets, docsAssetUrl } from "../packages/api/src/docs-assets.js";

for (const base of ["http://127.0.0.1:3120", "http://127.0.0.1:5180/api"]) {
  test(`Swagger sends requests to ${base}`, async ({ page }) => {
    await page.goto(`${base}/docs`);
    await expect(page.locator(".swagger-ui .info .title")).toContainText("Compare DEX Routers");
    const health = page.locator("#operations-default-getHealth");
    await health.locator(".opblock-summary").click();
    await health.getByRole("button", { name: "Try it out" }).click();
    const response = page.waitForResponse(`${base}/health`);
    await health.getByRole("button", { name: "Execute", exact: true }).click();
    expect((await response).status()).toBe(200);
    expect(await page.locator('script[src*="swagger-ui-bundle"]').getAttribute("integrity")).toBe(
      docsAssets.js.integrity
    );
    expect(await page.locator('link[href*="swagger-ui.css"]').getAttribute("integrity")).toBe(
      docsAssets.css.integrity
    );
  });
}

test("the browser refuses changed CDN JavaScript", async ({ page }) => {
  let intercepted = false;
  await page.route(docsAssetUrl(docsAssets.js.file), (route) => {
    intercepted = true;
    return route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: "globalThis.compromisedCdnExecuted = true;",
    });
  });
  await page.goto("/api/docs");
  expect(intercepted).toBe(true);
  expect(await page.evaluate(() => "compromisedCdnExecuted" in globalThis)).toBe(false);
  await expect(page.locator(".swagger-ui")).toHaveCount(0);
});
