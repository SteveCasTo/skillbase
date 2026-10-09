import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AttendanceSessionDetailDto } from "@/domain/attendance/types";
import { civilDay } from "@/domain/attendance/rules";
import { createAttendanceFlowFixture } from "../fixtures/attendance-flow";
import { AUTH_FIXTURES } from "../fixtures/auth-users";
import { signInFixture } from "./auth-helper";
import { e2eSiteUrl } from "../../scripts/e2e-port";

const route = (
  prefix: "cursos" | "mis-cursos",
  courseId: string,
  groupId: string,
  sessionId: string,
) => `/app/${prefix}/${courseId}/grupos/${groupId}/sesiones/${sessionId}`;
async function chooseState(
  page: Page,
  form: Locator,
  status: "Presente" | "Ausente" | "Justificada",
) {
  const path = new URL((await form.getAttribute("action")) ?? "", e2eSiteUrl())
    .pathname;
  const revision = await form.locator('input[name="revision"]').inputValue();
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === "POST",
  );
  const select = form.getByRole("combobox", { name: /^Asistencia de /u });
  await expect(select).toHaveAttribute("aria-expanded", "false");
  await select.click();
  await page.getByRole("option", { name: status, exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(form.locator('input[name="revision"]')).not.toHaveValue(
    revision,
  );
}
async function detail(page: Page, path: string) {
  const response = await page.request.get(path, {
    headers: { Accept: "application/json" },
  });
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as { ok: true; detail: AttendanceSessionDetailDto }
  ).detail;
}

