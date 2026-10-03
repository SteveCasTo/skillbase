import { expect, test } from "bun:test";
import type { AstroCookies } from "astro";
import { requestClientContext } from "@/server/auth/supabase";

test("Supabase request context does not evaluate unrelated lazy Astro getters", () => {
  const request = new Request("http://127.0.0.1:4321/login");
  // The projection treats the cookie adapter as an opaque reference and never calls it.
  const cookies = Object.create(null) as AstroCookies;
  const headers = new Headers();
  const context = {
    request,
    cookies,
    get session(): never {
      throw new Error("Astro session must not be accessed");
    },
    get unrelated(): never {
      throw new Error("Unrelated context getter must not be accessed");
    },
  };
  const result = requestClientContext(context, headers);
  expect(result.request).toBe(request);
  expect(result.cookies).toBe(cookies);
  expect(result.responseHeaders).toBe(headers);
  expect(Object.keys(result).sort()).toEqual([
    "cookies",
    "request",
    "responseHeaders",
  ]);
});
