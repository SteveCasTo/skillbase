/** Isolated automated suites must never authenticate to or send through real SMTP. */
export function withoutExternalSmtp(config: string): string {
  return config.replace(
    /^\[auth\.email\.smtp\]\r?\n[^]*?(?=^\[|$(?![^]))/mu,
    "",
  );
}
