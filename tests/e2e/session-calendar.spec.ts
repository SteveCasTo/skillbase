import { expect, test, type Locator } from "@playwright/test";
import { createSessionCalendarFixture } from "../fixtures/session-calendar";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

// Capture the first failed attempt for this spec only, not the entire E2E suite.
test.use({ trace: "retain-on-failure" });

async function readScrollState(link: Locator) {
  return link.evaluate((element) => {
    const main = document.querySelector(".private-main-scroll");
    const documentRoot = document.scrollingElement;
    if (!main || !documentRoot)
      throw new Error("Private page scroll root missing");
    const root = /auto|scroll/.test(getComputedStyle(main).overflowY)
      ? main
      : documentRoot;
    const range = root.scrollHeight - root.clientHeight;
    if (root.clientHeight <= 0 || range <= 0)
      throw new Error("Session page must have a positive native scroll range");
    const rectangle = element.getBoundingClientRect();
    const active = document.activeElement;
    return {
      root: root === documentRoot ? "document" : "private-main",
      width: innerWidth,
      height: innerHeight,
      top: root.scrollTop,
      range,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      contentTop: rectangle.top,
      contentBottom: rectangle.bottom,
      focused: active === element,
      activeTag: active?.tagName,
      activeHref: active?.getAttribute("href"),
      visibleSessions: document.querySelectorAll(
        "[data-session-day]:not([hidden])",
      ).length,
    };
  });
}

async function waitForStableScroll(link: Locator, requireFocus = false) {
  let previous: Awaited<ReturnType<typeof readScrollState>> | undefined;
  await expect
    .poll(async () => {
      const current = await readScrollState(link);
      const stable =
        previous?.root === current.root &&
        previous.top === current.top &&
        previous.range === current.range &&
        previous.contentTop === current.contentTop &&
        previous.contentBottom === current.contentBottom;
      previous = current;
      return (
        stable &&
        (!requireFocus ||
          (current.focused &&
            current.contentTop >= 0 &&
            current.contentBottom <= current.height &&
            current.top < current.range))
      );
    })
    .toBe(true);
  return readScrollState(link);
}

test("long session calendar uses one natural page scroller and deselectable state filters", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await createSessionCalendarFixture();
  const observations: {
    stage: string;
    state: Awaited<ReturnType<typeof readScrollState>> | { error: string };
  }[] = [];
  let diagnosticLink: Locator | undefined;
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
    const linkToSession = (id: string) =>
      sessionLinks.and(page.locator(`[href="${path}/${id}"]`));
    const cancelledLink = linkToSession(
      fixture.calendar.sessions.find(
        (session) => session.status === "CANCELLED",
      )!.id,
    );
    const finalLink = linkToSession(fixture.calendar.sessions.at(-1)!.id);
    diagnosticLink = cancelledLink;
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      // Each responsive check starts as a real page visit, not during a pending
      // browser scroll animation from a differently-sized scroll root.
      await page.goto(path);
      await upcoming.click();
      await expect(rows).toHaveCount(12);
      await cancelledLink.focus();
      await expect(cancelledLink).toBeInViewport();
      const scrollers = await finalLink.evaluate((link) => {
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
      await finalLink.focus();
      await expect(finalLink).toBeInViewport();
      await page.keyboard.press("Control+Home");
      await expect
        .poll(async () => (await readScrollState(cancelledLink)).top)
        .toBe(0);
      await expect(cancelledLink).toBeInViewport();
      observations.push({
        stage: `${width}:after-native-home`,
        state: await waitForStableScroll(cancelledLink),
      });

      // Independent PageDown preparation: instant positioning is NOT its result
      // and is NOT evidence for Ctrl+Home (which was asserted above).
      await cancelledLink.evaluate((link) => {
        link.scrollIntoView({ block: "center", behavior: "instant" });
        link.focus({ preventScroll: true });
      });
      await expect(cancelledLink).toBeFocused();
      const beforePageDown = await waitForStableScroll(cancelledLink, true);
      observations.push({
        stage: `${width}:before-native-page-down`,
        state: beforePageDown,
      });
      await page.keyboard.press("PageDown");
      await expect
        .poll(async () => {
          const after = await readScrollState(cancelledLink);
          return (
            after.root === beforePageDown.root &&
            after.top > beforePageDown.top &&
            after.contentTop < beforePageDown.contentTop
          );
        })
        .toBe(true);
      observations.push({
        stage: `${width}:after-native-page-down`,
        state: await readScrollState(cancelledLink),
      });
      await page.keyboard.press("Control+End");
      await expect(finalLink).toBeInViewport();
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
    await waitForStableScroll(cancelledLink);
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
    await finalLink.focus();
    await finalLink.press("Enter");
    await expect(page).toHaveURL(
      `${path}/${fixture.calendar.sessions.at(-1)!.id}`,
    );
  } catch (error) {
    if (diagnosticLink)
      observations.push({
        stage: "failure",
        state: await readScrollState(diagnosticLink).catch(
          (reason: unknown) => ({ error: String(reason) }),
        ),
      });
    throw error;
  } finally {
    await testInfo.attach("native-scroll-observations", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
    await fixture.close();
  }
});
