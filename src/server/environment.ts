export interface EnvironmentSource {
  readonly [key: string]: string | undefined;
}

export interface PublicAuthEnvironment {
  readonly siteUrl: URL;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

export interface ServerEnvironment extends PublicAuthEnvironment {
  readonly databaseUrl: string;
}

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validUrl(value: string, name: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error();
    return url;
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

export function readPublicAuthEnvironment(
  source: EnvironmentSource,
): PublicAuthEnvironment {
  const siteUrl = validUrl(
    required(source, "PUBLIC_SITE_URL"),
    "PUBLIC_SITE_URL",
  );
  const supabaseUrl = validUrl(
    required(source, "PUBLIC_SUPABASE_URL"),
    "PUBLIC_SUPABASE_URL",
  );

  return {
    siteUrl,
    supabaseUrl: supabaseUrl.origin,
    supabasePublishableKey: required(source, "PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function readServerEnvironment(
  source: EnvironmentSource,
): ServerEnvironment {
  return {
    ...readPublicAuthEnvironment(source),
    databaseUrl: required(source, "DATABASE_URL"),
  };
}

export function getServerEnvironment(): ServerEnvironment {
  return readServerEnvironment(import.meta.env);
}
