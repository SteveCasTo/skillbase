import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const setting = "GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD";
const content = `${setting}=true\n`;
const digest = createHash("sha256").update(content).digest("hex");
const disabledContent = `${setting}=false\n`;
const disabledDigest = createHash("sha256")
  .update(disabledContent)
  .digest("hex");
const image = "public.ecr.aws/supabase/gotrue:v2.196.0";

interface Target {
  project: string;
  container: string;
  apiPort: number;
  directory: string;
}
interface Receipt {
  phase: "pending" | "applied" | "rolledback";
  project: string;
  containerId: string;
  imageId: string;
  hash: string;
  startedAt: string;
}
interface Container {
  Id: string;
  Image: string;
  Name: string;
  Config: {
    Image: string;
    WorkingDir: string;
    User: string;
    Cmd: string[];
    Entrypoint: string[] | null;
    Env: string[];
    Labels?: Record<string, string> | null;
  };
  Mounts: unknown[];
  State: { Running: boolean; StartedAt: string };
}

// Never include child output in errors: inspect contains provider credentials.
function docker(args: string[], input?: Uint8Array): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 60_000,
    input,
  });
  if (result.status !== 0)
    throw new Error("Native Auth Docker operation failed; output withheld.");
  return result.stdout.trim();
}

/** A single regular .env entry, fixed service UID/GID and non-executable readonly mode.
 * Windows docker cp otherwise derives Unix mode from host ACLs inconsistently.
 * No paths, metadata, executable bytes or secrets are accepted from callers. */
function nativeArchive(enabled: boolean): Uint8Array {
  const literal = new TextEncoder().encode(enabled ? content : disabledContent);
  const archive = new Uint8Array(2048);
  const header = archive.subarray(0, 512);
  const field = (offset: number, text: string) =>
    header.set(new TextEncoder().encode(text), offset);
  field(0, ".env");
  field(100, "0000444\0");
  field(108, "0001750\0"); // UID 1000: the pinned image's original supabase user.
  field(116, "0001750\0");
  field(124, `${literal.length.toString(8).padStart(11, "0")}\0`);
  field(136, "00000000000\0");
  field(148, "        ");
  field(156, "0");
  field(257, "ustar\0");
  field(263, "00");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  field(148, `${checksum.toString(8).padStart(6, "0")}\0 `);
  archive.set(literal, 512);
  return archive;
}

