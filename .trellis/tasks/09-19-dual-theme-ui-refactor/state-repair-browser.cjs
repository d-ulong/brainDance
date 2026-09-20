// Focused browser regression: all /api/* mocked, assertions required.
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = "http://127.0.0.1:3002";
const failures = [];

function assert(name, ok, detail) {
  if (!ok) failures.push({ name, detail });
}

async function setupStudentPlan(browser, options = {}) {
  const context = await browser.newContext();
  const writes = [];
  let delay = 0;
  let plan = {
    id: "review-plan",
    revision: 1,
    priority: 0,
    canEdit: true,
    bindings: [],
    ownerId: "review-student",
    definition: {
      title: "Existing",
      startDate: "2026-09-20",
      entries: [
        {
          key: "item-1",
          title: "Read",
          expectedTime: "19:00",
          latestStartTime: null,
          durationMinutes: null,
          repeat: { kind: "daily" },
          points: {
            onTimeWithin: 10,
            onTimeOver: 0,
            lateWithin: 0,
            lateOver: 0,
            incomplete: 0,
          },
        },
      ],
    },
  };
  let createdId = null;

  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const reply = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (p === "/api/auth/session") {
      return reply({
        userId: "review-student",
        role: "student",
        displayName: "Review",
        account: "review",
        contactVerified: true,
        mustChangePassword: false,
      });
    }
    if (req.method() !== "GET") {
      writes.push({ method: req.method(), path: p, body: req.postDataJSON() });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (p === "/api/plan-library") {
        const body = req.postDataJSON();
        if (req.method() === "POST") {
          createdId = createdId ?? `created-${writes.filter((w) => w.method === "POST").length}`;
          plan = {
            ...plan,
            id: createdId,
            revision: plan.revision + 1,
            definition: body.definition,
            priority: body.priority ?? plan.priority,
          };
        } else if (req.method() === "PATCH") {
          plan = {
            ...plan,
            id: body.libraryId ?? plan.id,
            revision: plan.revision + 1,
            definition: body.definition,
            priority: body.priority ?? plan.priority,
          };
        }
        return reply({ plan });
      }
      return reply({ itemsCreated: 1, generatedFrom: "2026-09-20", generatedThrough: "2026-09-20" });
    }
    if (p === "/api/plan-library") return reply({ plans: [plan] });
    if (p.endsWith("/schedule-items")) return reply({ items: [] });
    if (p.endsWith("/points/balance")) return reply({ balance: 0 });
    if (p.endsWith("/points/summary")) return reply({ netPoints: 0, entries: [] });
    if (p.includes("goals")) return reply({ goals: [] });
    return reply({});
  });

  const page = await context.newPage();
  return {
    context,
    page,
    writes,
    setDelay: (ms) => {
      delay = ms;
    },
    getPlan: () => plan,
  };
}

