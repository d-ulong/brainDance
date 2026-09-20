// Regression assertions for S01–S04 failure paths; all /api/** mocked.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("@playwright/test");
const { resolveImplementationEvidence } = require("./browser-evidence-common.cjs");
const { setupStudentPlan, setupParentBindings } = require("./state-repair-browser.cjs");
const evidenceMeta = resolveImplementationEvidence();
const base = "http://127.0.0.1:3002";
const title = (p) => p.locator("form input").first();
const failures = [];

function assert(name, ok, detail) {
  if (!ok) failures.push({ name, detail });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const result = { ...evidenceMeta, checks: [] };
  try {
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans/new`, { waitUntil: "networkidle" });
      await title(s.page).fill("Saved title");
      await s.page.locator("form fieldset fieldset input").first().fill("Read");
      await s.page.getByRole("button", { name: "保存计划", exact: true }).click();
      await s.page.getByTestId("student-plan-activate").waitFor();
      await s.page.waitForTimeout(250);
      s.setDelay(900);
      await s.page.getByTestId("student-plan-activate").click();
      const locked = await title(s.page).isDisabled();
      if (!locked) await title(s.page).fill("Edited during activation");
      const patchesDuring = s.writes.filter((w) => w.method === "PATCH").length;
      await s.page.waitForTimeout(1200);
      const stayedOnPage = s.page.url().includes("/student/plans/new");
      assert("S01-edit-during-activation-locked", locked, { locked });
      assert("S01-no-patch-during-activation", patchesDuring === 0, { patchesDuring });
      assert("S01-stays-until-success", stayedOnPage || s.page.url().includes("/student/plans"), {
        url: s.page.url(),
      });
      result.checks.push({ name: "edit-during-activation", locked, patchesDuring, url: s.page.url() });
      await s.context.close();
    }

    for (const refreshFail of [false, true]) {
      const s = await setupParentBindings(browser);
      await s.context.route("**/api/plan-library/parent-plan/activate", async (route) => {
        const studentId = route.request().postDataJSON().studentId;
        await new Promise((r) => setTimeout(r, 600));
        if (!s.plan.bindings.some((b) => b.studentId === studentId)) {
          s.plan.bindings.push({
            studentId,
            displayName: "Student B",
            username: "b",
            effectiveFrom: "2026-09-21",
          });
        }
        if (refreshFail) s.setFetchFail(true);
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
      const locked = await b.isDisabled();
      if (!refreshFail && !locked) await b.uncheck();
      await s.page.waitForTimeout(950);
      if (await s.page.getByRole("button", { name: "知道了" }).count()) {
        await s.page.getByRole("button", { name: "知道了" }).click();
      }
      const retryRefresh = await s.page.getByTestId("plan-edit-refresh-bindings").count();
      const bSelected = await b.isChecked();
      if (refreshFail) {
        assert("S03-refresh-retry-visible", retryRefresh === 1, { retryRefresh });
      } else {
        assert("S02-binding-locked-during-submit", locked, { locked });
        assert("S02-no-toggle-during-submit", bSelected, { bSelected });
      }
      result.checks.push({
        name: refreshFail ? "binding-refresh-failure" : "edit-during-binding",
        locked,
        bSelected,
        retryButtonCount: retryRefresh,
      });
      await s.context.close();
    }

    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans`, { waitUntil: "networkidle" });
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      await title(s.page).fill("Saved");
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(450);
      await s.page.evaluate(() => history.back());
      await s.page.waitForTimeout(900);
      const listUrl = `${base}/student/plans`.replace(/\/$/, "");
      const onListAfterCleanBack = s.page.url().replace(/\/$/, "") === listUrl;
      assert("C3-clean-back-before-forward", onListAfterCleanBack, { url: s.page.url() });
      const urlBeforeForward = s.page.url();
      await s.page.evaluate(() => history.forward());
      await s.page.waitForTimeout(900);
      const forwardMoved = s.page.url() !== urlBeforeForward && s.page.url().includes("/edit");
      assert("C3-forward-moves-to-edit", forwardMoved, {
        urlBeforeForward,
        urlAfterForward: s.page.url(),
      });
      await title(s.page).fill("Unsaved after forward");
      let confirms = 0;
      s.page.on("dialog", async (d) => {
        confirms++;
        await d.accept();
      });
      await s.page.evaluate(() => history.back());
      await s.page.waitForTimeout(900);
      const onList = s.page.url().includes("/student/plans") && !s.page.url().includes("/edit");
      assert("S04-forward-back-once-to-list", onList && confirms === 1, {
        url: s.page.url(),
        confirms,
      });
      result.checks.push({
        name: "forward-after-save-then-back",
        onListAfterCleanBack,
        forwardMoved,
        url: s.page.url(),
        confirms,
      });
      await s.context.close();
    }
  } finally {
    await browser.close();
    result.failures = failures;
    result.pass = failures.length === 0;
    const file = path.join(os.tmpdir(), `braindance-review-f98a45a-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, evidenceFile: file }, null, 2));
    if (failures.length) process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