test("ADMIN records and corrects attendance, persists a holiday and links a same-duration recovery", async ({
  page,
  context,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-05-04");
  try {
    await signInFixture(context, AUTH_FIXTURES.admin.email);
    const path = route(
      "cursos",
      fixture.courseId,
      fixture.groupId,
      fixture.session.id,
    );
    await page.goto(path);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === path
      )
        writes.push(request.postData() ?? "");
    });
    const person = page.getByRole("form", {
      name: "Enrolled Attendance",
      exact: true,
    });
    await chooseState(page, person, "Presente");
    await expect(person.getByRole("combobox")).toHaveCount(0);
    await expect(
      person.getByRole("button", { name: "Guardar asistencia" }),
    ).toHaveCount(0);
    expect(
      (await detail(page, path)).participants.find(
        (person) => person.registrationId === fixture.paid.id,
      )?.attendance,
    ).toMatchObject({
      status: "PRESENT",
      inferred: false,
      markedBy: fixture.adminId,
    });
    const pencil = person.getByRole("button", {
      name: "Editar asistencia de Enrolled Attendance",
      exact: true,
    });
    await pencil.click();
    await person
      .getByRole("button", {
        name: "Cancelar edición de asistencia de Enrolled Attendance",
        exact: true,
      })
      .click();
    await expect(pencil).toBeFocused();
    expect(writes).toHaveLength(1);
    expect(
      (await detail(page, path)).participants.find(
        (person) => person.registrationId === fixture.paid.id,
      )?.attendance.status,
    ).toBe("PRESENT");
    await pencil.click();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      `${e2eSiteUrl()}${path}?operation=record`,
      async (route) => {
        await gate;
        await route.continue();
      },
      { times: 1 },
    );
    const saving = chooseState(page, person, "Justificada");
    await expect(person).toHaveAttribute("aria-busy", "true");
    await expect(
      person.getByRole("combobox", {
        name: "Asistencia de Enrolled Attendance",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      person.getByRole("button", {
        name: "Cancelar edición de asistencia de Enrolled Attendance",
        exact: true,
      }),
    ).toBeDisabled();
    release();
    await saving;
    const corrected = (await detail(page, path)).participants.find(
      (person) => person.registrationId === fixture.paid.id,
    )!;
    expect(corrected.attendance.status).toBe("EXCUSED");
    expect(corrected.consecutiveAbsences).toBe(0);
    // A real concurrent write invalidates the editor's revision. The failed
    // autosave retains its draft, and an explicit refresh recovers the row.
    const concurrent = await page.request.post(`${path}?operation=record`, {
      headers: { Accept: "application/json", Origin: e2eSiteUrl() },
      data: {
        requestKey: crypto.randomUUID(),
        revision: (await detail(page, path)).session.revision,
        marks: [{ registrationId: fixture.paid.id, status: "PRESENT" }],
      },
    });
    expect(concurrent.status()).toBe(200);
    await pencil.click();
    const rejectedSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === path,
    );
    await person
      .getByRole("combobox", {
        name: "Asistencia de Enrolled Attendance",
        exact: true,
      })
      .click();
    await page.getByRole("option", { name: "Ausente", exact: true }).click();
    expect((await rejectedSave).status()).toBe(409);
    await expect(person.getByRole("alert")).not.toBeEmpty();
    await expect(
      person.getByRole("combobox", {
        name: "Asistencia de Enrolled Attendance",
        exact: true,
      }),
    ).toContainText("Ausente");
    await page
      .getByRole("link", { name: "Reintentar actualización", exact: true })
      .click();
    await expect(
      person.getByRole("button", { name: "Reintentar", exact: true }),
    ).toBeEnabled();
    await person
      .getByRole("button", {
        name: "Cancelar edición de asistencia de Enrolled Attendance",
        exact: true,
      })
      .click();
    await expect(
      person
        .locator("[data-mark-display]")
        .getByText("Presente", { exact: true }),
    ).toBeVisible();
    await pencil.click();
    await expect(
      person.getByRole("combobox", {
        name: "Asistencia de Enrolled Attendance",
        exact: true,
      }),
    ).toContainText("Presente");
    await person
      .getByRole("button", {
        name: "Cancelar edición de asistencia de Enrolled Attendance",
        exact: true,
      })
      .click();

    const adjustablePath = route(
      "cursos",
      fixture.adjustable.courseId,
      fixture.adjustable.groupId,
      fixture.adjustable.session.id,
    );
    await page.goto(adjustablePath);
    const adjustableActions = page.getByRole("group", {
      name: "Acciones de sesión",
      exact: true,
    });
    await adjustableActions
      .getByRole("button", { name: "Cancelar sesión", exact: true })
      .click();
    const cancellation = page.getByRole("dialog", {
      name: "Cancelar sesión",
      exact: true,
    });
    const reason = cancellation.getByRole("combobox", {
      name: "Motivo de cancelación",
      exact: true,
    });
    await expect(reason).toHaveAttribute("aria-expanded", "false");
    await reason.click();
    await page.getByRole("option", { name: "Feriado", exact: true }).click();
    await cancellation.getByRole("checkbox").check();
    const cancelled = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === adjustablePath &&
        response.request().method() === "POST",
    );
    await cancellation
      .getByRole("button", { name: "Confirmar", exact: true })
      .click();
    expect((await cancelled).status()).toBe(200);
    await expect(cancellation).not.toBeVisible();
    expect((await detail(page, adjustablePath)).session).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Feriado",
      canRecord: false,
    });

    await adjustableActions
      .getByRole("button", { name: "Reprogramar sesión", exact: true })
      .click();
    const replacement = page.getByRole("dialog", {
      name: "Reprogramar sesión",
      exact: true,
    });
    const date = civilDay(
      new Date(
        Date.parse(fixture.adjustable.session.startsAt) + 7 * 86_400_000,
      ),
    );
    await replacement
      .getByRole("textbox", { name: "Fecha de recuperación", exact: true })
      .fill(`${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`);
    await replacement
      .getByLabel("Hora de inicio (Bolivia)", { exact: true })
      .fill(fixture.replacementTime);
    await replacement
      .getByRole("button", { name: "Reemplazar", exact: true })
      .click();
    await expect(page).not.toHaveURL(
      new RegExp(`${fixture.adjustable.session.id}$`),
    );
    const recovered = await detail(page, new URL(page.url()).pathname);
    expect(recovered.session.replacementForSessionId).toBe(
      fixture.adjustable.session.id,
    );
    expect(
      new Date(recovered.session.endsAt).getTime() -
        new Date(recovered.session.startsAt).getTime(),
    ).toBe(
      new Date(fixture.adjustable.session.endsAt).getTime() -
        new Date(fixture.adjustable.session.startsAt).getTime(),
    );
    expect(
      recovered.group.sessions.find(
        (session) => session.id === fixture.adjustable.session.id,
      ),
    ).toMatchObject({ status: "CANCELLED", cancellationReason: "Feriado" });
    const listPath = adjustablePath.slice(0, adjustablePath.lastIndexOf("/"));
    await page.goto(listPath);
    const original = page
      .getByRole("link")
      .filter({ has: page.getByText("Feriado", { exact: true }) });
    await expect(
      page.getByRole("button", { name: "Próximas", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Todas", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "En curso", exact: true }),
    ).toHaveCount(0);
    await page.getByText("Canceladas", { exact: true }).click();
    await expect(original).toBeVisible();
    await expect(original).toHaveAttribute("href", adjustablePath);
    const calendarDay = page.getByRole("button", {
      name: new RegExp(
        new Intl.DateTimeFormat("es", {
          dateStyle: "full",
          timeZone: "America/La_Paz",
        }).format(new Date(fixture.adjustable.session.startsAt)),
        "u",
      ),
    });
    await calendarDay.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Todas", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(original).toBeVisible();
    await page.getByText("Próximas", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Todas", exact: true }),
    ).toHaveCount(0);
    await expect(original).not.toBeVisible();
    await expect(
      page
        .getByRole("link")
        .filter({ hasText: /Recuperación de/u })
        .filter({ hasText: new RegExp(fixture.replacementTime, "u") }),
    ).toHaveAttribute("href", `${listPath}/${recovered.session.id}`);
    await calendarDay.click();
    await page.getByText("Todas", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Todas", exact: true }),
    ).toHaveCount(0);
    await expect(original).toBeVisible();
    const stateFilters = page.getByRole("group", {
      name: "Estado de la sesión",
      exact: true,
    });
    for (const label of ["Próximas", "Finalizadas", "Canceladas"]) {
      const toggle = stateFilters.getByRole("button", {
        name: label,
        exact: true,
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await toggle.press("Space");
      await expect(toggle).toBeFocused();
      await expect(stateFilters.locator('[aria-pressed="true"]')).toHaveCount(
        0,
      );
      await expect(original).toBeVisible();
      await expect(
        page.locator("[data-session-day]:not([hidden])"),
      ).toHaveCount(recovered.group.sessions.length);
    }
  } finally {
    await fixture.close();
  }
});

test("INSTRUCTOR records only enrolled own participants without contacts or finance, and cannot mark past or foreign sessions", async ({
  page,
  context,
}) => {
  const fixture = await createAttendanceFlowFixture("2020-06-01", true);
  try {
    await signInFixture(context, AUTH_FIXTURES.instructor.email);
    const path = route(
      "mis-cursos",
      fixture.courseId,
      fixture.groupId,
      fixture.session.id,
    );
    await page.goto(path);
    const person = page.getByRole("form", {
      name: "Enrolled Attendance",
      exact: true,
    });
    await expect(
      page.getByRole("heading", { name: "Awaiting Attendance", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("group", { name: "Acciones de sesión", exact: true }),
    ).not.toBeVisible();
    for (const contact of [
      fixture.paid.participant.ci,
      fixture.paid.participant.email,
      fixture.partial.participant.ci,
      fixture.partial.participant.email,
    ])
      expect(await page.content()).not.toContain(contact);
    const own = await detail(page, path);
    expect(
      own.participants.some(
        (person) => person.registrationId === fixture.partial.id,
      ),
    ).toBe(false);
    expect(JSON.stringify(own)).not.toContain('"balanceCents"');
    expect(JSON.stringify(own)).not.toContain('"paidCents"');
    await chooseState(page, person, "Ausente");
    const [saved] = await fixture.database.db
      .select({
        status: schema.participantAttendance.status,
        actorId: schema.participantAttendance.markedBy,
      })
      .from(schema.participantAttendance)
      .where(
        and(
          eq(schema.participantAttendance.sessionId, fixture.session.id),
          eq(schema.participantAttendance.registrationId, fixture.paid.id),
        ),
      );
    expect(saved).toEqual({ status: "ABSENT", actorId: fixture.instructorId });

    const past = route(
      "mis-cursos",
      fixture.historyCourseId,
      fixture.historyGroupId,
      fixture.pastSession.id,
    );
    await page.goto(past);
    await expect(
      page.getByRole("form", { name: "Enrolled Attendance", exact: true }),
    ).not.toBeVisible();
    const history = await detail(page, past);
    expect(history.session.canRecord).toBe(false);
    const rejected = await page.request.post(`${past}?operation=record`, {
      headers: { Accept: "application/json", Origin: e2eSiteUrl() },
      form: {
        requestKey: crypto.randomUUID(),
        revision: String(history.session.revision),
        marks: JSON.stringify([
          { registrationId: fixture.historyPaid.id, status: "PRESENT" },
        ]),
      },
    });
    expect(rejected.status()).toBe(422);
    expect(await rejected.json()).toMatchObject({
      ok: false,
      code: "OUTSIDE_ATTENDANCE_DAY",
    });
    const foreign = fixture.foreign!;
    expect(
      (
        await page.request.get(
          route(
            "mis-cursos",
            foreign.courseId,
            foreign.groupId,
            foreign.sessionId,
          ),
          { headers: { Accept: "application/json" } },
        )
      ).status(),
    ).toBe(404);
    const adminOnly = await page.request.post(`${path}?operation=cancel`, {
      headers: { Accept: "application/json", Origin: e2eSiteUrl() },
      form: {
        requestKey: crypto.randomUUID(),
        revision: String((await detail(page, path)).session.revision),
        reason: "Feriado",
      },
    });
    expect(adminOnly.status()).toBe(403);
  } finally {
    await fixture.close();
  }
});
