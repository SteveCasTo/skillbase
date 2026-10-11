import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  configureLocalAuth,
  validateLocalAuthTarget,
} from "./local-auth-config";

const { values } = parseArgs({
  options: { workdir: { type: "string", default: process.cwd() } },
});
const workdir = values.workdir!;
validateLocalAuthTarget(workdir);

// Use only as the coordinated local start entrypoint; test runners are separate.
const result = spawnSync(
  process.execPath,
  [
    "x",
    "supabase",
    "start",
    "--workdir",
    workdir,
    "--exclude",
    "realtime,imgproxy,studio,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta",
  ],
  { stdio: "pipe", timeout: 300_000 },
);
if (result.status !== 0)
  throw new Error("Local Supabase start failed; provider output withheld.");
await configureLocalAuth("apply", workdir);
