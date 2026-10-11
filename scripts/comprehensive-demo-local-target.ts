import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fingerprint } from "./financial-demo-plan";
import { getLocalSupabaseEnvironment } from "./supabase-local-env";

/** Explicit compatibility for the approved canonical project, not a port-only
 * classification of arbitrary loopback databases. Never changes configuration. */
export function reviewedComprehensiveLocalTarget(
  workdir: string,
  expectedApi: string,
  databaseUrl: string,
  apiUrl: string,
) {
  if (
    !["http://127.0.0.1:54321", "http://127.0.0.1:55321"].includes(expectedApi)
  )
    throw new Error("Explicit approved canonical local API required");
  const directory = resolve(workdir);
  const configuration = readFileSync(
    join(directory, "supabase", "config.toml"),
    "utf8",
  );
  const project = configuration.match(/^project_id = "([^"]+)"/mu)?.[1];
  const apiPort = configuration.match(
    /^\[api\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu,
  )?.[1];
  const dbPort = configuration.match(
    /^\[db\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu,
  )?.[1];
  const db = new URL(databaseUrl);
  if (
    project !== "skillbase" ||
    dbPort !== "55322" ||
    `http://127.0.0.1:${apiPort}` !== expectedApi ||
    apiUrl !== expectedApi ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    db.hostname !== "127.0.0.1" ||
    db.port !== dbPort ||
    db.pathname !== "/postgres" ||
    db.username !== "postgres" ||
    db.search ||
    db.hash
  )
    throw new Error(
      "Reviewed canonical local configuration does not match destination",
    );
  const running = getLocalSupabaseEnvironment(directory);
  if (running.databaseUrl !== databaseUrl || running.apiUrl !== expectedApi)
    throw new Error(
      "Running canonical project does not match reviewed configuration",
    );
  return {
    projectId: project,
    databaseOrigin: "postgresql://127.0.0.1:55322/postgres",
    apiOrigin: expectedApi,
    verificationOrigin: "http://127.0.0.1:4321",
    configurationHash: fingerprint(configuration),
  };
}
