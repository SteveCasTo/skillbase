import { expect, test } from "bun:test";
import {
  interestAvailable,
  validateInterestMutation,
  validateRegisterInterest,
} from "@/domain/interests/rules";
import { requireInterestAdmin } from "@/application/interests/manage-interests";
import type { InternalUser } from "@/domain/auth/types";
import {
  blankInterestValues,
  ownInterestValues,
  readInterestRequest,
} from "@/server/interests/request";
import { networkDigest, rateConfig } from "@/server/interests/rate-limit";
import { getPrivateRoutePolicy } from "@/server/auth/route-policy";
import { requestHasExpectedOrigin } from "@/server/auth/redirects";
const input = {
  firstName: " María José ",
  lastName: " O'Connor 李 ",
  email: " A.B+test@Example.COM ",
};
test("interests normalize snapshot without provider-specific email transformations", () => {
  expect(validateRegisterInterest(input)).toEqual({
    firstName: "María José",
    lastName: "O'Connor 李",
    email: "a.b+test@example.com",
    phone: null,
    preferredGroupId: null,
  });
  expect(
    validateRegisterInterest({
      ...input,
      phone: "  +591 123  ",
      preferredGroupId: crypto.randomUUID(),
    }).phone,
  ).toBe("+591 123");
  expect(
    validateRegisterInterest({
      ...input,
      firstName: "😀".repeat(100),
      lastName: "李".repeat(150),
      phone: "",
    }).phone,
  ).toBeNull();
});
test("interests reject invalid types, controls, limits, missing and unknown fields", () => {
  for (const raw of [
    null,
    [],
    "input",
    { ...input, courseId: crypto.randomUUID() },
    { ...input, firstName: null },
    { ...input, email: 42 },
    { ...input, phone: [] },
    { ...input, preferredGroupId: false },
    { ...input, firstName: " " },
    { ...input, firstName: "😀".repeat(101) },
    { ...input, lastName: "x".repeat(151) },
    { ...input, phone: "x".repeat(33) },
    { ...input, firstName: "\nname" },
    { ...input, phone: "a\u0085b" },
    { ...input, email: "a@b" },
    { ...input, preferredGroupId: "invalid" },
    { ...input, email: `${"x".repeat(250)}@a.invalid` },
  ])
    expect(() => validateRegisterInterest(raw)).toThrow();
});
test("interests availability is publication-based with exclusive deadline, not opening", () => {
  const course = {
    status: "PUBLISHED",
    startsAt: new Date("2030-05-01Z"),
    registrationEndAt: new Date("2030-04-01Z"),
  };
  expect(interestAvailable(course, new Date("2030-01-01Z"))).toBe(true);
  expect(
    interestAvailable(course, new Date(course.registrationEndAt.getTime() - 1)),
  ).toBe(true);
  expect(interestAvailable(course, course.registrationEndAt)).toBe(false);
  expect(interestAvailable(course, new Date("2031-01-01Z"))).toBe(false);
  expect(
    interestAvailable({ ...course, registrationEndAt: null }, course.startsAt),
  ).toBe(false);
  for (const status of ["DRAFT", "ARCHIVED"])
    expect(
      interestAvailable({ ...course, status }, new Date("2030-01-01Z")),
    ).toBe(false);
});
test("interests mutations require closed intent, UUID and strict millisecond ISO revision", () => {
  const mutation = {
    intent: "cancel" as const,
    interestRegistrationId: crypto.randomUUID(),
    revision: "2030-01-01T00:00:00.000Z",
  };
  expect(validateInterestMutation(mutation)).toEqual(mutation);
  for (const revision of [
    "2030-01-01",
    "2030-02-30T00:00:00.000Z",
    "2030-01-01T00:00:00Z",
    "2030-01-01T00:00:00.000+00:00",
    "invalid",
  ])
    expect(() => validateInterestMutation({ ...mutation, revision })).toThrow();
  expect(() =>
    validateInterestMutation({ ...mutation, intent: "delete" }),
  ).toThrow();
});
test("interests admin guards and exact routes are fail closed", () => {
  const actor: InternalUser = {
    id: crypto.randomUUID(),
    authUserId: crypto.randomUUID(),
    name: "Test",
    email: "test@test.invalid",
    status: "ACTIVE",
    roles: ["ADMIN"],
  };
  expect(() => requireInterestAdmin(actor)).not.toThrow();
  for (const denied of [
    { ...actor, roles: [] },
    { ...actor, roles: ["INSTRUCTOR"] as const },
    { ...actor, status: "DISABLED" as const },
  ])
    expect(() => requireInterestAdmin(denied)).toThrow();
  expect(getPrivateRoutePolicy("/app/interesados")).toEqual({
    access: "ROLES",
    roles: ["ADMIN"],
  });
  expect(
    getPrivateRoutePolicy(`/app/interesados/${crypto.randomUUID()}`),
  ).toEqual({ access: "ROLES", roles: ["ADMIN"] });
  for (const path of [
    "/app/interesados/other",
    "/app/interesados/nuevo",
    `/app/interesados/${crypto.randomUUID()}/editar`,
  ])
    expect(getPrivateRoutePolicy(path)).toBeNull();
});
test("interests origin is exact and never falls back to referer", () => {
  const url = new URL("https://example.test");
  for (const origin of [
    undefined,
    "null",
    "https://other.test",
    "https://example.test.evil",
    "https://example.test/",
  ])
    expect(
      requestHasExpectedOrigin(
        new Request(url, {
          headers: origin ? { origin } : { referer: url.href },
        }),
        url,
      ),
    ).toBe(false);
  expect(
    requestHasExpectedOrigin(
      new Request(url, { headers: { origin: url.origin } }),
      url,
    ),
  ).toBe(true);
});
test("interests limiter requires server secret and positive configurable technical defaults", () => {
  expect(() => rateConfig({})).toThrow();
  expect(() => rateConfig({ INTEREST_RATE_LIMIT_SECRET: "short" })).toThrow();
  const secret = "x".repeat(32);
  expect(rateConfig({ INTEREST_RATE_LIMIT_SECRET: secret })).toEqual({
    secret,
    courseLimit: 20,
    courseSeconds: 600,
    networkLimit: 100,
    networkSeconds: 3600,
  });
  for (const value of ["0", "-1", "1.5", "NaN", "2147483647"])
    expect(() =>
      rateConfig({
        INTEREST_RATE_LIMIT_SECRET: secret,
        INTEREST_RATE_COURSE_LIMIT: value,
      }),
    ).toThrow();
  expect(networkDigest("2001:db8::1", secret)).toBe(
    networkDigest("2001:0db8:0:0:0:0:0:1", secret),
  );
  expect(networkDigest("192.0.2.1", secret)).toMatch(/^[a-f0-9]{64}$/);
  expect(networkDigest("::ffff:192.0.2.1", secret)).toBe(
    networkDigest("192.0.2.1", secret),
  );
  expect(() => networkDigest("untrusted", secret)).toThrow();
});
test("interests parser supports bounded JSON and urlencoded, rejects repeated fields and MIME", async () => {
  const request = (body: string, mime: string) =>
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": mime },
      body,
    });
  expect(
    await readInterestRequest(
      request(JSON.stringify(input), "application/json"),
    ),
  ).toEqual(input);
  expect(
    await readInterestRequest(
      request("firstName=Maria&phone=", "application/x-www-form-urlencoded"),
    ),
  ).toEqual({ firstName: "Maria", phone: "" });
  for (const [body, mime] of [
    ["firstName=x&firstName=y", "application/x-www-form-urlencoded"],
    ["{bad", "application/json"],
    ["x", "multipart/form-data"],
  ])
    await expect(readInterestRequest(request(body!, mime!))).rejects.toThrow();
  await expect(
    readInterestRequest(request("😀".repeat(2049), "application/json")),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  await expect(
    readInterestRequest(
      new Request("https://example.test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "9000",
        },
        body: "{}",
      }),
    ),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
});
test("interests counts real stream bytes despite false or missing length and cancels reading", async () => {
  for (const length of [undefined, "1"]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5000));
        controller.enqueue(new Uint8Array(4000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://example.test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(length ? { "content-length": length } : {}),
      },
      body: stream,
    });
    await expect(readInterestRequest(request)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
  }
  expect(
    ownInterestValues({ ...input, phone: null, courseId: "ignored" }),
  ).toEqual({
    ...blankInterestValues(),
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
  });
});
