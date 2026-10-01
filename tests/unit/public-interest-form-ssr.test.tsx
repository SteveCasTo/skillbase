import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PublicInterestForm from "@/components/public-courses/PublicInterestForm";
import {
  EMPTY_INTEREST_VALUES,
  INTEREST_SUCCESS_MESSAGE,
} from "@/components/public-courses/public-interest-presentation";
import type { PublicInterestPostPayload } from "@/domain/interests/types";

const groupId = "ae13da79-5b45-4ef1-a711-c786186aab80";
function render(
  overrides: Partial<Parameters<typeof PublicInterestForm>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(PublicInterestForm, {
      action: "/cursos/curso-publico#interes",
      available: true,
      groups: [{ id: groupId, startTime: "18:00", endTime: "19:30" }],
      initialValues: { ...EMPTY_INTEREST_VALUES },
      ...overrides,
    }),
  );
}

describe("public interest SSR fallback", () => {
  test("renders a functional HTML form with exactly one optional preference control", () => {
    const html = render();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/cursos/curso-publico#interes"');
    expect(html.match(/name="preferredGroupId"/g)).toHaveLength(1);
    expect(html).toContain(
      '<option value="" selected="">Sin preferencia</option>',
    );
    expect(html).toContain("Lunes a viernes, 18:00–19:30");
    expect(html.match(/ required=""/g)).toHaveLength(3);
    expect(html).not.toContain("noValidate");
    expect(html).not.toContain("capacity");
    expect(html).not.toContain("remainingPlaces");
    expect(html).not.toContain('name="payment"');
    expect(html).not.toContain("Bs ");
    const submit = html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0];
    expect(submit).toBeDefined();
    expect(submit).not.toMatch(/\sdisabled(?:=|\s|>)/i);
    expect(html).not.toContain("Nombre, apellidos y email son obligatorios.");
    expect(html).not.toContain("Elegir un horario expresa una preferencia");
    expect(html).not.toContain("Esta solicitud no reserva una plaza");
  });
  test("works without groups and never requires phone or a group", () => {
    const html = render({ groups: [] });
    expect(html).toContain("Sin preferencia");
    expect(html).not.toContain('name="preferredGroupId"');
    expect(html).toContain('name="phone"');
    expect(html).toContain("Dejar mis datos de interés");
  });
  test("native fallback exposes an enabled submit and retains HTML constraints after a server error", () => {
    const html = render({
      initialValues: {
        ...EMPTY_INTEREST_VALUES,
        firstName: "María José",
        lastName: "Pérez García",
        email: "interest@example.test",
      },
      initialResult: {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Revisa los campos indicados.",
        issues: { firstName: "Introduce un valor válido." },
      },
    });
    const submit = html.match(/<button\b[^>]*>/)?.[0];
    expect(submit).toBeDefined();
    expect(submit).toContain('type="submit"');
    expect(submit).not.toMatch(/\sdisabled(?:=|\s|>)/i);
    expect(html.toLowerCase()).not.toContain("novalidate");
    for (const name of ["firstName", "lastName", "email"]) {
      const input = html.match(
        new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`),
      )?.[0];
      expect(input).toBeDefined();
      expect(input).toContain('required=""');
      expect(input).not.toMatch(/\b(?:disabled|readonly|pattern)=/i);
    }
    expect(html).toContain('type="email"');
    expect(html).toContain('value="María José"');
    expect(html).toContain('aria-invalid="true"');
  });
  test("preserves and escapes attempted values, with linked field errors", () => {
    const html = render({
      initialValues: {
        ...EMPTY_INTEREST_VALUES,
        firstName: '<script>alert("x")</script>',
        preferredGroupId: groupId,
      },
      initialResult: {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Revisa los campos indicados.",
        issues: { email: "Introduce un email válido." },
      },
    });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('aria-describedby="interest-email-error"');
    expect(html).toContain('href="#interest-email"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(`<option value="${groupId}" selected="">`);
  });
  test("success is persistent, neutral, and contains no contact values or form", () => {
    const html = render({
      initialValues: {
        ...EMPTY_INTEREST_VALUES,
        email: "private@example.test",
      },
      initialResult: { ok: true, message: INTEREST_SUCCESS_MESSAGE },
    });
    expect(html).toContain(INTEREST_SUCCESS_MESSAGE);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("private@example.test");
    expect(html).not.toContain("<form");
  });
  test("closure removes controls, including when the server rejects a stale open form", () => {
    const unavailable: PublicInterestPostPayload = {
      ok: false,
      code: "INTEREST_UNAVAILABLE",
      message: "Este curso ya no recibe registros de interés.",
      issues: {},
    };
    for (const html of [
      render({ available: false }),
      render({ initialResult: unavailable }),
    ]) {
      expect(html).toContain("Registro de interés cerrado");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("lista de espera");
    }
  });
});
