export interface CaseEvidence {
  id: string;
  outcome: "expected" | "unexpected" | "flaky" | "skipped";
  attempts: { status: string; retry: number; durationMs: number }[];
}

export interface ShardEvidence {
  inventory: { cases: CaseEvidence[] };
  outcomes: {
    status: string;
    cases: CaseEvidence[];
    isolation: {
      projectId: string;
      workers: number;
      fullyParallel: boolean;
      shard: { current: number; total: number };
    };
  };
  execution: { exitCode: number; wallTimeMs: number };
}

export function verifyShardEvidence(shards: ShardEvidence[]) {
  if (shards.length !== 2) throw new Error("Exactly two shards are required");
  const expected = new Set(shards[0]!.inventory.cases.map((test) => test.id));
  if (!expected.size) throw new Error("Empty E2E cohort");
  const seen = new Set<string>();
  const projects = new Set<string>();
  const shardNumbers = new Set<number>();
  let flaky = 0;
  let retries = 0;
  for (const shard of shards) {
    const isolation = shard.outcomes.isolation;
    if (
      !isolation.projectId.startsWith("skillbase_test_") ||
      projects.has(isolation.projectId) ||
      isolation.workers !== 1 ||
      isolation.fullyParallel !== false ||
      isolation.shard.total !== 2 ||
      ![1, 2].includes(isolation.shard.current) ||
      shardNumbers.has(isolation.shard.current)
    )
      throw new Error("E2E shards must use distinct stacks and serial workers");
    projects.add(isolation.projectId);
    shardNumbers.add(isolation.shard.current);
    const inventory = shard.inventory.cases.map((test) => test.id);
    if (
      inventory.length !== expected.size ||
      new Set(inventory).size !== expected.size ||
      inventory.some((id) => !expected.has(id))
    )
      throw new Error("Shard inventories differ or contain duplicates");
    if (shard.execution.exitCode !== 0 || shard.outcomes.status !== "passed")
      throw new Error("Shard execution was not successful");
    if (!shard.outcomes.cases.length) throw new Error("Empty shard");
    for (const test of shard.outcomes.cases) {
      if (!expected.has(test.id) || seen.has(test.id))
        throw new Error("Unexpected or duplicate E2E identity");
      if (
        !["expected", "flaky"].includes(test.outcome) ||
        !test.attempts.length ||
        test.attempts.at(-1)?.status !== "passed"
      )
        throw new Error("E2E case did not complete successfully");
      seen.add(test.id);
      flaky += Number(test.outcome === "flaky");
      retries += test.attempts.filter((attempt) => attempt.retry > 0).length;
    }
  }
  if (seen.size !== expected.size) throw new Error("Missing E2E identities");
  return {
    cases: seen.size,
    shardCases: shards.map((shard) => shard.outcomes.cases.length),
    flaky,
    retries,
    shardWallTimeMs: shards.map((shard) => shard.execution.wallTimeMs),
  };
}
