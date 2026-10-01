import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { sileo } from "sileo";
import type { NotificationOptions } from "../../src/lib/notifications";

const calls: { state: string; options: NotificationOptions; id: string }[] = [];
function record(state: string, options: NotificationOptions) {
  if (typeof options.id !== "string")
    throw new Error("Missing runtime notification id");
  calls.push({ state, options, id: options.id });
  return options.id;
}

// Only the real vendor export/methods used by the facade are mocked.
const backend = {
  success: mock((options: NotificationOptions) => record("success", options)),
  error: mock((options: NotificationOptions) => record("error", options)),
  info: mock((options: NotificationOptions) => record("info", options)),
  warning: mock((options: NotificationOptions) => record("warning", options)),
  show: mock((options: NotificationOptions) =>
    record(options.type ?? "show", options),
  ),
  promise<T>(
    operation: Promise<T> | (() => Promise<T>),
    options: Parameters<typeof sileo.promise<T>>[1],
  ) {
    // Match the vendor: promise-level position overwrites loading.position.
    const id = record("loading", {
      ...options.loading,
      position: options.position ?? "top-right",
    });
    const result = typeof operation === "function" ? operation() : operation;
    void result.then(
      (value) =>
        record("success", {
          ...(typeof options.success === "function"
            ? options.success(value)
            : options.success),
          id,
        }),
      (error: unknown) =>
        record("error", {
          ...(typeof options.error === "function"
            ? options.error(error)
            : options.error),
          id,
        }),
    );
    return result;
  },
} satisfies Pick<
  typeof sileo,
  "success" | "error" | "info" | "warning" | "show" | "promise"
>;

mock.module("sileo", () => ({ sileo: backend }));
const { notifications } = await import("../../src/lib/notifications");

beforeEach(() => {
  calls.length = 0;
});

describe("notification operation identity", () => {
  test("every independent state call receives a unique explicit runtime id", () => {
    const options = {
      title: "Notice",
      description: "Details",
      duration: 12000,
    };
    const ids = [
      notifications.success(options),
      notifications.error(options),
      notifications.info(options),
      notifications.warning(options),
      notifications.loading(options),
    ];
    expect(new Set(ids).size).toBe(5);
    expect(
      ids.every(
        (id) => id.startsWith("notification-") && id !== "sileo-default",
      ),
    ).toBe(true);
    for (const call of calls) {
      expect(call.options.title).toBe(options.title);
      expect(call.options.description).toBe(options.description);
      expect(call.options.duration).toBe(options.duration);
      expect(call.options.position).toBe("bottom-right");
    }
    expect(options).not.toHaveProperty("id");
    expect(options).not.toHaveProperty("position");
  });

  test("explicit notice and promise positions remain supported before host mount", async () => {
    notifications.info({ title: "Elsewhere", position: "top-left" });
    expect(calls[0]!.options.position).toBe("top-left");
    await notifications.promise(Promise.resolve(), {
      loading: { title: "Loading", position: "bottom-left" },
      success: { title: "Done" },
      error: { title: "Failed" },
    });
    expect(calls[1]!.options.position).toBe("bottom-left");
    await notifications.promise(Promise.resolve(), {
      position: "top-center",
      loading: { title: "Loading", position: "bottom-left" },
      success: { title: "Done" },
      error: { title: "Failed" },
    });
    expect(calls[3]!.options.position).toBe("top-center");
  });

  test("explicit existing id updates one operation and loading stays until settled", () => {
    const id = notifications.loading({ title: "Saving" });
    expect(calls[0]!.options.duration).toBeNull();
    expect(notifications.success({ title: "Saved", id })).toBe(id);
    expect(notifications.error({ title: "Failed", id })).toBe(id);
    expect(calls.map((call) => call.id)).toEqual([id, id, id]);
  });

  test("sibling promises get separate ids, preserve promise identity/value and keep their stage id", async () => {
    const first = Promise.resolve({ value: 1 });
    const second = Promise.resolve({ value: 2 });
    const firstResult = notifications.promise(first, {
      loading: { title: "First" },
      success: (value) => ({ title: String(value.value) }),
      error: { title: "Failed" },
    });
    const secondResult = notifications.promise(second, {
      loading: { title: "Second" },
      success: { title: "Done" },
      error: { title: "Failed" },
    });
    expect(firstResult).toBe(first);
    expect(secondResult).toBe(second);
    const ids = calls.map((call) => call.id);
    expect(
      calls.every((call) => call.options.position === "bottom-right"),
    ).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
    expect(await firstResult).toEqual({ value: 1 });
    expect(await secondResult).toEqual({ value: 2 });
    expect(
      calls.filter((call) => call.state === "success").map((call) => call.id),
    ).toEqual(ids);
  });

  test("promise existing id wins over loading id and rejection remains the original rejection", async () => {
    const failure = new Error("Original rejection");
    const operation = Promise.reject(failure);
    const result = notifications.promise(operation, {
      id: "existing",
      loading: { id: "ignored", title: "Saving" },
      success: { title: "Saved" },
      error: (error) => ({
        title: error instanceof Error ? error.message : "Failed",
      }),
    });
    expect(result).toBe(operation);
    await expect(result).rejects.toBe(failure);
    expect(calls.map((call) => call.id)).toEqual(["existing", "existing"]);
    expect(calls.at(-1)!.options.title).toBe("Original rejection");
  });

  test("promise factory is invoked once and an explicit loading id is retained", async () => {
    const operation = Promise.resolve("value");
    const factory = mock(() => operation);
    const result = notifications.promise(factory, {
      loading: { id: "loading-choice", title: "Saving" },
      success: { title: "Saved" },
      error: { title: "Failed" },
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toBe(operation);
    await result;
    expect(calls.map((call) => call.id)).toEqual([
      "loading-choice",
      "loading-choice",
    ]);
  });

  test("a synchronous factory throw remains synchronous, matching the vendor", () => {
    const failure = new Error("Factory failure");
    expect(() =>
      notifications.promise(
        () => {
          throw failure;
        },
        {
          loading: { title: "Saving" },
          success: { title: "Saved" },
          error: { title: "Failed" },
        },
      ),
    ).toThrow(failure);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toBe("loading");
  });
});
