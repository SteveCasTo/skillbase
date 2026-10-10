import { expect, test, type Page, type Browser } from "@playwright/test";
import type {
  CourseEvaluationsDto,
  EvaluationComponentInput,
} from "@/domain/evaluations/types";
import type { EvaluationLoadResult } from "@/server/evaluations/loaders";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.setTimeout(60_000);

async function capture(page: Page, surface: string, matrix = false) {
  const directory = process.env.EVALUATIONS_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  for (const width of matrix ? [390, 768, 1440] : [1440]) {
    for (const theme of matrix ? ["light", "dark"] : ["light"]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, theme);
      await page.screenshot({
        path: join(directory, `${surface}-${theme}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
}

const schemePath = (courseId: string, instructor = false) =>
  `/app/${instructor ? "mis-cursos" : "cursos"}/${courseId}/evaluaciones`;
const gradePath = (courseId: string, groupId: string, instructor = false) =>
  `/app/${instructor ? "mis-cursos" : "cursos"}/${courseId}/grupos/${groupId}/evaluaciones`;

async function read(page: Page, path: string): Promise<CourseEvaluationsDto> {
  const response = await page.request.get(path, {
    headers: { Accept: "application/json" },
  });
  expect(response.status()).toBe(200);
  const load = (await response.json()) as EvaluationLoadResult;
  if (!load.available) throw new Error(load.unavailableReason);
  return load.data;
}

async function configure(page: Page, courseId: string) {
  const components: EvaluationComponentInput[] = [
    {
      id: crypto.randomUUID(),
      name: "Teoría",
      type: "THEORY",
      weight: "33.33",
    },
    {
      id: crypto.randomUUID(),
      name: "Práctica",
      type: "PRACTICAL",
      weight: "66.67",
    },
  ];
  const path = schemePath(courseId);
  const data = await read(page, path);
  const saved = await page.request.post(path, {
    headers: { Accept: "application/json", Origin: e2eSiteUrl() },
    data: {
      requestKey: crypto.randomUUID(),
      courseId,
      schemeRevision: data.scheme.revision,
      components,
    },
  });
  expect(saved.status()).toBe(200);
  return components;
}

async function saveGrade(page: Page, component: string, score: string) {
  const person = "Enrolled Attendance";
  await page
    .getByRole("button", {
      name: `Editar notas de ${person}`,
      exact: true,
    })
    .click();
  const input = page.getByRole("textbox", {
    name: new RegExp(`${component}.*${person}`, "u"),
  });
  await input.fill(score);
  await page
    .getByRole("button", {
      name: `Guardar notas de ${person}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Editar notas de ${person}`,
      exact: true,
    }),
  ).toBeVisible();
}

test("ADMIN saves exact course-wide weights and can edit the scheme before grading", async ({
  page,
  context,
  browser,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04");
  try {
    await context.clock.setFixedTime(fixture.now);
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const path = schemePath(fixture.courseId);
    await page.goto(path);
    await expect(
      page.getByRole("button", { name: "Descartar cambios", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Añadir componente", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Nombre", exact: true })
      .fill("Teoría");
    await page
      .getByRole("textbox", { name: "Peso (%)", exact: true })
      .fill("33,33");
    await page
      .getByRole("button", { name: "Confirmar Teoría", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Añadir componente", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Nombre", exact: true })
      .fill("Práctica");
    await page.getByRole("combobox", { name: "Tipo", exact: true }).click();
    await page.getByRole("option", { name: "Práctica", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Peso (%)", exact: true })
      .fill("66,66");
    const save = page.getByRole("button", {
      name: "Guardar esquema",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Peso (%)", exact: true })
      .fill("66,67");
    await page
      .getByRole("button", { name: "Confirmar Práctica", exact: true })
      .click();
    await expect(save).toBeEnabled();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Editar Práctica", exact: true }),
    ).toBeVisible();
    expect(
      (await read(page, path)).scheme.components.map(
        (component) => component.weight,
      ),
    ).toEqual(["33.33", "66.67"]);
    await page
      .getByRole("button", { name: "Editar Teoría", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Nombre", exact: true })
      .fill("Teoría revisada");
    await page
      .getByRole("button", { name: "Confirmar Teoría revisada", exact: true })
      .click();
    const updated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await save.click();
    expect((await updated).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Teoría revisada", exact: true }),
    ).toBeVisible();
    expect((await read(page, path)).scheme.components[0]?.name).toBe(
      "Teoría revisada",
    );
    await capture(page, "scheme");
    await verifySsr(browser, fixture);
  } finally {
    await fixture.close();
  }
});

test("INSTRUCTOR saves rows atomically with pending distinct from zero, and corrections update weighted results and ADMIN history", async ({
  page,
  context,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-06-01", true);
  try {
    await context.clock.setFixedTime(fixture.now);
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await configure(page, fixture.courseId);
    await context.clearCookies();
    await signInFixture(context, AUTH_FIXTURES.instructor.email);
    const path = gradePath(fixture.courseId, fixture.groupId, true);
    await page.goto(path);
    await saveGrade(page, "Teoría", "0");
    const pending = (await read(page, path)).participants.find(
      (person) => person.registrationId === fixture.paid.id,
    )!;
    expect(pending.grades[0]?.score).toBe("0.00");
    expect(pending.result).toMatchObject({
      status: "PENDING",
      finalGrade: null,
      decisionGrade: "0.00",
    });
    expect(pending.grades[1]?.score).toBeNull();
    await page
      .getByRole("button", {
        name: "Editar notas de Enrolled Attendance",
        exact: true,
      })
      .click();
    const theory = page.getByRole("textbox", {
      name: /Teoría.*Enrolled Attendance/u,
    });
    const practical = page.getByRole("textbox", {
      name: /Práctica.*Enrolled Attendance/u,
    });
    const save = page.getByRole("button", {
      name: "Guardar notas de Enrolled Attendance",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await practical.fill("100");
    await theory.fill("");
    await expect(save).toBeDisabled();
    await theory.fill("80");
    const writes: unknown[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === path
      )
        writes.push(request.postDataJSON());
    });
    await save.click();
    await expect(
      page.getByRole("button", {
        name: "Editar notas de Enrolled Attendance",
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      registrationId: fixture.paid.id,
      grades: [
        {
          componentId: pending.grades[0]!.componentId,
          gradeRevision: pending.grades[0]!.revision,
          score: "80",
        },
        {
          componentId: pending.grades[1]!.componentId,
          gradeRevision: 0,
          score: "100",
        },
      ],
    });
    await expect(
      page.getByText("Nota final: 93,33", { exact: true }),
    ).toBeVisible();
    expect(
      (await read(page, path)).participants.find(
        (person) => person.registrationId === fixture.paid.id,
      )?.result,
    ).toMatchObject({ status: "COMPLETE", finalGrade: "93.33", passed: true });
    for (const contact of [
      fixture.paid.participant.ci,
      fixture.paid.participant.email,
      fixture.partial.participant.ci,
      fixture.partial.participant.email,
    ])
      expect(await page.content()).not.toContain(contact);
    const forbidden = await page.request.get(
      schemePath(fixture.foreign!.courseId, true),
      { headers: { Accept: "application/json" } },
    );
    expect(forbidden.status()).toBe(404);
    const foreignLoad: EvaluationLoadResult = await forbidden.json();
    expect(foreignLoad).toMatchObject({ available: false, code: "NOT_FOUND" });
    expect(foreignLoad).not.toHaveProperty("data");
    const beforeStart = await page.request.get(
      schemePath(fixture.adjustable.courseId, true),
      { headers: { Accept: "application/json" } },
    );
    expect(beforeStart.status()).toBe(403);
    await page.goto(schemePath(fixture.courseId, true));
    await expect(
      page.getByRole("button", { name: "Añadir componente", exact: true }),
    ).not.toBeVisible();
    expect(
      (await read(page, schemePath(fixture.courseId, true))).scheme.canEdit,
    ).toBe(false);
    await context.clearCookies();
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gradePath(fixture.courseId, fixture.groupId));
    await expect(
      page.getByRole("heading", {
        name: "Historial de correcciones",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await read(page, gradePath(fixture.courseId, fixture.groupId))
      ).history?.some(
        (entry) => entry.fromScore === "0.00" && entry.toScore === "80.00",
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", {
        name: "Editar notas de Enrolled Attendance",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "grades", true);
  } finally {
    await fixture.close();
  }
});

async function verifySsr(
  browser: Browser,
  fixture: Awaited<ReturnType<typeof createAttendanceFlowFixture>>,
) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const page = await context.newPage();
    const path = schemePath(fixture.historyCourseId);
    await page.goto(path);
    await page
      .getByRole("textbox", { name: "Nombre", exact: true })
      .fill("Evaluación");
    await page
      .getByRole("textbox", { name: "Peso (%)", exact: true })
      .fill("99,99");
    await page
      .getByRole("button", { name: "Guardar esquema", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Peso (%)", exact: true }),
    ).toHaveValue("99,99");
    expect((await read(page, path)).scheme.components).toEqual([]);
    await page
      .getByRole("textbox", { name: "Peso (%)", exact: true })
      .fill("100");
    await page
      .getByRole("button", { name: "Guardar esquema", exact: true })
      .click();
    expect((await read(page, path)).scheme.components[0]?.weight).toBe(
      "100.00",
    );
    const group = gradePath(fixture.historyCourseId, fixture.historyGroupId);
    await page.goto(group);
    await page
      .getByRole("textbox", {
        name: "Evaluación · Enrolled Attendance",
        exact: true,
      })
      .fill("0");
    await page
      .getByRole("button", { name: "Guardar nota", exact: true })
      .click();
    await expect(
      page.getByText("Nota final: 0,00", { exact: true }),
    ).toBeVisible();
    expect(
      (await read(page, group)).participants.find(
        (person) => person.registrationId === fixture.historyPaid.id,
      )?.result,
    ).toMatchObject({ status: "COMPLETE", finalGrade: "0.00", passed: false });
  } finally {
    await context.close();
  }
}
