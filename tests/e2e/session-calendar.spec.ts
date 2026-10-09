import { expect, test } from "@playwright/test";
import { createSessionCalendarFixture } from "../fixtures/session-calendar";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("long session calendar uses one natural page scroller and deselectable state filters", async ({
  page,
  context,
}) => {
  const fixture = await createSessionCalendarFixture();
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const path = `/app/cursos/${fixture.courseId}/grupos/${fixture.groupId}/sesiones`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    const filters = page.getByRole("group", {
      name: "Estado de la sesión",
      exact: true,
    });
    const upcoming = filters.getByRole("button", {
      name: "Próximas",
      exact: true,
    });
    const rows = page.locator("[data-session-day]:not([hidden])");
    await expect(upcoming).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(11);
    await upcoming.click();
    await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(rows).toHaveCount(12);
    for (const [name, count] of [
      ["Finalizadas", 0],
      ["Canceladas", 1],
      ["Próximas", 11],
    ] as const) {
      const toggle = filters.getByRole("button", { name, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(rows).toHaveCount(count);
      await toggle.press("Space");
      await expect(toggle).toBeFocused();
      await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(0);
      await expect(rows).toHaveCount(12);
    }

    const sessionLinks = page
      .getByRole("region", { name: "Sesiones del grupo", exact: true })
      .getByRole("link");
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // Each responsive check starts as a real page visit, not during a pending
      // browser scroll animation from a differently-sized scroll root.
      await page.goto(path);
      await upcoming.click();
      await expect(rows).toHaveCount(12);
      await sessionLinks.first().focus();
      await expect(sessionLinks.first()).toBeInViewport();
      const scrollers = await sessionLinks.last().evaluate((link) => {
        const result: string[] = [];
        for (
          let ancestor = link.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          if (
            /auto|scroll/.test(style.overflowY) &&
            ancestor.scrollHeight > ancestor.clientHeight
          )
            result.push(ancestor.className);
        }
        if (
          document.scrollingElement &&
          document.scrollingElement.scrollHeight > innerHeight
        )
          result.push("document");
        return result;
      });
      expect(scrollers).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await sessionLinks.last().focus();
      await expect(sessionLinks.last()).toBeInViewport();
      await page.keyboard.press("Control+Home");
      await expect(sessionLinks.first()).toBeInViewport();
      const scrollPosition = () =>
        page.evaluate(() => {
          const scroller =
            innerWidth >= 1024
              ? document.querySelector(".private-main-scroll")
              : document.scrollingElement;
          return scroller?.scrollTop ?? 0;
        });
      await expect.poll(scrollPosition).toBe(0);
      // Ctrl+Home scrolls without relocating keyboard focus from the last
      // (now offscreen) link. Exercise PageDown from a visible focused link.
      await sessionLinks.first().focus();
      await expect(sessionLinks.first()).toBeFocused();
      const beforePageDown = await scrollPosition();
      await page.keyboard.press("PageDown");
      await expect.poll(scrollPosition).toBeGreaterThan(beforePageDown);
      await page.keyboard.press("Control+End");
      await expect(sessionLinks.last()).toBeInViewport();
    }
    // The wheel continues the same page even when the pointer is over the calendar.
    await page.keyboard.press("Control+Home");
    await expect
      .poll(() =>
        page
          .locator(".private-main-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBe(0);
    const calendar = page.locator("[data-session-calendar]");
    await calendar.hover();
    const beforeLeft = await page
      .locator(".private-main-scroll")
      .evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() =>
        page
          .locator(".private-main-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(beforeLeft);
    await sessionLinks.nth(6).hover();
    const before = await page
      .locator(".private-main-scroll")
      .evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() =>
        page
          .locator(".private-main-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(before);
    await sessionLinks.last().focus();
    await sessionLinks.last().press("Enter");
    await expect(page).toHaveURL(
      `${path}/${fixture.calendar.sessions.at(-1)!.id}`,
    );
  } finally {
    await fixture.close();
  }
});
