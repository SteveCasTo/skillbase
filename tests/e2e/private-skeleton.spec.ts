import { expect, test } from "@playwright/test";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";

test("real delayed navigation shows a reduced-motion skeleton and keeps the document", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app");
  await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
  await page.evaluate(() => {
    Object.assign(window, { skeletonDocument: document });
    const spacer = document.createElement("div");
    spacer.style.height = "2400px";
    document.querySelector("[data-private-page]")!.append(spacer);
    document.querySelector(".private-main-scroll")!.scrollTop = 700;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/app/formatos", async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("navigation", { name: "Navegación privada" })
      .getByRole("link", { name: "Formatos" })
      .click();
    await expect(page.getByRole("main")).toHaveAttribute("aria-busy", "true");
    const skeleton = page.locator("[data-navigation-skeleton]");
    await expect(skeleton).toBeVisible();
    const firstBlock = await skeleton
      .locator('[data-slot="skeleton"]')
      .first()
      .boundingBox();
    expect(firstBlock).not.toBeNull();
    expect(firstBlock!.y).toBeGreaterThanOrEqual(0);
    expect(firstBlock!.y + firstBlock!.height).toBeLessThan(
      page.viewportSize()!.height,
    );
    expect(
      await page
        .locator(".private-main-scroll")
        .evaluate((element) => element.scrollTop),
    ).toBe(700);
    await expect(skeleton.locator("[data-loading-layout]")).toHaveAttribute(
      "data-loading-layout",
      "list",
    );
    expect(
      await skeleton
        .locator('[data-slot="skeleton"]')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    // Existing islands/content remain attached rather than being replaced by a fake SSR page.
    await expect(page.locator("[data-private-page]")).toBeAttached();
  } finally {
    release();
  }
  await expect(page).toHaveURL(/\/app\/formatos$/);
  await expect(
    page.getByRole("heading", { name: "Formatos de curso", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
  await expect(page.getByRole("main")).not.toHaveAttribute("aria-busy", "true");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { skeletonDocument?: Document })
          .skeletonDocument === document,
    ),
  ).toBe(true);
});

test("rejected and cancelled preparation restores the same main content", async ({
  context,
  page,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  await page.goto("/app");
  const restored = await page.evaluate(async () => {
    const main = document.querySelector("main")!;
    const content = main.querySelector<HTMLElement>("[data-private-page]")!;
    const button = document.createElement("button");
    button.textContent = "Recovery focus target";
    const spacer = document.createElement("div");
    spacer.style.height = "2400px";
    content.append(button, spacer);
    const scroller = document.querySelector(".private-main-scroll")!;
    scroller.scrollTop = 700;
    const original = content.innerHTML;
    for (const cancel of [false, true]) {
      button.focus({ preventScroll: true });
      const controller = new AbortController();
      const event = Object.assign(new Event("astro:before-preparation"), {
        to: new URL("/app/formatos", location.href),
        signal: controller.signal,
        formData: undefined,
        loader: async () => {
          if (cancel) controller.abort();
          else throw new Error("Controlled load failure");
        },
      });
      document.dispatchEvent(event);
      if (main.getAttribute("aria-busy") !== "true") return false;
      await event.loader().catch(() => {});
      if (
        main.hasAttribute("aria-busy") ||
        content.inert ||
        content.style.visibility ||
        content.innerHTML !== original ||
        document.activeElement !== button ||
        scroller.scrollTop !== 700
      )
        return false;
    }
    return true;
  });
  expect(restored).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("without JavaScript private SSR content is visible and never marked loading", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ...(baseURL ? { baseURL } : {}),
  });
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const page = await context.newPage();
    await page.goto("/app/formatos");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("[data-navigation-skeleton]")).toBeHidden();
    await expect(page.getByRole("main")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );
  } finally {
    await context.close();
  }
});
