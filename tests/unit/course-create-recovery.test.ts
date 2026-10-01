import { afterEach, expect, mock, test } from "bun:test";

const navigate = mock(async () => {});
mock.module("astro:transitions/client", () => ({ navigate }));
const { createCourseWithArtwork } =
  await import("@/components/courses/createCourseWithArtwork");
const originalFetch = globalThis.fetch;
function installFetch(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = Object.assign(mock(handler), {
    preconnect: originalFetch.preconnect,
  });
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  navigate.mockClear();
});
const id = "11111111-1111-4111-8111-111111111111";
const revision = "2026-09-30T00:00:00.000Z";
const updated = "2026-09-30T00:00:00.001Z";
const artwork = `courses/${id}/22222222-2222-4222-8222-222222222222.webp`;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });

test("creation retry sends the identical request key after a lost committed response", async () => {
  const fields = new FormData();
  const key = crypto.randomUUID();
  fields.set("requestKey", key);
  fields.set("name", "Original draft");
  let attempts = 0;
  installFetch(async (_url, options) => {
    expect(options?.body).toBe(fields);
    expect((options?.body as FormData).get("requestKey")).toBe(key);
    if (++attempts === 1) throw new TypeError("Response lost after commit");
    return json({ id, revision });
  });
  await expect(
    createCourseWithArtwork(fields, null, [], () => {}),
  ).rejects.toThrow("Response lost");
  await createCourseWithArtwork(fields, null, [], () => {});
  expect(attempts).toBe(2);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("lost artwork association is verified using an authorized DTO before retrying writes", async () => {
  const calls: string[] = [];
  installFetch(async (url, options) => {
    const path = String(url);
    calls.push(`${options?.method ?? "GET"} ${path}`);
    if (path.endsWith("nuevo")) return json({ id, revision });
    if (path.endsWith("imagen")) return json({ artwork });
    if (options?.method === "POST")
      throw new TypeError("Response lost after commit");
    return json({ id, revision: updated, artwork });
  });
  let retry: (() => Promise<void>) | undefined;
  await expect(
    createCourseWithArtwork(
      new FormData(),
      new File(["photo"], "photo.webp"),
      [],
      (_url, next) => {
        retry = next;
      },
    ),
  ).rejects.toThrow("Response lost");
  expect(navigate).not.toHaveBeenCalled();
  await retry!();
  expect(
    calls.filter((call) => call === `POST /app/cursos/${id}/editar`),
  ).toHaveLength(1);
  expect(
    calls.filter((call) => call === "POST /app/cursos/imagen"),
  ).toHaveLength(1);
  expect(calls).toContain(`GET /app/cursos/${id}/editar`);
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("an uncertain association never overwrites a different concurrent edit", async () => {
  let associations = 0;
  installFetch(async (url, options) => {
    const path = String(url);
    if (path.endsWith("nuevo")) return json({ id, revision });
    if (path.endsWith("imagen")) return json({ artwork });
    if (options?.method === "POST") {
      associations++;
      throw new TypeError("Response lost");
    }
    return json({ id, revision: updated, artwork: null });
  });
  let retry: (() => Promise<void>) | undefined;
  await expect(
    createCourseWithArtwork(
      new FormData(),
      new File(["photo"], "photo.webp"),
      [],
      (_url, next) => {
        retry = next;
      },
    ),
  ).rejects.toThrow();
  await expect(retry!()).rejects.toThrow("El borrador cambió");
  expect(associations).toBe(1);
  expect(navigate).not.toHaveBeenCalled();
});

test("an empty successful group response cannot resolve creation as successful", async () => {
  installFetch(async (url) =>
    String(url).endsWith("nuevo") ? json({ id, revision }) : json({}),
  );
  await expect(
    createCourseWithArtwork(
      new FormData(),
      null,
      [{ startTime: "08:00", capacity: 10 }],
      () => {},
    ),
  ).rejects.toThrow("No se pudo crear el grupo");
  expect(navigate).not.toHaveBeenCalled();
});

test("truthy non-ISO revisions cannot confirm a draft or photo association", async () => {
  installFetch(async () => json({ id, revision: true }));
  await expect(
    createCourseWithArtwork(new FormData(), null, [], () => {}),
  ).rejects.toThrow("No se pudo crear el borrador");
  expect(navigate).not.toHaveBeenCalled();
});
