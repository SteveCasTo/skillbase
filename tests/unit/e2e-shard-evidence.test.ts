import { describe, expect, test } from "bun:test";
import {
  verifyShardEvidence,
  type CaseEvidence,
  type ShardEvidence,
} from "../../scripts/e2e-shard-evidence";

const caseEvidence = (id: string): CaseEvidence => ({
  id,
  outcome: "expected",
  attempts: [{ status: "passed", retry: 0, durationMs: 10 }],
});

function evidence(): ShardEvidence[] {
  return ["desktop", "mobile"].map((id, index) => ({
    inventory: { cases: [caseEvidence("desktop"), caseEvidence("mobile")] },
    outcomes: {
      status: "passed",
      cases: [caseEvidence(id)],
      isolation: {
        projectId: `skillbase_test_${index}`,
        workers: 1,
        fullyParallel: false,
        shard: { current: index + 1, total: 2 },
      },
    },
    execution: { exitCode: 0, wallTimeMs: 100 },
  }));
}

describe("isolated E2E shard cohort gate", () => {
  test("rejects shared stacks, duplicate shards and parallel workers", () => {
    const shared = evidence();
    shared[1]!.outcomes.isolation.projectId =
      shared[0]!.outcomes.isolation.projectId;
    expect(() => verifyShardEvidence(shared)).toThrow();
    const duplicate = evidence();
    duplicate[1]!.outcomes.isolation.shard.current = 1;
    expect(() => verifyShardEvidence(duplicate)).toThrow();
    const parallel = evidence();
    parallel[0]!.outcomes.isolation.workers = 2;
    expect(() => verifyShardEvidence(parallel)).toThrow();
    const fullyParallel = evidence();
    fullyParallel[0]!.outcomes.isolation.fullyParallel = true;
    expect(() => verifyShardEvidence(fullyParallel)).toThrow();
  });
  test("collates a complete disjoint cohort and reports real metrics", () => {
    expect(verifyShardEvidence(evidence())).toEqual({
      cases: 2,
      shardCases: [1, 1],
      flaky: 0,
      retries: 0,
      shardWallTimeMs: [100, 100],
    });
  });

  test("retains the existing retry policy without hiding flaky outcomes", () => {
    const shards = evidence();
    const retried = shards[1]!.outcomes.cases[0]!;
    retried.outcome = "flaky";
    retried.attempts = [
      { status: "failed", retry: 0, durationMs: 20 },
      { status: "passed", retry: 1, durationMs: 10 },
    ];
    expect(verifyShardEvidence(shards)).toMatchObject({ flaky: 1, retries: 1 });
  });

  for (const outcome of ["skipped", "unexpected"] as const) {
    test(`rejects ${outcome} cases even if the job reports success`, () => {
      const shards = evidence();
      shards[0]!.outcomes.cases[0]!.outcome = outcome;
      expect(() => verifyShardEvidence(shards)).toThrow();
    });
  }

  test("rejects an incomplete matrix", () => {
    expect(() => verifyShardEvidence(evidence().slice(0, 1))).toThrow();
  });

  test("rejects repeated identities across shards", () => {
    const shards = evidence();
    shards[1]!.outcomes.cases = [caseEvidence("desktop")];
    expect(() => verifyShardEvidence(shards)).toThrow();
  });

  test("rejects mismatched inventories and unknown identities", () => {
    const shards = evidence();
    shards[1]!.inventory.cases[0]!.id = "other";
    expect(() => verifyShardEvidence(shards)).toThrow();
    const unknown = evidence();
    unknown[1]!.outcomes.cases[0]!.id = "other";
    expect(() => verifyShardEvidence(unknown)).toThrow();
  });

  test("rejects gaps, empty shards and duplicate inventories", () => {
    const gap = evidence();
    gap[0]!.inventory.cases.push(caseEvidence("missing"));
    gap[1]!.inventory.cases.push(caseEvidence("missing"));
    expect(() => verifyShardEvidence(gap)).toThrow();
    const empty = evidence();
    empty[1]!.outcomes.cases = [];
    expect(() => verifyShardEvidence(empty)).toThrow();
    const duplicate = evidence();
    duplicate[0]!.inventory.cases.push(caseEvidence("desktop"));
    expect(() => verifyShardEvidence(duplicate)).toThrow();
  });

  for (const status of ["failed", "timedout", "interrupted"]) {
    test(`rejects ${status} runs`, () => {
      const shards = evidence();
      shards[1]!.outcomes.status = status;
      expect(() => verifyShardEvidence(shards)).toThrow();
    });
  }

  test("rejects nonzero exit codes and cases without a final pass", () => {
    const failed = evidence();
    failed[0]!.execution.exitCode = 1;
    expect(() => verifyShardEvidence(failed)).toThrow();
    const noAttempts = evidence();
    noAttempts[0]!.outcomes.cases[0]!.attempts = [];
    expect(() => verifyShardEvidence(noAttempts)).toThrow();
    const incomplete = evidence();
    incomplete[0]!.outcomes.cases[0]!.attempts[0]!.status = "interrupted";
    expect(() => verifyShardEvidence(incomplete)).toThrow();
  });
});
