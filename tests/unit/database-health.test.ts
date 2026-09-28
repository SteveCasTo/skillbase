import { describe, expect, test, mock } from "bun:test";

import { recoverDatabaseConnection } from "@/server/db/client";

describe("serverless database liveness", () => {
  test("keeps a working connection without creating another", async () => {
    const connection = { probe: async () => {}, discard: mock(async () => {}) };
    const create = mock(() => connection);
    expect(await recoverDatabaseConnection(connection, create, 10)).toBe(
      connection,
    );
    expect(create).not.toHaveBeenCalled();
    expect(connection.discard).not.toHaveBeenCalled();
  });

  test("replaces a hung socket and verifies the replacement", async () => {
    const stale = {
      probe: () => new Promise<void>(() => {}),
      discard: mock(async () => {}),
    };
    const fresh = {
      probe: mock(async () => {}),
      discard: mock(async () => {}),
    };
    const warn = mock(() => {});
    const previous = console.warn;
    console.warn = warn;
    try {
      expect(await recoverDatabaseConnection(stale, () => fresh, 5)).toBe(
        fresh,
      );
      expect(stale.discard).toHaveBeenCalledTimes(1);
      expect(fresh.probe).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("[database] stale connection recycled");
    } finally {
      console.warn = previous;
    }
  });

  test("fails quickly instead of using an unverified replacement", async () => {
    const stale = {
      probe: () => new Promise<void>(() => {}),
      discard: mock(async () => {}),
    };
    const broken = {
      probe: () => new Promise<void>(() => {}),
      discard: mock(async () => {}),
    };
    await expect(
      recoverDatabaseConnection(stale, () => broken, 5),
    ).rejects.toThrow("Database probe timed out");
    expect(broken.discard).toHaveBeenCalledTimes(1);
  });
});