async function setupParentBindings(browser, options = {}) {
  const context = await browser.newContext();
  const bindingCalls = [];
  let fetchFail = false;
  const plan = {
    id: options.planId ?? "parent-plan",
    revision: 2,
    priority: 0,
    canEdit: true,
    bindings:
      options.initialBindings ??
      [{ studentId: "student-a", displayName: "A", username: null, effectiveFrom: "2026-09-01" }],
    ownerId: "review-parent",
    definition: {
      title: "Parent plan",
      startDate: "2026-09-20",
      entries: [
        {
          key: "item-1",
          title: "Task",
          expectedTime: "18:00",
          repeat: { kind: "daily" },
          points: { onTimeWithin: 5, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
        },
      ],
    },
  };

  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const reply = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (p === "/api/auth/session") {
      return reply({
        userId: "review-parent",
        role: "parent",
        displayName: "Parent",
        account: "parent",
        contactVerified: true,
        mustChangePassword: false,
      });
    }
    if (req.method() !== "GET") {
      if (p.endsWith("/activate") && req.method() === "POST") {
        const body = req.postDataJSON();
        bindingCalls.push({ action: "bind", studentId: body.studentId });
        if (body.studentId === "student-b") {
          return reply({ message: "bind failed" }, 500);
        }
        if (!plan.bindings.some((b) => b.studentId === body.studentId)) {
          plan.bindings.push({
            studentId: body.studentId,
            displayName: body.studentId,
            username: null,
            effectiveFrom: "2026-09-20",
          });
        }
        return reply({ itemsCreated: 0, generatedFrom: "2026-09-20", generatedThrough: "2026-09-20" });
      }
      if (p.includes("/bindings/") && req.method() === "DELETE") {
        return reply({ idempotentReplay: false });
      }
      return reply({ plan });
    }
    if (p === "/api/plan-library") {
      if (fetchFail) return reply({ message: "refresh failed" }, 500);
      return reply({ plans: [plan] });
    }
    if (p === "/api/family/students") {
      return reply({
        students: [
          { studentId: "student-a", displayName: "Student A", username: "a" },
          { studentId: "student-b", displayName: "Student B", username: "b" },
        ],
      });
    }
    return reply({});
  });

  const page = await context.newPage();
  return {
    context,
    page,
    bindingCalls,
    setFetchFail: (v) => {
      fetchFail = v;
    },
    plan,
  };
}

