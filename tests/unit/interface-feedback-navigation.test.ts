import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { notifications } from "@/lib/notifications";
import { notifyInlineOperation } from "@/lib/inline-operation-feedback";
import { formatFieldChanged } from "@/components/courses/format-inline-state";

const loading = spyOn(notifications, "loading").mockImplementation(
  () => "loading",
);
const success = spyOn(notifications, "success").mockImplementation(
  () => "success",
);
const dismiss = spyOn(notifications, "dismiss").mockImplementation(() => {});
const error = spyOn(notifications, "error").mockImplementation(() => "error");
afterEach(() => {
  loading.mockClear();
  success.mockClear();
  dismiss.mockClear();
  error.mockClear();
});
afterAll(() => {
  loading.mockRestore();
  success.mockRestore();
  dismiss.mockRestore();
  error.mockRestore();
});

test("inline-owned operations preserve returned DTO and one loading/success id", async () => {
  const dto = { revision: "new" };
  const result = await notifyInlineOperation(async () => dto, {
    loading: { title: "Guardando" },
    success: (value) => ({ title: value.revision }),
  });
  expect(result).toBe(dto);
  const id = loading.mock.calls[0]![0].id;
  expect(id).toBeString();
  expect(success.mock.calls[0]![0]).toMatchObject({ id, title: "new" });
  expect(dismiss).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

test("persistent failure rejects unchanged and dismisses loading without duplicate error toast", async () => {
  const failure = new Error("Conflict: consult current values");
  let caught: unknown;
  try {
    await notifyInlineOperation(
      async () => {
        throw failure;
      },
      {
        loading: { id: "operation-owned", title: "Guardando" },
        success: { title: "Guardado" },
      },
    );
  } catch (result) {
    caught = result;
  }
  expect(caught).toBe(failure);
  expect(dismiss).toHaveBeenCalledWith("operation-owned");
  expect(success).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

test("simultaneous operations do not replace each other's notification ids", async () => {
  await Promise.all([
    notifyInlineOperation(async () => 1, {
      loading: { title: "A" },
      success: { title: "A" },
    }),
    notifyInlineOperation(async () => 2, {
      loading: { title: "B" },
      success: { title: "B" },
    }),
  ]);
  expect(loading.mock.calls[0]![0].id).not.toBe(loading.mock.calls[1]![0].id);
});

test("format dirty compares canonical text/numerals without imposing domain constraints", () => {
  expect(formatFieldChanged("name", " Nombre ", "Nombre")).toBe(false);
  expect(formatFieldChanged("name", "Otro nombre", "Nombre")).toBe(true);
  expect(formatFieldChanged("studentAmount", "100.0", "100.00")).toBe(false);
  expect(formatFieldChanged("studentAmount", "100.01", "100.00")).toBe(true);
  expect(formatFieldChanged("sessionMinutes", "", "90")).toBe(true);
  expect(formatFieldChanged("totalHours", "20", "20")).toBe(false);
});
