import { expect, mock, test } from "bun:test";
import {
  exportRegistrations,
  MAX_REGISTRATION_EXPORT_ROWS,
  RegistrationExportLimitError,
} from "@/application/pre-registrations/export-registrations";
import type { RegistrationRepository } from "@/application/pre-registrations/registration-repository";
import { RegistrationError } from "@/domain/pre-registrations/errors";
import type {
  AdminRegistrationDto,
  RegistrationFilter,
} from "@/domain/pre-registrations/types";
import {
  exportActor,
  exportNow,
  exportRow,
} from "./registration-export-fixture";

const filter: RegistrationFilter = {
  page: 3,
  pageSize: 10,
  search: "María",
  membershipStatus: "PREINSCRITO",
};
function repository(
  rows: readonly AdminRegistrationDto[],
): Pick<RegistrationRepository, "list"> {
  return {
    list: mock(async (query: RegistrationFilter, actorId: string) => {
      expect(actorId).toBe(exportActor.id);
      return {
        items: rows.slice(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize,
        ),
        total: rows.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }),
  };
}
test("exports all matching authorized pages, retains filters and returns a safe Bolivia filename", async () => {
  const rows = Array.from({ length: 205 }, (_, i) => exportRow(i));
  const repo = repository(rows);
  const render = mock(async () => new Uint8Array([1, 2]));
  const artifact = await exportRegistrations(
    repo,
    { render },
    exportActor,
    { filter, format: "CSV" },
    () => exportNow,
  );
  expect(artifact).toEqual({
    mediaType: "text/csv; charset=utf-8",
    filename: "preinscripciones-2099-03-01.csv",
    bytes: new Uint8Array([1, 2]),
    rowCount: 205,
  });
  expect(repo.list).toHaveBeenCalledTimes(3);
  expect(repo.list).toHaveBeenLastCalledWith(
    { ...filter, page: 3, pageSize: 100 },
    exportActor.id,
  );
  expect(render).toHaveBeenCalledWith("CSV", rows);
});
test("empty PDF export still produces an artifact", async () => {
  const render = mock(async () => new Uint8Array([37]));
  const artifact = await exportRegistrations(
    repository([]),
    { render },
    exportActor,
    { filter, format: "PDF" },
    () => exportNow,
  );
  expect(artifact.mediaType).toBe("application/pdf");
  expect(artifact.filename).toBe("preinscripciones-2099-03-01.pdf");
  expect(artifact.rowCount).toBe(0);
  expect(render).toHaveBeenCalledWith("PDF", []);
});
test("exact export limit is complete; oversized export is refused before rendering", async () => {
  const rows = Array.from({ length: MAX_REGISTRATION_EXPORT_ROWS }, (_, i) =>
    exportRow(i),
  );
  const render = mock(async () => new Uint8Array());
  expect(
    (
      await exportRegistrations(repository(rows), { render }, exportActor, {
        filter,
        format: "CSV",
      })
    ).rowCount,
  ).toBe(1000);
  render.mockClear();
  await expect(
    exportRegistrations(
      repository([...rows, exportRow(1001)]),
      { render },
      exportActor,
      { filter, format: "CSV" },
    ),
  ).rejects.toBeInstanceOf(RegistrationExportLimitError);
  expect(render).not.toHaveBeenCalled();
});
test.each([
  null,
  { ...exportActor, roles: ["INSTRUCTOR"] as const },
  { ...exportActor, status: "DISABLED" as const },
  { ...exportActor, status: "INVITED" as const },
])("denies non-active administrators before reading PII", async (actor) => {
  const repo = repository([exportRow()]);
  const render = mock(async () => new Uint8Array());
  await expect(
    exportRegistrations(repo, { render }, actor, { filter, format: "CSV" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(repo.list).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});
test("fresh repository denial defeats a stale ADMIN context", async () => {
  const render = mock(async () => new Uint8Array());
  const repo: Pick<RegistrationRepository, "list"> = {
    async list() {
      throw new RegistrationError("FORBIDDEN", "Acceso denegado.");
    },
  };
  await expect(
    exportRegistrations(repo, { render }, exportActor, {
      filter,
      format: "CSV",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(render).not.toHaveBeenCalled();
});
test.each([
  { page: 0 },
  { pageSize: -1 },
  { page: Number.MAX_SAFE_INTEGER + 1 },
  { courseId: "../private" },
  { groupId: "bad" },
  { search: "\n=1" },
  { search: "a".repeat(201) },
])("invalid filters are rejected before queries", async (invalid) => {
  const repo = repository([]);
  await expect(
    exportRegistrations(
      repo,
      { render: async () => new Uint8Array() },
      exportActor,
      { filter: { ...filter, ...invalid }, format: "CSV" },
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(repo.list).not.toHaveBeenCalled();
});
test.each(["total", "duplicate", "short", "pagination"] as const)(
  "refuses %s inconsistencies instead of silently omitting data",
  async (kind) => {
    let reads = 0;
    const rows = Array.from({ length: 101 }, (_, i) => exportRow(i));
    const repo: Pick<RegistrationRepository, "list"> = {
      async list(query) {
        reads++;
        return {
          items:
            reads === 1
              ? rows.slice(0, kind === "short" ? 99 : 100)
              : [rows[kind === "duplicate" ? 0 : 100]!],
          total: kind === "total" && reads > 1 ? 102 : 101,
          page: kind === "pagination" ? 0 : query.page,
          pageSize: query.pageSize,
        };
      },
    };
    const render = mock(async () => new Uint8Array());
    await expect(
      exportRegistrations(repo, { render }, exportActor, {
        filter,
        format: "CSV",
      }),
    ).rejects.toMatchObject({ code: "CONCURRENT_UPDATE" });
    expect(render).not.toHaveBeenCalled();
  },
);