const titleInput = (page) => page.locator("form input").first();
const entryTitleInput = (page) => page.locator("form fieldset fieldset input").first();

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const result = { checks: [] };
  try {
    // R01: new → save → rename → save → activate blocked
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans/new`, { waitUntil: "networkidle" });
      await titleInput(s.page).fill("First save");
      await entryTitleInput(s.page).fill("Read");
      const save = s.page.getByRole("button", { name: "保存计划", exact: true });
      await save.click();
      await s.page.getByTestId("student-plan-activate").waitFor();
      await titleInput(s.page).fill("Second save");
      await save.click();
      await s.page.waitForTimeout(400);
      const posts = s.writes.filter((w) => w.method === "POST" && w.path === "/api/plan-library");
      const patches = s.writes.filter((w) => w.method === "PATCH");
      const planId = s.getPlan().id;
      assert("R01-single-create", posts.length === 1, { posts: posts.length });
      assert(
        "R01-second-save-updates-same-id",
        patches.length >= 1 && patches.every((w) => w.body.libraryId === planId),
        { patches: patches.length, planId, ids: patches.map((w) => w.body?.libraryId) },
      );

      await titleInput(s.page).fill("Unsaved after second");
      let activateWritesBefore = s.writes.length;
      let confirms = 0;
      s.page.on("dialog", async (d) => {
        confirms++;
        await d.dismiss();
      });
      await s.page.getByTestId("student-plan-activate").click();
      await s.page.waitForTimeout(300);
      const stayedOnNew = s.page.url().includes("/student/plans/new");
      const activateWrites = s.writes.filter(
        (w) => w.method === "POST" && w.path.includes("/activate"),
      );
      assert("R01-activate-blocked-with-draft", stayedOnNew && confirms === 0, {
        url: s.page.url(),
        confirms,
        newWrites: s.writes.length - activateWritesBefore,
      });
      assert("R01-no-activate-with-unsaved-draft", activateWrites.length === 0, {
        activateWrites: activateWrites.length,
      });
      result.checks.push({ name: "R01", posts: posts.length, patches: patches.length, stayedOnNew });
      await s.context.close();
    }

    // R02 / R03: history + typing during save
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans`, { waitUntil: "networkidle" });
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      const initial = await s.page.evaluate(() => history.length);
      await titleInput(s.page).fill("Saved one");
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(400);
      await titleInput(s.page).fill("Saved two");
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(400);
      await titleInput(s.page).fill("Unsaved third");
      const final = await s.page.evaluate(() => history.length);
      assert("R03-history-not-growing", final <= initial + 1, { initial, final });
      let confirms = 0;
      s.page.on("dialog", async (d) => {
        confirms++;
        await d.accept();
      });
      await s.page.evaluate(() => history.back());
      await s.page.waitForTimeout(1200);
      const onList = s.page.url().includes("/student/plans") && !s.page.url().includes("/edit");
      assert("R03-back-confirms-to-list", onList && confirms === 1, { url: s.page.url(), confirms });
      result.checks.push({ name: "R03", initial, final, onList, confirms });

      await s.context.close();
    }

    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      await titleInput(s.page).fill("Sent snapshot");
      s.setDelay(800);
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      const locked = await titleInput(s.page).isDisabled();
      await s.page.waitForTimeout(1100);
      await titleInput(s.page).fill("After save edit");
      let confirms = 0;
      s.page.on("dialog", async (d) => {
        confirms++;
        await d.dismiss();
      });
      await s.page.getByRole("button", { name: "取消", exact: true }).click();
      await s.page.waitForTimeout(400);
      const stayed = s.page.url().includes("/edit");
      assert("R02-fields-locked-while-saving", locked, { locked });
      assert("R02-cancel-guards-unsaved-after-save", stayed && confirms === 1, { confirms, url: s.page.url() });
      result.checks.push({
        name: "R02",
        locked,
        submittedTitle: s.writes[0]?.body?.definition?.title,
        confirms,
        stayed,
      });
      await s.context.close();
    }

    // R05: weekly empty then Friday only
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      await s.page.locator("form select").first().selectOption("weekly");
      await s.page.waitForTimeout(200);
      for (const day of ["一", "二", "三", "四", "五", "六", "日"]) {
        const btn = s.page.getByRole("button", { name: `周${day}`, exact: true });
        if ((await btn.count()) === 0) continue;
        if ((await btn.getAttribute("aria-pressed")) === "true") await btn.click();
      }
      const writesBefore = s.writes.length;
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(300);
      const dialogVisible = await s.page.getByRole("dialog").count();
      assert("R05-empty-week-no-request", s.writes.length === writesBefore, { writes: s.writes.length });
      assert("R05-empty-week-error-visible", dialogVisible > 0, { dialogVisible });
      await s.page.getByLabel("关闭").click();
      await s.page.getByRole("button", { name: "周五", exact: true }).click();
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(400);
      const last = s.writes.at(-1);
      const weekdays = last?.body?.definition?.entries?.[0]?.repeat?.weekdays;
      assert("R05-friday-only", weekdays?.length === 1 && weekdays[0] === 5, { weekdays });
      result.checks.push({ name: "R05", weekdays, writes: s.writes.length - writesBefore });
      await s.context.close();
    }

    // R04: partial bind failure keeps selection
    {
      const s = await setupParentBindings(browser);
      await s.page.goto(`${base}/parent/plans/parent-plan/edit`, { waitUntil: "networkidle" });
      await s.page.locator("summary", { hasText: "已选择" }).click();
      const studentB = s.page.getByRole("checkbox", { name: "Student B", exact: true });
      await studentB.check();
      await s.page.getByTestId("plan-edit-save-bindings").click();
      await s.page.waitForTimeout(600);
      if (await s.page.getByRole("button", { name: "知道了" }).count()) {
        await s.page.getByRole("button", { name: "知道了" }).click();
      }
      const bStillSelected = await studentB.isChecked();
      const aCalls = s.bindingCalls.filter((c) => c.studentId === "student-a").length;
      const bCalls = s.bindingCalls.filter((c) => c.studentId === "student-b").length;
      assert("R04-keeps-failed-target", bStillSelected, { bStillSelected });
      await s.page.getByTestId("plan-edit-save-bindings").click();
      await s.page.waitForTimeout(400);
      if (await s.page.getByRole("button", { name: "知道了" }).count()) {
        await s.page.getByRole("button", { name: "知道了" }).click();
      }
      const bCallsAfter = s.bindingCalls.filter((c) => c.studentId === "student-b").length;
      assert("R04-retry-only-failed-target", aCalls === 0 && bCallsAfter === 2 && bCalls === 1, {
        aCalls,
        bCalls,
        bCallsAfter,
      });
      result.checks.push({ name: "R04", bStillSelected, bCalls, bCallsAfter });
      await s.context.close();
    }

    // R04: fresh bind A ok + B fail, retry sends only B
    {
      const s = await setupParentBindings(browser, { initialBindings: [] });
      await s.page.goto(`${base}/parent/plans/parent-plan/edit`, { waitUntil: "networkidle" });
      await s.page.locator("summary", { hasText: "暂不绑定" }).click();
      await s.page.getByRole("checkbox", { name: "Student A", exact: true }).check();
      await s.page.getByRole("checkbox", { name: "Student B", exact: true }).check();
      await s.page.getByTestId("plan-edit-save-bindings").click();
      await s.page.waitForTimeout(700);
      if (await s.page.getByRole("button", { name: "知道了" }).count()) {
        await s.page.getByRole("button", { name: "知道了" }).click();
      }
      const aCallsMid = s.bindingCalls.filter((c) => c.studentId === "student-a").length;
      const bCallsMid = s.bindingCalls.filter((c) => c.studentId === "student-b").length;
      assert("R04-fresh-A-once-B-once", aCallsMid === 1 && bCallsMid === 1, { aCallsMid, bCallsMid });
      await s.page.getByTestId("plan-edit-save-bindings").click();
      await s.page.waitForTimeout(500);
      const aCallsFinal = s.bindingCalls.filter((c) => c.studentId === "student-a").length;
      const bCallsFinal = s.bindingCalls.filter((c) => c.studentId === "student-b").length;
      assert("R04-fresh-retry-B-only", aCallsFinal === 1 && bCallsFinal === 2, {
        aCallsFinal,
        bCallsFinal,
      });
      result.checks.push({ name: "R04-fresh", aCallsFinal, bCallsFinal });
      await s.context.close();
    }

    // R04: bind write ok, refresh GET fails, retry read only
    {
      const s = await setupParentBindings(browser);
      let getCalls = 0;
      let failNextGet = false;
      await s.context.unroute("**/api/**");
      await s.context.route("**/api/**", async (route) => {
        const req = route.request();
        const p = new URL(req.url()).pathname;
        const reply = (body, status = 200) =>
          route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (p === "/api/auth/session") {
          return reply({
            userId: "review-parent",
            role: "parent",
            displayName: "Parent",
            account: "parent",
            contactVerified: true,
            mustChangePassword: false,
          });
        }
        if (req.method() !== "GET") {
          if (p.endsWith("/activate") && req.method() === "POST") {
            const body = req.postDataJSON();
            s.bindingCalls.push({ action: "bind", studentId: body.studentId });
            if (body.studentId === "student-b") {
              failNextGet = true;
              s.plan.bindings.push({
                studentId: "student-b",
                displayName: "Student B",
                username: "b",
                effectiveFrom: "2026-09-21",
              });
              return reply({
                itemsCreated: 0,
                effectiveFrom: "2026-09-21",
                generatedFrom: "2026-09-21",
                generatedThrough: "2026-09-21",
              });
            }
          }
          return reply({ plan: s.plan });
        }
        if (p === "/api/plan-library") {
          getCalls++;
          if (failNextGet) {
            failNextGet = false;
            return reply({ message: "refresh failed" }, 500);
          }
          return reply({ plans: [s.plan] });
        }
        if (p === "/api/family/students") {
          return reply({
            students: [
              { studentId: "student-a", displayName: "Student A", username: "a" },
              { studentId: "student-b", displayName: "Student B", username: "b" },
            ],
          });
        }
        return reply({});
      });
      const page = s.page;
      await page.goto(`${base}/parent/plans/parent-plan/edit`, { waitUntil: "networkidle" });
      const titleBefore = await page.locator("form input").first().inputValue();
      await page.locator("summary", { hasText: "已选择" }).click();
      const studentB = page.getByRole("checkbox", { name: "Student B", exact: true });
      await studentB.check();
      const writesBefore = s.bindingCalls.length;
      await page.getByTestId("plan-edit-save-bindings").click();
      await page.waitForTimeout(900);
      if (await page.getByRole("button", { name: "知道了" }).count()) {
        await page.getByRole("button", { name: "知道了" }).click();
      }
      const refreshBtn = page.getByTestId("plan-edit-refresh-bindings");
      assert("R04-refresh-entry-visible", (await refreshBtn.count()) === 1, {
        count: await refreshBtn.count(),
      });
      const getBeforeRetry = getCalls;
      await refreshBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByRole("button", { name: "知道了" }).count()) {
        await page.getByRole("button", { name: "知道了" }).click();
      }
      const bindAfterRefresh = s.bindingCalls.length - writesBefore;
      assert("R04-refresh-retry-get-only", getCalls === getBeforeRetry + 1 && bindAfterRefresh === 1, {
        getCalls,
        getBeforeRetry,
        bindAfterRefresh,
      });
      assert("R04-definition-draft-unchanged", (await page.locator("form input").first().inputValue()) === titleBefore, {
        titleBefore,
        titleAfter: await page.locator("form input").first().inputValue(),
      });
      result.checks.push({ name: "R04-refresh", getCalls, bindAfterRefresh });
      await s.context.close();
    }

    // S01: activation locks fields; S04: forward then back confirm to list
    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans/new`, { waitUntil: "networkidle" });
      await titleInput(s.page).fill("Activation lock");
      await entryTitleInput(s.page).fill("Read");
      await s.page.getByRole("button", { name: "保存计划", exact: true }).click();
      await s.page.getByTestId("student-plan-activate").waitFor();
      s.setDelay(900);
      const writesBeforeActivate = s.writes.length;
      await s.page.getByTestId("student-plan-activate").click();
      await s.page.waitForTimeout(80);
      const locked = await titleInput(s.page).isDisabled();
      await titleInput(s.page).fill("Edited during activation").catch(() => {});
      await s.page.waitForTimeout(200);
      const parallelPatches = s.writes
        .slice(writesBeforeActivate)
        .filter((w) => w.method === "PATCH").length;
      await s.page.waitForTimeout(900);
      assert("S01-locked-during-activation", locked, { locked });
      assert("S01-no-parallel-patch-while-activating", parallelPatches === 0, { parallelPatches });
      result.checks.push({ name: "S01", locked, parallelPatches });
      await s.context.close();
    }

    {
      const s = await setupStudentPlan(browser);
      await s.page.goto(`${base}/student/plans`, { waitUntil: "networkidle" });
      await s.page.goto(`${base}/student/plans/review-plan/edit`, { waitUntil: "networkidle" });
      await titleInput(s.page).fill("Saved once");
      await s.page.getByRole("button", { name: "保存修改", exact: true }).click();
      await s.page.waitForTimeout(400);
      await s.page.evaluate(() => history.forward());
      await s.page.waitForTimeout(300);
      await titleInput(s.page).fill("Unsaved after forward");
      let confirms = 0;
      s.page.on("dialog", async (d) => {
        confirms++;
        await d.accept();
      });
      await s.page.evaluate(() => history.back());
      await s.page.waitForTimeout(900);
      const onList =
        s.page.url().includes("/student/plans") && !s.page.url().includes("/edit");
      assert("S04-forward-back-confirm-list", onList && confirms === 1, {
        url: s.page.url(),
        confirms,
      });
      result.checks.push({ name: "S04", onList, confirms });
      await s.context.close();
    }
  } finally {
    await browser.close();
  }

  result.failures = failures;
  result.pass = failures.length === 0;
  const file = path.join(os.tmpdir(), `braindance-state-repair-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidenceFile: file }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
