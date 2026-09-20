const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const out = path.join(__dirname, "evidence-remediation");
const base = "http://127.0.0.1:3002";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function capture(page, name, url, meta = {}) {
  if (url) await page.goto(base + url, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const pngPath = path.join(out, `${name}.png`);
  await page.screenshot({ path: pngPath, fullPage: !(await page.getByRole("dialog").count()) });
  const record = {
    ...meta,
    route: url ? base + url : page.url(),
    viewport: page.viewportSize(),
    theme: await page.evaluate(() => document.documentElement.getAttribute("data-theme")),
    sha256: sha256(pngPath),
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(record, null, 2));
  console.log(name, record.sha256.slice(0, 12));
}

async function samples(browser) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const students = [
    {
      studentId: "sample-student",
      displayName: "小禾（示例）",
      username: "sample",
      relationshipId: "sample-relation",
    },
  ];
  const tasks = ["阅读二十分钟"].map((title, i) => ({
    id: "task-" + i,
    planId: "plan-0",
    planVersionId: "version-0",
    studentId: students[0].studentId,
    ownerId: "sample-parent",
    familyDate: day,
    slotKey: "s" + i,
    scheduledAt: day + "T17:00:00+08:00",
    status: "pending",
    source: "formal_plan",
    occurrenceKey: "sample-" + i,
    effectiveStatus: "pending",
    title,
    planTitle: "阅读计划",
    priority: 0,
    startedAt: null,
    description: "示例内容，仅用于审查布局。",
    maximumPoints: 10,
    pointsEarned: null,
    durationMinutes: 20,
  }));
  const entries = [
    {
      key: "e0",
      title: tasks[0].title,
      expectedTime: "17:00",
      latestStartTime: "17:10",
      durationMinutes: 20,
      repeat: { kind: "daily" },
      points: { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 1, incomplete: -2 },
    },
  ];
  const plans = [
    {
      id: "plan-0",
      revision: 3,
      definition: {
        title: "阅读计划",
        description: "每天阅读",
        startDate: day,
        entries,
      },
      priority: 0,
      createdAt: day + "T00:00:00Z",
      updatedAt: day + "T00:00:00Z",
      bindings: students.map((s) => ({ ...s, effectiveFrom: day })),
      ownerId: "sample-parent",
      ownerName: "家长（示例）",
      canEdit: true,
      boundToSelf: true,
      generatedDatesByStudent: { "sample-student": [day] },
    },
  ];
  const summary = {
    netPoints: 10,
    schedulePoints: 10,
    goalRewards: 0,
    manualAdjustments: 0,
    maximumSchedulePoints: 40,
    entries: [],
    from: day,
    through: day,
  };

  for (const role of ["student", "parent"]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    let empty = false;
    let failure = false;
    await ctx.route("**/api/**", async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const p = u.pathname;
      const reply = (body, status = 200) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (req.method() === "POST" && p === "/api/training/sessions") {
        return reply({
          sessionId: "sample-session",
          trainingKey: req.postDataJSON().trainingKey,
          definitionVersion: 1,
          ageBand: "9-12",
          familyDate: day,
          expectedTrialCount: 16,
          status: "active",
          idempotentReplay: false,
        });
      }
      if (req.method() === "POST" && p.endsWith("/events")) {
        return reply({
          sequence: req.postDataJSON().sequence,
          occurredAt: new Date().toISOString(),
          blurAccumulatedMs: 0,
          abandoned: false,
        });
      }
      if (req.method() !== "GET") return reply({ error: "UI audit blocks writes" }, 409);
      if (p === "/api/auth/session") {
        return reply({
          userId: role === "student" ? "sample-student" : "sample-parent",
          role,
          displayName: role === "student" ? "小禾（示例）" : "家长（示例）",
          account: "sample",
          contactVerified: true,
          mustChangePassword: false,
        });
      }
      if (failure) return reply({ error: "示例：服务暂时不可用" }, 503);
      if (p === "/api/family/students") return reply({ students: empty ? [] : students });
      if (p === "/api/plan-library") {
        return reply({
          plans: empty
            ? []
            : plans.map((v) => ({
                ...v,
                boundToSelf: role === "student",
                ownerId: role === "student" ? "sample-student" : v.ownerId,
              })),
        });
      }
      if (p.endsWith("/schedule-items")) return reply({ items: empty ? [] : tasks });
      if (p.endsWith("/points/balance")) return reply({ balance: empty ? 0 : 120, lastLedgerEntryId: null, updatedAt: null });
      if (p.endsWith("/points/summary")) return reply(empty ? { ...summary, netPoints: 0 } : summary);
      if (p.includes("/training/summary") || p.endsWith("/training-summary")) {
        return reply({
          traineeId: "sample-student",
          trainingKey: u.searchParams.get("trainingKey") || "reaction",
          definitionVersion: 1,
          ageBand: "9-12",
          familyDate: day,
          lastSession: null,
          projection: [],
        });
      }
      return reply({});
    });

    const page = await ctx.newPage();
    const roleMeta = { role, dataSource: "playwright-mock" };

    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : width === 768 ? 1024 : 1000 });
      await capture(page, `remediation-${role}-home-${width}`, "/", roleMeta);
    }

    if (role === "student") {
      await page.setViewportSize({ width: 360, height: 800 });
      await capture(page, "remediation-student-plans-360", "/student/plans", roleMeta);
      await capture(page, "remediation-student-schedule-360", "/student/plans?view=schedule", roleMeta);
      await page.getByRole("button", { name: "周", exact: true }).click();
      await capture(page, "remediation-student-calendar-week-360", null, roleMeta);
      await page.getByRole("button", { name: "月", exact: true }).click();
      await capture(page, "remediation-student-calendar-month-360", null, roleMeta);
      await capture(page, "remediation-student-plan-edit-360", "/student/plans/plan-0/edit", roleMeta);
      const active = await ctx.newPage();
      await active.setViewportSize({ width: 360, height: 800 });
      await active.goto(base + "/student/training/reaction", { waitUntil: "networkidle" });
      await active.getByTestId("reaction-start").click();
      await active.getByTestId("training-target").waitFor();
      await capture(active, "remediation-student-reaction-active-360", null, roleMeta);
      await active.close();
      empty = true;
      await capture(page, "remediation-student-home-empty-360", "/", roleMeta);
      failure = true;
      await capture(page, "remediation-student-home-error-360", "/", roleMeta);
      failure = false;
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.setItem("bd-theme", "candy");
        document.documentElement.setAttribute("data-theme", "candy");
      });
      await capture(page, "remediation-student-home-candy-360", null, { ...roleMeta, theme: "candy" });
    } else {
      await page.setViewportSize({ width: 360, height: 800 });
      await capture(page, "remediation-parent-students-360", "/parent/students", roleMeta);
      await capture(page, "remediation-parent-plans-360", "/parent/plans", roleMeta);
      await capture(page, "remediation-parent-plan-edit-360", "/parent/plans/plan-0/edit", roleMeta);
      empty = true;
      await capture(page, "remediation-parent-home-empty-360", "/", roleMeta);
      failure = true;
      await capture(page, "remediation-parent-home-error-360", "/", roleMeta);
      failure = false;
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.setItem("bd-theme", "candy");
        document.documentElement.setAttribute("data-theme", "candy");
      });
      await capture(page, "remediation-parent-home-candy-360", null, { ...roleMeta, theme: "candy" });
    }
    await ctx.close();
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    await samples(browser);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
