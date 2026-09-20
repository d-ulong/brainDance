// Final convergence assertions for S1–S3 failure paths. All /api/** calls are mocked.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { resolveImplementationEvidence } = require("./browser-evidence-common.cjs");
const { setupStudentPlan, setupParentBindings } = require("./state-repair-browser.cjs");

const base = "http://127.0.0.1:3002";
const title = (page) => page.locator("form input").first();
const failures = [];
const evidenceMeta = resolveImplementationEvidence();

function assert(name, ok, detail) {
  if (!ok) failures.push({ name, detail });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const result = { ...evidenceMeta, checks: [] };
  try {
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans`, { waitUntil: "networkidle" });
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      await title(s.page).fill("Clean after save");
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(450);
      await s.page.evaluate(() => history.back());
      await s.page.waitForTimeout(900);
      const urlAfterOneBack = s.page.url();
      const leftEditInOneBack =
        urlAfterOneBack.replace(/\/$/, "") === `${base}/student/plans`.replace(/\/$/, "");
      assert("C3-clean-save-single-back", leftEditInOneBack, { urlAfterOneBack });
      result.checks.push({
        name: "clean-save-single-back",
        urlAfterOneBack,
        leftEditInOneBack,
      });
      await s.context.close();
    }

    {
      const s = await setupParentBindings(browser);
      let patchRequests = 0;
      s.page.on("request", (request) => {
        if (request.method() === "PATCH" && new URL(request.url()).pathname === "/api/plan-library") {
          patchRequests += 1;
        }
      });
      await s.context.route("**/api/plan-library/parent-plan/activate", async (route) => {
        const studentId = route.request().postDataJSON().studentId;
        await new Promise((resolve) => setTimeout(resolve, 800));
        s.plan.bindings.push({
          studentId,
          displayName: "Student B",
          username: "b",
          effectiveFrom: "2026-09-21",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            itemsCreated: 0,
            effectiveFrom: "2026-09-21",
            generatedFrom: "2026-09-21",
            generatedThrough: "2026-09-21",
          }),
        });
      });
      await s.page.goto(`${base}/parent/plans/parent-plan/edit`, { waitUntil: "networkidle" });
      await s.page.locator("summary", { hasText: "已选择" }).click();
      await s.page.getByRole("checkbox", { name: "Student B", exact: true }).check();
      await s.page.getByTestId("plan-edit-save-bindings").click();
      const titleDisabled = await title(s.page).isDisabled();
      const definitionSaveDisabled = await s.page.getByTestId("plan-edit-save").isDisabled();
      if (!titleDisabled) await title(s.page).fill("Changed during binding");
      if (!definitionSaveDisabled) await s.page.getByTestId("plan-edit-save").click();
      await s.page.waitForTimeout(1100);
      assert("C1-binding-locks-definition", titleDisabled && definitionSaveDisabled && patchRequests === 0, {
        titleDisabled,
        definitionSaveDisabled,
        patchRequests,
      });
      result.checks.push({
        name: "binding-locks-definition",
        titleDisabled,
        definitionSaveDisabled,
        patchRequests,
      });
      await s.context.close();
    }

    {
      const s = await setupParentBindings(browser);
      await s.context.route("**/api/plan-library/parent-plan/activate", async (route) => {
        const studentId = route.request().postDataJSON().studentId;
        s.plan.bindings.push({
          studentId,
          displayName: "Student B",
          username: "b",
          effectiveFrom: "2026-09-21",
        });
        s.setFetchFail(true);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            itemsCreated: 0,
            effectiveFrom: "2026-09-21",
            generatedFrom: "2026-09-21",
            generatedThrough: "2026-09-21",
          }),
        });
      });
      await s.page.goto(`${base}/parent/plans/parent-plan/edit`, { waitUntil: "networkidle" });
      await s.page.locator("summary", { hasText: "已选择" }).click();
      const b = s.page.getByRole("checkbox", { name: "Student B", exact: true });
      await b.check();
      await s.page.getByTestId("plan-edit-save-bindings").click();
      await s.page.waitForTimeout(500);
      if (await s.page.getByRole("button", { name: "知道了" }).count()) {
        await s.page.getByRole("button", { name: "知道了" }).click();
      }
      await b.uncheck();
      const selectedBeforeRefresh = await b.isChecked();
      s.setFetchFail(false);
      await s.page.getByTestId("plan-edit-refresh-bindings").click();
      await s.page.waitForTimeout(500);
      const selectedAfterRefresh = await b.isChecked();
      const saveBindingsVisibleAfterRefresh = await s.page.getByTestId("plan-edit-save-bindings").count();
      assert(
        "C2-refresh-preserves-new-pending-target",
        !selectedBeforeRefresh && !selectedAfterRefresh && saveBindingsVisibleAfterRefresh === 1,
        {
          selectedBeforeRefresh,
          selectedAfterRefresh,
          saveBindingsVisibleAfterRefresh,
        },
      );
      result.checks.push({
        name: "refresh-preserves-new-pending-target",
        selectedBeforeRefresh,
        selectedAfterRefresh,
        saveBindingsVisibleAfterRefresh,
      });
      await s.context.close();
    }
  } finally {
    await browser.close();
    result.failures = failures;
    result.pass = failures.length === 0;
    const evidenceFile = path.join(os.tmpdir(), "braindance-review-72db812.json");
    fs.writeFileSync(evidenceFile, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, evidenceFile }, null, 2));
    if (failures.length) process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
