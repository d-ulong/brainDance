import { expect, type Page } from "@playwright/test";

export async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

export async function completeReactionTraining(page: Page) {
  await page.goto("/student/training/reaction");
  const target = page.getByTestId("training-target");
  await expect(target).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("training-disclaimer")).toBeVisible();

  for (let trial = 0; trial < 5; trial += 1) {
    await expect(target).toContainText("Space / Enter", { timeout: 10_000 });
    await page.waitForTimeout(180);
    await target.click();
    if (trial < 4) {
      await page.waitForTimeout(150);
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 30_000 });
  await expect(page.getByTestId("metric-median_reaction_ms")).toBeVisible();
}

export async function completeStroopTraining(page: Page) {
  await page.goto("/student/training/stroop");
  await expect(page.getByTestId("stroop-stimulus")).toBeVisible({ timeout: 30_000 });

  const totalText = await page.getByText(/\/ \d+ 次/).innerText();
  const match = totalText.match(/\/ (\d+) 次/);
  const total = match ? Number(match[1]) : 16;

  for (let trial = 0; trial < total; trial += 1) {
    await page.waitForTimeout(180);
    await page.getByTestId("stroop-stimulus").focus();
    await page.keyboard.press("Enter");
    if (trial < total - 1) {
      await page.waitForTimeout(120);
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 60_000 });
  await expect(page.getByTestId("metric-interference_delta")).toBeVisible();
}

async function readDigitSpanAnswer(page: Page): Promise<number[]> {
  const subtitle = await page.locator("header p").innerText();
  const sequenceText = await page.getByTestId("digit-sequence").innerText();
  const seqDigits = sequenceText
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (subtitle.includes("倒背")) {
    return [...seqDigits].reverse();
  }
  return seqDigits;
}

export async function completeDigitSpanTraining(page: Page) {
  await page.goto("/student/training/digit-span");
  await expect(page.getByTestId("digit-sequence")).toBeVisible({ timeout: 30_000 });

  const subtitle = await page.locator("header p").innerText();
  const match = subtitle.match(/\/ (\d+) 次/);
  const total = match ? Number(match[1]) : 14;

  for (let attempt = 0; attempt < total; attempt += 1) {
    await expect(page.getByTestId("digit-response")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });

    const digits = await readDigitSpanAnswer(page);

    for (let i = 0; i < digits.length; i += 1) {
      await page.getByTestId(`digit-key-${digits[i]}`).click();
      await expect(page.getByTestId("digit-response")).toHaveText(
        digits.slice(0, i + 1).join(" "),
        { timeout: 5_000 },
      );
    }

    await page.getByTestId("digit-response").click();
    await page.keyboard.press("Enter");

    if (attempt < total - 1) {
      await expect(page.getByTestId("digit-response")).toHaveText("—", { timeout: 15_000 });
      await expect(page.getByTestId("digit-response")).toHaveAttribute("data-ready", "true", {
        timeout: 15_000,
      });
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 60_000 });
  await expect(page.getByTestId("metric-forward_max_span")).toBeVisible();
}

export async function enterDigitsFromExpected(page: Page) {
  const digits = await readDigitSpanAnswer(page);
  for (const digit of digits) {
    await page.getByTestId(`digit-key-${digit}`).click();
  }
}
