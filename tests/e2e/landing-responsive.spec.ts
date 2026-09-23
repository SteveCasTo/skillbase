import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 1000 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

async function waitForLandingAssets(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const heroImage = page.locator(".hero-plate img");
  await expect
    .poll(async () =>
      heroImage.evaluate((image) => {
        const hero = image as HTMLImageElement;
        return hero.complete && hero.naturalWidth > 0;
      }),
    )
    .toBe(true);
}

async function waitForThemeSelector(page: Page) {
  await page.waitForFunction(
    () =>
      !document
        .querySelector("astro-island:has([data-theme-toggle])")
        ?.hasAttribute("ssr"),
  );
}

async function box(locator: Locator): Promise<Box> {
  const boundingBox = await locator.boundingBox();
  expect(boundingBox).not.toBeNull();
  return boundingBox as Box;
}

async function expectWithinViewportWidth(page: Page, locator: Locator) {
  const bounds = await box(locator);
  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeDefined();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual((viewportWidth ?? 0) + 1);
}

function overlaps(first: Box, second: Box) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
}

async function expectModernHeroArtDirection(page: Page) {
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const evidence = await page
    .locator("picture.hero-plate")
    .evaluate((picture) => {
      const image = picture.querySelector("img");
      const normalize = (value: string) =>
        new URL(value, window.location.href).href;
      const urlsFrom = (source: HTMLSourceElement) =>
        (source.srcset ?? "")
          .split(",")
          .map((candidate) => candidate.trim().split(/\s+/)[0])
          .filter((candidate): candidate is string => Boolean(candidate))
          .map(normalize);
      const sources = [...picture.querySelectorAll("source")];

      return {
        currentSrc: image?.currentSrc ?? "",
        mobileSources: sources
          .filter((source) => source.media === "(max-width: 639px)")
          .flatMap(urlsFrom),
        desktopSources: sources
          .filter((source) => source.media === "(min-width: 640px)")
          .flatMap(urlsFrom),
        sourceTypes: sources.map((source) => source.type),
      };
    });

  expect(evidence.sourceTypes).toEqual([
    "image/avif",
    "image/webp",
    "image/avif",
    "image/webp",
  ]);
  expect(evidence.currentSrc).toMatch(/\/_image(?:\?|\/)/);
  expect(evidence.currentSrc).toMatch(/[?&]f=(?:avif|webp)(?:&|$)/);

  const expectedSources =
    viewportWidth < 640 ? evidence.mobileSources : evidence.desktopSources;
  expect(expectedSources).toContain(evidence.currentSrc);
}

async function expectLandingContentBounds(page: Page) {
  const participation = page.locator("#participar");
  await expectWithinViewportWidth(
    page,
    participation.getByRole("heading", {
      level: 2,
      name: "Cómo participar",
    }),
  );
  const steps = participation.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  for (const step of await steps.all()) {
    await expectWithinViewportWidth(page, step);
  }

  const certificates = page.locator("#certificados");
  await expectWithinViewportWidth(
    page,
    certificates.getByRole("heading", {
      level: 2,
      name: "Una credencial debe poder comprobarse.",
    }),
  );
  await expectWithinViewportWidth(
    page,
    certificates.locator(".certificate-copy p"),
  );
  const certificateAction = certificates.getByRole("link", {
    name: "Verificar certificado",
  });
  await expectWithinViewportWidth(page, certificateAction);
  expect((await box(certificateAction)).height).toBeGreaterThanOrEqual(44);
}

async function openPreview(
  page: Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.goto("/?preview=courses");
  await waitForLandingAssets(page);
}

test.describe("public landing responsive layout", () => {
  for (const viewport of viewports) {
    test(`${viewport.width}x${viewport.height} stays within the viewport`, async ({
      page,
    }) => {
      await openPreview(page, viewport);
      await expectNoDocumentOverflow(page);
      await expectLandingContentBounds(page);
      await expectModernHeroArtDirection(page);

      if (viewport.width < 640) {
        const identity = page.getByRole("link", {
          name: "Formación continua, inicio",
        });
        const themeToggle = page.getByRole("button", {
          name: /Cambiar a modo (oscuro|claro)/,
        });
        const identityBox = await box(identity);
        const themeToggleBox = await box(themeToggle);

        expect(overlaps(identityBox, themeToggleBox)).toBe(false);
        expect(themeToggleBox.width).toBeGreaterThanOrEqual(44);
        expect(themeToggleBox.height).toBeGreaterThanOrEqual(44);

        const institutionBox = await box(page.locator(".footer-institution"));
        const legalBox = await box(page.locator(".footer-legal"));
        expect(overlaps(institutionBox, legalBox)).toBe(false);
      }
    });
  }
});

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await openPreview(page, { width: 390, height: 844 });
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", {
    name: "Saltar al contenido principal",
  });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
  await expect(page).toHaveURL(/#main-content$/);
});

