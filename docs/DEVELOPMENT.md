# DEVELOPMENT

## OBJETIVO

Definir un flujo de desarrollo reproducible para todos los integrantes del equipo.

## PRERREQUISITOS

- Git.
- Bun.
- Docker.
- GitHub CLI cuando se requiera interacción avanzada con GitHub.

No asumir instalaciones globales de:

- Supabase CLI;
- Vercel CLI.

Estas herramientas deben quedar gestionadas por el proyecto cuando sea viable.

## RAMAS

### `development`

Rama principal de trabajo.

Las features se integran aquí.

### `master`

Producción.

No desarrollar directamente sobre esta rama.

### Convención sugerida

- `feature/...`
- `fix/...`
- `refactor/...`
- `chore/...`
- `docs/...`
- `test/...`

## FLUJO

```text
feature/*
→ Pull Request
→ development
→ validación
→ Pull Request
→ master
→ CI
→ migraciones
→ deploy
```

## COMMITS

Commits:

- pequeños;
- cohesivos;
- en inglés;
- no mezclar tareas independientes.

Preferir Conventional Commits.

Ejemplos:

```text
feat(courses): add course publication flow
fix(attendance): prevent duplicate attendance records
test(enrollment): cover refund on cancelled group
docs(security): document upload validation rules
refactor(certificates): extract credential verification service
```

Evitar:

```text
update stuff
fix
changes
final version
```

## PACKAGE.JSON COMO INTERFAZ

El equipo no debe memorizar herramientas internas.

Scripts esperados:

```text
bun run setup
bun run dev
bun run build

bun run supabase:start
bun run supabase:stop
bun run db:reset
bun run db:migrate
bun run db:seed

bun run lint
bun run format
bun run format:check
bun run typecheck
bun run check

bun run test
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:all

bun run vercel:link
```

Los nombres definitivos pueden ajustarse, pero deben ser consistentes y documentados.

## SETUP INICIAL

Objetivo:

```text
git clone
→ bun install
→ bun run setup
→ bun run dev
```

`setup` debe automatizar todo lo razonable.

No requerir crear tablas manualmente desde Dashboard.

## VARIABLES DE ENTORNO

Mantener:

- `.env.example`
- archivos locales ignorados por Git.

Nunca commit de secretos.

Separar variables públicas y privadas.

## SUPABASE LOCAL

Utilizar Supabase CLI del proyecto.

Flujo habitual:

```text
bun run supabase:start
bun run db:reset
bun run dev
```

No levantar PostgreSQL adicional.

## DATOS

Development seed:

- datos cómodos para trabajo manual.

Test fixtures:

- mínimos;
- deterministas;
- aislados.

## MIGRACIONES

Toda modificación de schema debe producir una migración versionada.

No depender de cambios manuales en producción.

Probar migraciones localmente antes de merge.

Después de producción con datos reales, evitar migraciones destructivas directas.

Preferir expand/contract.

## CODE REVIEW

Revisar:

- requisito;
- reglas;
- tipos;
- errores;
- seguridad;
- tests;
- UI;
- responsive;
- accesibilidad;
- migraciones;
- documentación.

## DEFINITION OF DONE

Una tarea no se considera terminada solo porque “funciona”.

Cuando aplique debe:

- compilar;
- pasar lint;
- pasar typecheck;
- pasar tests;
- pasar build;
- funcionar responsive;
- respetar seguridad;
- tener documentación actualizada.

## FOUNDATION IMPLEMENTADA

- Bun está fijado en `package.json` mediante `packageManager` y todas las dependencias tienen versión exacta en `bun.lock`.
- `bun run setup` valida Bun y Docker, crea `.env` desde `.env.example` solo cuando no existe y usa un script TypeScript cross-platform.
- Supabase CLI y Vercel CLI son dependencias locales. Deben ejecutarse mediante los scripts del proyecto.
- Supabase local levanta PostgreSQL, Auth, Storage y el gateway requerido. Realtime, Studio, SMTP local, Edge Runtime, analytics, vector, image proxy, pooler y metadatos UI permanecen desactivados o excluidos.
- `bun run db:generate` genera migraciones Drizzle después de cambiar `src/server/db/schema`.
- `bun run db:migrate` aplica migraciones Drizzle y requiere `DATABASE_URL`.
- `bun run db:reset` reinicia Supabase local, aplica las migraciones Drizzle y ejecuta el seed de desarrollo.
- `bun run db:seed` es intencionalmente vacío hasta que exista un caso de desarrollo real.
- El `Dockerfile` ofrece un contenedor mínimo de desarrollo. Supabase sigue siendo administrado exclusivamente por su CLI; no existe un segundo `docker-compose`.
