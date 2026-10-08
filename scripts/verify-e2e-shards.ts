import { resolve } from "node:path";
import { verifyShardEvidence, type ShardEvidence } from "./e2e-shard-evidence";

const directories = process.argv.slice(2);
const shards: ShardEvidence[] = await Promise.all(
  directories.map(async (directory) => ({
    inventory: await Bun.file(resolve(directory, "inventory.json")).json(),
    outcomes: await Bun.file(resolve(directory, "outcomes.json")).json(),
    execution: await Bun.file(resolve(directory, "execution.json")).json(),
  })),
);
console.log(JSON.stringify(verifyShardEvidence(shards), null, 2));
