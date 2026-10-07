import { expect, test } from "bun:test";
import {
  evaluationHundredths,
  evaluationResult,
  validateEvaluationComponents,
} from "@/domain/evaluations/rules";
import {
  handleEvaluationPost,
  evaluationFailure,
} from "@/server/evaluations/http";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import type { EvaluationRepository } from "@/application/evaluations/evaluation-repository";
import type { InternalUser } from "@/domain/auth/types";

test("evaluations parse decimal hundredths exactly and validate exact weights without tolerance", () => {
  for (const [text, expected] of [
    ["0", 0],
    ["100.00", 10000],
    ["33,33", 3333],
    [" 0.01 ", 1],
  ] as const)
    expect(evaluationHundredths(text, "score")).toBe(expected);
  for (const bad of [
    "-1",
    "100.01",
    "1.001",
    "1e2",
    "NaN",
    "1,000.00",
    70,
    null,
  ])
    expect(() => evaluationHundredths(bad, "score")).toThrow();
  const components = ["33.33", "33.33", "33.34"].map((weight) => ({
    id: crypto.randomUUID(),
    name: "Nombre libre",
    type: "THEORY" as const,
    weight,
  }));
  expect(() => validateEvaluationComponents(components)).not.toThrow();
  expect(() =>
    validateEvaluationComponents(
      components.map((c) => ({ ...c, weight: "33.33" })),
    ),
  ).toThrow();
  expect(() =>
    validateEvaluationComponents([
      { ...components[0]!, weight: "0" },
      { ...components[1]!, weight: "100" },
    ]),
  ).not.toThrow();
});
test("evaluations round half-up once and compare that same final, not hidden precision", () => {
  const components = [
    { id: "a", weightHundredths: 5000 },
    { id: "b", weightHundredths: 5000 },
  ];
  for (const [a, b, final, passed] of [
    [6999, 7000, "70.00", true],
    [6998, 7000, "69.99", false],
    [1, 1, "0.01", false],
    [0, 0, "0.00", false],
    [10000, 10000, "100.00", true],
  ] as const) {
    expect(
      evaluationResult(
        components,
        [
          { componentId: "a", scoreHundredths: a },
          { componentId: "b", scoreHundredths: b },
        ],
        70,
      ),
    ).toMatchObject({
      status: "COMPLETE",
      finalGrade: final,
      decisionGrade: final,
      passed,
    });
  }
  expect(
    evaluationResult(
      components,
      [
        { componentId: "a", scoreHundredths: 5000 },
        { componentId: "b", scoreHundredths: 5000 },
      ],
      50,
    ).passed,
  ).toBe(true);
});
test("evaluations missing a grade remain pending, distinct from an explicitly complete zero", () => {
  const components = [
    { id: "a", weightHundredths: 0 },
    { id: "b", weightHundredths: 10000 },
  ];
  expect(
    evaluationResult(
      components,
      [{ componentId: "b", scoreHundredths: 10000 }],
      70,
    ),
  ).toEqual({
    status: "PENDING",
    finalGrade: null,
    decisionGrade: "0.00",
    passed: false,
    missingComponentIds: ["a"],
  });
  expect(
    evaluationResult(
      components,
      [
        { componentId: "a", scoreHundredths: 0 },
        { componentId: "b", scoreHundredths: 0 },
      ],
      70,
    ),
  ).toMatchObject({ status: "COMPLETE", finalGrade: "0.00" });
});
test("evaluation HTTP binds private course/group IDs and rejects unexpected fields, origins and oversized bodies", async () => {
  const actor: InternalUser = {
    id: crypto.randomUUID(),
    authUserId: crypto.randomUUID(),
    email: "test@test.invalid",
    name: "Test",
    status: "ACTIVE",
    roles: ["ADMIN"],
  };
  const courseId = crypto.randomUUID(),
    groupId = crypto.randomUUID();
  const siteUrl = new URL("https://test.invalid");
  let calls = 0;
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected operation");
  };
  const repository: EvaluationRepository = {
    getCourse: unused,
    saveScheme: unused,
    saveGrade: async (_actor, input) => {
      calls++;
      return { kind: "scheme", schemeRevision: input.schemeRevision + 1 };
    },
  };
  const base = {
    requestKey: crypto.randomUUID(),
    schemeRevision: 1,
    gradeRevision: 0,
    registrationId: crypto.randomUUID(),
    componentId: crypto.randomUUID(),
    score: "70,00",
  };
  for (const [body, origin, expected] of [
    [{ ...base, courseId: crypto.randomUUID() }, siteUrl.origin, 422],
    [{ ...base, groupId: crypto.randomUUID() }, siteUrl.origin, 422],
    [{ ...base, actorId: actor.id }, siteUrl.origin, 422],
    [base, "https://evil.invalid", 403],
    [{ ...base, score: "x".repeat(66000) }, siteUrl.origin, 413],
  ] as const) {
    const response = await handleEvaluationPost({
      request: new Request(siteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      }),
      actor,
      repository,
      siteUrl,
      operation: "grade",
      courseId,
      groupId,
    });
    expect(response.status).toBe(expected);
  }
  expect(calls).toBe(0);
  expect(evaluationFailure(new Error("database secret"))).toMatchObject({
    status: 503,
    payload: { code: "SERVICE_UNAVAILABLE" },
  });
  for (const prefix of ["cursos", "mis-cursos"])
    for (const suffix of ["evaluaciones", `grupos/${groupId}/evaluaciones`])
      expect(
        getPrivateRoutePolicy(`/app/${prefix}/${courseId}/${suffix}`),
      ).toEqual({
        access: "ROLES",
        roles: prefix === "cursos" ? ["ADMIN"] : ["INSTRUCTOR"],
      });
});
