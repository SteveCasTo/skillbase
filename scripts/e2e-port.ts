export function e2ePort(): number {
  const value = process.env.E2E_SERVER_PORT ?? "4321";
  const port = Number(value);
  if (
    !/^\d+$/u.test(value) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("Invalid E2E_SERVER_PORT");
  return port;
}
export function e2eSiteUrl(): string {
  return `http://127.0.0.1:${e2ePort()}`;
}