function target(workdir: string): Target {
  const config = readFileSync(
    join(resolve(workdir), "supabase", "config.toml"),
    "utf8",
  );
  const project = config.match(/^project_id = "([a-zA-Z0-9_-]+)"$/mu)?.[1];
  const apiPort = Number(
    config.match(/^\[api\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu)?.[1],
  );
  const dbPort = Number(
    config.match(/^\[db\]\s*\n(?:[^\n]*\n)*?port = (\d+)/mu)?.[1],
  );
  const isolated = project && /^skillbase_test_[a-f0-9]{16}$/u.test(project);
  if (
    !isolated &&
    (process.env.CI ||
      process.env.VERCEL ||
      process.env.NODE_ENV === "production")
  )
    throw new Error(
      "Canonical native Auth configuration is local development only.",
    );
  if (
    !project ||
    !(project === "skillbase" || isolated) ||
    !Number.isInteger(apiPort) ||
    !Number.isInteger(dbPort)
  )
    throw new Error(
      "Native Auth requires the known local project or an owned isolated test project.",
    );
  if (
    isolated &&
    ([4321, 54321, 55321].includes(apiPort) || [54322, 55322].includes(dbPort))
  )
    throw new Error("Isolated native Auth cannot use canonical ports.");
  if (!isolated && (![54321, 55321].includes(apiPort) || dbPort !== 55322))
    throw new Error(
      "Canonical native Auth ports do not match the approved configuration.",
    );
  return {
    project,
    container: `supabase_auth_${project}`,
    apiPort,
    directory: join(tmpdir(), "opencode", "skillbase-native-auth", project),
  };
}

export function validateLocalAuthTarget(workdir = process.cwd()): void {
  target(workdir);
}

function inspect(value: Target): Container {
  let parsed: unknown;
  try {
    parsed = JSON.parse(docker(["inspect", value.container]));
  } catch {
    throw new Error("Native Auth container identity is unavailable.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1)
    throw new Error("Native Auth container identity is unavailable.");
  const container = parsed[0] as Container;
  if (
    container.Name !== `/${value.container}` ||
    container.Config?.Image !== image ||
    container.Config.Labels?.["com.supabase.cli.project"] !== value.project ||
    !container.State?.Running ||
    container.Config.WorkingDir !== "/" ||
    container.Config.User !== "supabase" ||
    container.Config.Cmd?.length !== 1 ||
    !["auth", "/usr/local/bin/auth"].includes(container.Config.Cmd[0]!) ||
    (container.Config.Entrypoint?.length ?? 0) !== 0 ||
    container.Mounts?.length !== 0 ||
    !Array.isArray(container.Config.Env) ||
    container.Config.Env.some((entry) => entry.startsWith(`${setting}=`)) ||
    !/^[a-f0-9]{64}$/u.test(container.Id) ||
    typeof container.Image !== "string" ||
    !Number.isFinite(Date.parse(container.State.StartedAt))
  )
    throw new Error(
      "Native Auth image, environment, process or container preconditions changed.",
    );
  const process = docker([
    "exec",
    value.container,
    "sh",
    "-c",
    "readlink /proc/1/exe; readlink /proc/1/cwd",
  ]);
  if (process !== "/usr/local/bin/auth\n/")
    throw new Error("Native Auth process is not the supported default loader.");
  if (
    docker(["exec", value.container, "sh", "-c", "id -u; id -g"]) !==
    "1000\n1000"
  )
    throw new Error(
      "Native Auth service user changed from the pinned image's nonprivileged identity.",
    );
  return container;
}

function nativeHash(value: Target): string | null {
  const result = docker([
    "exec",
    value.container,
    "sh",
    "-c",
    "if [ -L /.env ]; then echo INVALID; elif [ ! -e /.env ]; then echo ABSENT; elif [ ! -f /.env ]; then echo INVALID; else stat -c '%u:%g:%a' /.env; sha256sum /.env; fi",
  ]);
  if (result === "ABSENT") return null;
  if (result === `1000:1000:444\n${digest}  /.env`) return digest;
  if (result === `1000:1000:444\n${disabledDigest}  /.env`)
    return disabledDigest;
  throw new Error(
    "Native Auth configuration is not the owned regular single-key file.",
  );
}

function receipt(value: Target): Receipt | null {
  const file = join(value.directory, "receipt.json");
  let stat;
  try {
    if (lstatSync(value.directory).isSymbolicLink())
      throw new Error("Native Auth state directory cannot be a symlink.");
    stat = lstatSync(file);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw new Error("Native Auth receipt is unavailable.");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
    throw new Error("Native Auth receipt must be a bounded regular file.");
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!data || typeof data !== "object")
    throw new Error("Native Auth receipt is invalid.");
  const result = data as Receipt;
  if (
    !["pending", "applied", "rolledback"].includes(result.phase) ||
    result.project !== value.project ||
    result.hash !== digest ||
    !/^[a-f0-9]{64}$/u.test(result.containerId) ||
    typeof result.imageId !== "string" ||
    !Number.isFinite(Date.parse(result.startedAt))
  )
    throw new Error("Native Auth receipt is invalid.");
  return result;
}

function validateSource(value: Target, enabled = true): string {
  const source = join(value.directory, enabled ? "native.env" : "disabled.env");
  const literal = enabled ? content : disabledContent;
  const hash = enabled ? digest : disabledDigest;
  const stat = lstatSync(source);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size !== Buffer.byteLength(literal) ||
    (stat.mode & 0o222) !== 0 ||
    createHash("sha256").update(readFileSync(source, "utf8")).digest("hex") !==
      hash
  )
    throw new Error(
      "Native Auth source must contain only the owned literal setting.",
    );
  return source;
}

function saveReceipt(
  value: Target,
  container: Container,
  phase: Receipt["phase"],
): void {
  const result: Receipt = {
    phase,
    project: value.project,
    containerId: container.Id,
    imageId: container.Image,
    hash: digest,
    startedAt: container.State.StartedAt,
  };
  writeFileSync(join(value.directory, "receipt.json"), JSON.stringify(result), {
    mode: 0o600,
  });
}

async function health(value: Target): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${value.apiPort}/auth/v1/health`,
        { signal: AbortSignal.timeout(2000) },
      );
      const body: unknown = await response.json();
      if (
        response.ok &&
        body &&
        typeof body === "object" &&
        "version" in body &&
        body.version === "v2.196.0"
      )
        return;
    } catch {
      /* Auth alone is starting; no provider error content is logged. */
    }
    await Bun.sleep(500);
  }
  throw new Error(
    "Native Auth did not become healthy at its unchanged local endpoint.",
  );
}

async function verifyConfiguration(
  workdir = process.cwd(),
  ownedLock = false,
): Promise<void> {
  const value = target(workdir);
  if (!ownedLock) {
    try {
      lstatSync(join(value.directory, "operation.lock"));
      throw new Error(
        "Native Auth configuration is being changed; local QA is blocked.",
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  const container = inspect(value);
  const saved = receipt(value);
  if (
    !saved ||
    saved.phase !== "applied" ||
    saved.containerId !== container.Id ||
    saved.imageId !== container.Image ||
    nativeHash(value) !== digest ||
    Date.parse(container.State.StartedAt) < Date.parse(saved.startedAt)
  )
    throw new Error(
      "Local Auth native control is not configured for this container startup. Run the coordinated local Auth launcher first.",
    );
  validateSource(value);
  await health(value);
}

export async function verifyLocalAuthConfiguration(
  workdir = process.cwd(),
): Promise<void> {
  return verifyConfiguration(workdir);
}

async function runConfiguration(
  action: "plan" | "apply" | "verify" | "rollback",
  workdir = process.cwd(),
): Promise<void> {
  const value = target(workdir);
  const container = inspect(value);
  const hash = nativeHash(value);
  const saved = receipt(value);
  if (
    hash &&
    (!saved ||
      saved.containerId !== container.Id ||
      saved.imageId !== container.Image)
  )
    throw new Error(
      "Native Auth file exists without matching ownership; refusing to overwrite it.",
    );
  if (
    hash &&
    ((saved?.phase === "applied" && hash !== digest) ||
      (saved?.phase === "rolledback" && hash !== disabledDigest))
  )
    throw new Error(
      "Native Auth file does not match its recorded configuration phase.",
    );
  if (action === "plan") {
    console.log(
      JSON.stringify({
        project: value.project,
        action,
        nativeFile: hash ? "owned" : "absent",
        restart:
          hash === digest && saved?.phase === "applied"
            ? false
            : "Auth only after coordination",
      }),
    );
    return;
  }
  if (action === "verify") return verifyLocalAuthConfiguration(workdir);
  if (action === "apply" && hash && saved?.phase === "applied")
    return verifyConfiguration(workdir, true);
  if (
    action === "rollback" &&
    !hash &&
    !(
      saved?.phase === "pending" &&
      saved.containerId === container.Id &&
      saved.imageId === container.Image
    )
  )
    throw new Error("No owned native Auth configuration to roll back.");

  mkdirSync(value.directory, { recursive: true, mode: 0o700 });
  if (lstatSync(value.directory).isSymbolicLink())
    throw new Error("Native Auth state directory cannot be a symlink.");
  const enabled = action === "apply";
  const source = join(value.directory, enabled ? "native.env" : "disabled.env");
  const literal = enabled ? content : disabledContent;
  const expected = enabled ? digest : disabledDigest;
  try {
    validateSource(value, enabled);
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
    writeFileSync(source, literal, { flag: "wx", mode: 0o444 });
    chmodSync(source, 0o444);
  }
  validateSource(value, enabled);
  // Serialized operator-owned archive installation. Auth never runs as root and
  // no executable, app .env or credential is copied. Do not run other Docker
  // operators concurrently: archive extraction has no cross-operator CAS API.
  if (inspect(value).Id !== container.Id || nativeHash(value) !== hash)
    throw new Error(
      "Native Auth identity or file changed before installation.",
    );
  saveReceipt(value, container, "pending");
  docker(["cp", "--archive", "-", `${container.Id}:/`], nativeArchive(enabled));
  if (nativeHash(value) !== expected)
    throw new Error("Native Auth file installation failed.");
  if (inspect(value).Id !== container.Id || nativeHash(value) !== expected)
    throw new Error(
      "Native Auth project identity or file changed before restart.",
    );
  docker(["restart", "--timeout", "10", container.Id]);
  await health(value);
  const restarted = inspect(value);
  if (
    restarted.Id !== container.Id ||
    restarted.Image !== container.Image ||
    restarted.State.StartedAt === container.State.StartedAt
  )
    throw new Error(
      "Native Auth restart did not preserve container/image identity.",
    );
  if (action === "rollback") {
    if (nativeHash(value) !== disabledDigest)
      throw new Error(
        "Native Auth rollback did not restore the native false control.",
      );
    saveReceipt(value, restarted, "rolledback");
  } else {
    saveReceipt(value, restarted, "applied");
    await verifyConfiguration(workdir, true);
  }
  console.log(
    JSON.stringify({
      project: value.project,
      action,
      sameContainer: true,
      healthy: true,
    }),
  );
}

export async function configureLocalAuth(
  action: "plan" | "apply" | "verify" | "rollback",
  workdir = process.cwd(),
): Promise<void> {
  if (action === "plan" || action === "verify")
    return runConfiguration(action, workdir);
  const value = target(workdir);
  mkdirSync(value.directory, { recursive: true, mode: 0o700 });
  if (lstatSync(value.directory).isSymbolicLink())
    throw new Error("Native Auth state directory cannot be a symlink.");
  const lock = join(value.directory, "operation.lock");
  mkdirSync(lock, { mode: 0o700 }); // Exclusive cooperative operator lock; never force stale locks.
  try {
    await runConfiguration(action, workdir);
  } finally {
    rmdirSync(lock);
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        action: { type: "string", default: "plan" },
        workdir: { type: "string", default: process.cwd() },
      },
    });
    if (!["plan", "apply", "verify", "rollback"].includes(values.action!))
      throw new Error("Unknown native Auth action.");
    await configureLocalAuth(
      values.action as "plan" | "apply" | "verify" | "rollback",
      values.workdir,
    );
  } catch {
    console.error(
      "Native Auth configuration failed closed; no provider output or credentials are logged.",
    );
    process.exitCode = 1;
  }
}
