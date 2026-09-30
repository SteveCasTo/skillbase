import { afterEach, expect, it, spyOn } from "bun:test";

import { traceSlowOperation } from "../../src/server/observability/slow-operation";

const warnings = spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => warnings.mockClear());

it("returns fast results without logging", async () => {
  expect(await traceSlowOperation("test.fast", async () => 42, 1_000)).toBe(42);
  expect(warnings).not.toHaveBeenCalled();
});

it("identifies the pending phase and logs when it finishes", async () => {
  let finish: (value: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const traced = traceSlowOperation("test.pending", () => pending, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(warnings).toHaveBeenCalledWith(
    "[slow-operation] test.pending pending after 1ms",
  );
  finish("done");
  expect(await traced).toBe("done");
  expect(warnings.mock.calls[1]?.[0]).toMatch(
    /^\[slow-operation\] test.pending finished after \d+ms$/,
  );
});

it("clears the timer when an operation fails", async () => {
  await expect(
    traceSlowOperation(
      "test.failure",
      async () => {
        throw new Error("failure");
      },
      1_000,
    ),
  ).rejects.toThrow("failure");
  expect(warnings).not.toHaveBeenCalled();
});
