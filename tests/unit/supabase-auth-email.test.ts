import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withoutExternalSmtp } from "../../scripts/supabase-test-email";

const config = readFileSync(
  new URL("../../supabase/config.toml", import.meta.url),
  "utf8",
);
const template = readFileSync(
  new URL("../../supabase/templates/recovery.html", import.meta.url),
  "utf8",
);

describe("Supabase Auth email configuration", () => {
  test("automated stacks cannot use the external SMTP transport or credentials", () => {
    const isolated = withoutExternalSmtp(config);
    expect(isolated).not.toContain("[auth.email.smtp]");
    expect(isolated).not.toContain("SUPABASE_AUTH_SMTP_");
    expect(isolated).toContain("[auth.email.template.recovery]");
    expect(isolated).toContain("[auth.hook.before_user_created]");
    expect(isolated).toContain("secure_password_change = true");
  });

  test("SMTP section at end of config is removed too", () => {
    expect(
      withoutExternalSmtp(
        "[auth]\nenabled = true\n[auth.email.smtp]\nenabled = true\n",
      ),
    ).toBe("[auth]\nenabled = true\n");
  });

  test("recovery contains one provider-generated verification link, not a direct session or redirect", () => {
    expect(template.match(/href=/gu)).toHaveLength(1);
    expect(template).toContain('href="{{ .ConfirmationURL }}"');
    expect(template).not.toContain(".RedirectTo");
    expect(template).not.toContain(".Data");
    expect(template).not.toContain(".Token");
    expect(template).toContain("Restablecer contraseña");
    expect(template).toContain("Si no hiciste esta solicitud");
    expect(template).toContain('lang="es"');
  });
});