test("course billboards are single whole-card links with complete metadata", async ({
  page,
}) => {
  await openPreview(page, { width: 1440, height: 1000 });

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
  const featured = page.locator(".featured-course");
  await expect(featured.locator(".course-artwork")).toHaveAttribute(
    "data-artwork",
    "photo",
  );
  await expect(featured.getByRole("link")).toHaveCount(1);
  await expect(
    featured.getByRole("link", { name: "Ver curso: Fundamentos de Python" }),
  ).toHaveAttribute("href", "/cursos/fundamentos-de-python");
  await expect(featured.getByText("Preinscripción abierta")).toBeVisible();
  await expect(featured.getByText("Básico · 24 horas")).toBeVisible();
  await expect(featured.getByText(/Bs \d+/)).toHaveCount(0);
  await expect(featured.getByText(/Martes y jueves/)).toHaveCount(0);

  const posters = page.locator(".course-poster");
  await expect(posters).toHaveCount(2);
  for (const poster of await posters.all()) {
    await expect(poster.getByRole("link")).toHaveCount(1);
  }
});

test("editorial rows stay complete and preserve course order across breakpoints", async ({
  page,
}) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/?preview=courses&count=8");
    await waitForLandingAssets(page);

    await expectNoDocumentOverflow(page);
    const rows = page.locator(".poster-row");
    await expect(rows).toHaveCount(3);
    expect(
      await rows.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-row-size")),
      ),
    ).toEqual(["3", "2", "2"]);
    await expect(page.locator('.poster-row[data-row-size="3"]')).toHaveCount(1);
    await expect(page.locator('.poster-row[data-row-size="2"]')).toHaveCount(2);

    const names = await page.locator(".course-poster h3").allTextContents();
    expect(names).toEqual([
      "Redes para entornos Linux",
      "Bases de datos con PostgreSQL",
      "Fundamentos de Python · edición 4",
      "Redes para entornos Linux · edición 5",
      "Bases de datos con PostgreSQL · edición 6",
      "Fundamentos de Python · edición 7",
      "Redes para entornos Linux · edición 8",
    ]);

    if (viewport.width < 640) {
      const posters = page.locator(".course-poster");
      for (const poster of await posters.all()) {
        const artworkBox = await box(poster.locator(".course-artwork"));
        const copyBox = await box(poster.locator(".course-poster-copy"));
        expect(copyBox.y).toBeGreaterThanOrEqual(
          artworkBox.y + artworkBox.height - 1,
        );
      }
    }
  }
});

test("twenty-course billboard keeps usable poster widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=courses&count=20");
  await waitForLandingAssets(page);

  const posters = page.locator(".course-poster");

  await page.locator(".poster-rows").evaluate((list) => {
    document.documentElement.classList.add("motion-enhanced");
    list.classList.remove("is-visible");
  });
  await expect(page.locator(".poster-rows")).toHaveCSS("opacity", "1");

  await expect(posters).toHaveCount(19);
  const revealDelays = await posters.evaluateAll((items) =>
    items.map((item) =>
      Number.parseFloat(
        getComputedStyle(item).getPropertyValue("--poster-reveal-delay"),
      ),
    ),
  );
  expect(revealDelays[0]).toBe(0);
  expect(revealDelays[1]).toBeGreaterThanOrEqual(90);
  expect(revealDelays.at(-1)).toBeLessThanOrEqual(1800);
  for (let index = 1; index < revealDelays.length; index += 1) {
    expect(revealDelays[index]).toBeGreaterThan(revealDelays[index - 1] ?? -1);
  }
  await page.locator(".poster-rows").evaluate((list) => {
    list.classList.add("is-visible");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(posters.first()).toHaveCSS("animation-name", "none");

  const mobileWidths = await posters.evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().width)),
  );
  expect(new Set(mobileWidths)).toEqual(new Set([358]));
  await expectNoDocumentOverflow(page);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await waitForLandingAssets(page);
  const tabletWidths = await posters.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().width),
  );
  expect(Math.min(...tabletWidths)).toBeGreaterThan(300);
  await expectNoDocumentOverflow(page);
});

for (const width of [320, 860, 861, 1440]) {
  test(`team access and identity targets follow the ${width}px breakpoint`, async ({
    page,
  }) => {
    await openPreview(page, { width, height: 900 });
    const identityBounds = await box(
      page.getByRole("link", { name: "Formación continua, inicio" }),
    );
    expect(identityBounds.height).toBeGreaterThanOrEqual(44);

    const headerAccess = page.locator(".site-header").getByRole("link", {
      name: "Acceso del equipo",
    });
    const footerAccess = page.locator(".site-footer").getByRole("link", {
      name: "Acceso del equipo",
    });
    await expect(footerAccess).toBeVisible();
    if (width <= 860) await expect(headerAccess).toBeHidden();
    else await expect(headerAccess).toBeVisible();
  });
}

test("dark preview remains readable without document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=courses");
  await waitForLandingAssets(page);
  await waitForThemeSelector(page);
  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expectNoDocumentOverflow(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "El siguiente paso es tuyo." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Una credencial debe poder comprobarse.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verificar certificado" }),
  ).toBeVisible();
});

test("warm preview remains readable without document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=courses&palette=warm");
  await waitForLandingAssets(page);

  await expect(page.locator(".landing.warm-preview")).toBeVisible();
  await expectNoDocumentOverflow(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "El siguiente paso es tuyo." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "La verificación pública permite confirmar la validez de un certificado sin exponer información personal innecesaria.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verificar certificado" }),
  ).toBeVisible();
});
