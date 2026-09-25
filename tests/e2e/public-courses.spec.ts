import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { getTestSupabaseEnvironment } from "../../scripts/supabase-local-env";
import { signInFixture } from "./auth-helper";

test("published course is public end-to-end and withdrawal removes every public view", async ({
  page,
  context,
}) => {
  await signInFixture(context, AUTH_FIXTURES.admin.email);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const formatName = `Formato público E2E ${suffix}`;
  const courseName = `Curso público E2E ${suffix}`;
  let courseId: string | undefined;
  let artworkKey: string | undefined;
  let detailUrl: string | undefined;

  try {
    await page.goto("/app/formatos");
    await page.getByRole("link", { name: "Nuevo formato" }).click();
    const createFormat = page.getByRole("form", { name: "Crear formato" });
    await createFormat.getByLabel("Nombre").fill(formatName);
    await createFormat.getByLabel("Duración total (horas)").fill("20");
    await createFormat.getByLabel("Precio estudiante (BOB)").fill("80");
    await createFormat.getByLabel("Precio externo (BOB)").fill("100.50");
    await createFormat.getByRole("button", { name: "Crear formato" }).click();
    await expect(page).toHaveURL(/\/app\/formatos$/);
    await expect(page.locator("[data-sileo-toast]")).toContainText(
      "Formato creado",
    );

    await page.goto("/app/cursos/nuevo");
    await page.getByLabel("Nombre").fill(courseName);
    await page.getByLabel("Descripción").fill("Descripción visible del curso.");
    await page.getByRole("combobox", { name: "Nivel" }).click();
    await page.getByRole("option", { name: "Medio" }).click();
    await page.getByRole("combobox", { name: "Formato de curso" }).click();
    await page.getByRole("option", { name: new RegExp(formatName) }).click();
    await page.getByLabel("Instructor (opcional)").fill("Docente público E2E");
    await page
      .getByLabel("Contenido del curso (Markdown, opcional)")
      .fill(
        "## Temario público\n- **Unidad segura**\n\n[Enlace inseguro](javascript:alert(1))\n<script>alert(2)</script>",
      );
    await page.getByRole("checkbox", { name: "Lunes" }).click();
    await page.getByLabel("Desde", { exact: true }).fill("18:30");
    await page.getByLabel("Hasta", { exact: true }).fill("20:30");
    await page.getByLabel("Condiciones").fill("Inscripción sujeta a cupo.");
    for (const [label, date, time] of [
      ["Inicio del curso", "01/03/2027", "18:30"],
      ["Finalización del curso", "01/04/2027", "20:30"],
      ["Apertura de preinscripción", "01/01/2027", "08:00"],
      ["Cierre de preinscripción", "20/02/2027", "18:00"],
    ] as const) {
      await page.getByLabel(label, { exact: true }).fill(date);
      await page
        .getByRole("textbox", {
          name: `Hora de ${label.toLowerCase()}`,
          exact: true,
        })
        .fill(time);
    }
    await page.getByLabel("Nota mínima (0–100)").fill("70");
    await page.getByRole("button", { name: "Crear borrador" }).click();
    await expect(page).toHaveURL(
      /\/app\/cursos\/[^/]+\/editar\?success=created$/,
    );
    courseId = new URL(page.url()).pathname.split("/").at(-2);
    expect(courseId).toMatch(/^[0-9a-f-]{36}$/i);

    // Generate a valid 400×250 WebP in Chromium; the editor then crops and uploads it.
    const webpBytes = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(400, 250);
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new Error("Canvas 2D unavailable");
      const pixels = drawing.createImageData(400, 250);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = (index / 4) % 251;
        pixels.data[index + 1] = 107;
        pixels.data[index + 2] = 135;
        pixels.data[index + 3] = 255;
      }
      drawing.putImageData(pixels, 0, 0);
      const blob = await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.8,
      });
      if (blob.type !== "image/webp")
        throw new Error("WebP encoding unavailable");
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.getByLabel("Seleccionar foto del curso").setInputFiles({
      name: "fixture.webp",
      mimeType: "image/webp",
      buffer: Buffer.from(webpBytes),
    });
    await expect(
      page.getByRole("img", { name: "Vista previa del encuadre del curso" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Subir foto recortada" }).click();
    await expect(page.getByRole("status")).toContainText(
      "aún no está guardada",
    );
    artworkKey = await page.locator('input[name="artwork"]').inputValue();
    expect(artworkKey).toMatch(
      new RegExp(`^courses/${courseId}/[0-9a-f-]+\\.webp$`, "i"),
    );
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(/success=updated/);

    await page.getByText("Publicar curso", { exact: true }).click();
    await page.getByRole("button", { name: "Confirmar publicación" }).click();
    await expect(page).toHaveURL(/success=published/);
    await page
      .getByRole("button", { name: "Destacar en la cartelera" })
      .click();
    await expect(page.getByText("Destacado en la cartelera")).toBeVisible();

    await context.clearCookies();
    await page.goto("/");
    const landingCourse = page.getByRole("link", {
      name: new RegExp(courseName),
    });
    await expect(landingCourse).toBeVisible();
    await expect(landingCourse.locator("img")).toHaveAttribute(
      "src",
      new RegExp(`/${courseId}/`),
    );

    await page.goto("/cursos");
    const catalogCourse = page.getByRole("link", {
      name: `Ver curso: ${courseName}`,
    });
    await expect(catalogCourse).toBeVisible();
    const catalogImage = catalogCourse.locator("img");
    await expect(catalogImage).toHaveAttribute(
      "src",
      new RegExp(`/${courseId}/`),
    );
    const imageResponse = await page.request.get(
      (await catalogImage.getAttribute("src")) ?? "",
    );
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["content-type"]).toContain("image/webp");
    detailUrl = (await catalogCourse.getAttribute("href")) ?? undefined;
    await catalogCourse.click();

    await expect(
      page.getByRole("heading", { level: 1, name: courseName }),
    ).toBeVisible();
    await expect(
      page.locator("dt").filter({ hasText: "Inicio" }).locator("+ dd"),
    ).toContainText(/1.*marzo.*2027/i);
    await expect(
      page.locator("dt").filter({ hasText: "Finalización" }).locator("+ dd"),
    ).toContainText(/1.*abril.*2027/i);
    await expect(
      page.getByText("Docente público E2E", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Temario público" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unidad segura", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".course-markdown strong")).toHaveText(
      "Unidad segura",
    );
    await expect(
      page.locator("script").filter({ hasText: "alert(2)" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Enlace inseguro" }),
    ).toHaveCount(0);
    await expect(page.locator(".detail-art img")).toHaveAttribute(
      "src",
      new RegExp(`/${courseId}/`),
    );

    // The upload really reached public Storage; remove it even when later assertions fail.
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.goto(`/app/cursos/${courseId}/editar`);
    await page.getByText("Retirar publicación", { exact: true }).click();
    await page.getByRole("button", { name: "Confirmar retiro" }).click();
    await expect(page.locator("[data-sileo-toast]")).toContainText(
      "devuelto a borrador",
    );
    await context.clearCookies();

    await page.goto("/cursos");
    await expect(
      page.getByRole("link", { name: `Ver curso: ${courseName}` }),
    ).toHaveCount(0);
    expect(detailUrl).toBeTruthy();
    const withdrawnResponse = await page.goto(detailUrl!);
    expect(withdrawnResponse?.status()).toBe(404);
    const withdrawnMessage = await page.locator(".detail-state").innerText();
    const unknownResponse = await page.goto("/cursos/curso-que-no-existe-e2e");
    expect(unknownResponse?.status()).toBe(404);
    expect(await page.locator(".detail-state").innerText()).toBe(
      withdrawnMessage,
    );
    await expect(page).toHaveTitle("Curso no encontrado | Formación continua");

    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.goto(`/app/cursos/${courseId}/editar`);
    await page.getByText("Archivar curso", { exact: true }).click();
    await page.getByRole("button", { name: "Confirmar archivo" }).click();
    await expect(page.locator("[data-sileo-toast]")).toContainText(
      "Curso archivado",
    );
  } finally {
    if (artworkKey) {
      const environment = getTestSupabaseEnvironment();
      const storage = createClient(
        environment.apiUrl,
        environment.serviceRoleKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      ).storage;
      await storage.from("course-artwork").remove([artworkKey]);
    }
  }
});

test("public catalog and detail are available without a session, with useful empty state", async ({
  page,
}) => {
  const response = await page.goto("/cursos");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Cursos para seguir aprendiendo." }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle(/Cursos publicados \| Formación continua/);
  await expect(page.getByRole("link", { name: /Preinscribirme/i })).toHaveCount(
    0,
  );
  await expect(page.getByText("Personas externas")).toHaveCount(0);

  const courseLinks = page
    .getByRole("main")
    .getByRole("link", { name: /^Ver curso:/ });
  if (await courseLinks.count()) {
    const name = await courseLinks.first().getAttribute("aria-label");
    const detailUrl = await courseLinks.first().getAttribute("href");
    await courseLinks.first().click();
    expect(new URL(page.url()).pathname).toBe(detailUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      name?.replace("Ver curso: ", "") ?? "",
    );
    await expect(page.getByRole("heading", { name: "Horario" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Condiciones" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Precios" })).toBeVisible();
    await expect(page.getByText("Personas externas")).toBeVisible();
    await expect(page.getByText("Estudiantes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Preinscribirme/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Ver todos los cursos" }),
    ).toHaveCount(0);
  } else {
    await expect(
      page.getByText("Por ahora no hay cursos publicados.", { exact: false }),
    ).toBeVisible();
  }
});

test("unknown slug uses the same public 404 without exposing private data", async ({
  page,
}) => {
  const response = await page.goto("/cursos/curso-que-no-existe-e2e");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Curso no encontrado." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver todos los cursos" }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
});

test("catalog navigation, keyboard focus, and responsive layout", async ({
  page,
}) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cursos");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido principal" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  }
  await page.goto("/");
  await page.getByRole("link", { name: /Explorar todos los cursos/ }).click();
  await expect(page).toHaveURL(/\/cursos$/);
});
