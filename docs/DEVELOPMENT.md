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
bun run db:seed:demo

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

En un clon nuevo de `development` (Git, Node.js 24.x, Bun 1.4.2 y Docker funcionando):

```sh
git clone -b development <URL_DEL_REPOSITORIO>
cd SkillBase
bun install --frozen-lockfile
bun -e "await Bun.write('.env', Bun.file('.env.example'))"
```

Editar `.env`: configurar `DEV_INITIAL_ADMIN_EMAIL` con el correo de Google del administrador y sustituir `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` y `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` por credenciales reales. En Google autorizar `http://127.0.0.1:54321/auth/v1/callback` como callback de Supabase local. Con Docker encendido:

```sh
bun run setup
bun run supabase:status
```

`setup` crea `.env` solo si falta, instala Chromium, inicia Supabase, **borra los datos anteriores de la base local** mediante `db:reset`, aplica migraciones y carga los formatos acordados. Del resultado de `supabase:status`, copiar exclusivamente la clave **Publishable** a `PUBLIC_SUPABASE_PUBLISHABLE_KEY` en `.env`; la clave Secret no va en una variable pública. Después ejecutar `bun run dev`. La invitación ADMIN se creó durante el setup si el correo se configuró antes; si se añadió después, ejecutar `bun run db:seed`. El login manual se realiza en `/login` con ese mismo correo Google. Sin credenciales OAuth válidas se pueden probar las páginas públicas, pero no entrar a `/app` mediante Google.

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
bun run db:migrate
bun run dev
```

No levantar PostgreSQL adicional.

`bun run dev` inicia Astro en `http://127.0.0.1:4321` con las variables de `.env` cargadas en el proceso servidor (incluida `DATABASE_URL`, necesaria para `/app` y la oferta pública). Si se usa Supabase local, obtiene su credencial de Storage solo en el proceso servidor para la carga de fotografías; no la imprime ni la envía al navegador. Detener Astro con `Ctrl+C` no detiene Supabase. Para conservar datos existentes, usar `bun run db:migrate` en lugar de `bun run db:reset`.

Para poblar un entorno **exclusivamente local** con ejemplos reales visibles en la landing, catálogo y administración, ejecutar `bun run db:seed:demo` después de las migraciones. El comando aplica el seed base (formatos 20 h: Bs 80/100, 30 h: Bs 120/150 e invitación opcional), añade cuatro cursos publicados y un borrador con fechas relativas a la ejecución, y no duplica cursos al repetirse. Los slugs `demo-*` reservados se omiten si ya existen; los cursos existentes nunca se reemplazan. El destacado demo solo se marca si no hay ya otro publicado destacado. No se crean usuarios Auth, contraseñas ni datos personales reales. Las fechas del ejemplo se mantienen en la primera ejecución; ejecutar de nuevo no las renueva. Evitar ejecutar suites de integración/E2E en la misma base poblada manualmente: los tests usan fixtures propios y un destacado singleton.

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
- `bun run db:seed` agrega formatos de ejemplo editables (20 h: Bs 80/100; 30 h: Bs 120/150) y preaprovisiona opcionalmente una invitación ADMIN cuando `DEV_INITIAL_ADMIN_EMAIL` está configurado. Se puede repetir si esa cuenta ya está activa. Los importes son defaults locales, no reglas comerciales universales.
- `bun run db:seed:demo` carga además cursos ficticios de desarrollo, con validación explícita de que `DATABASE_URL` coincide con el Supabase local en ejecución. No borra datos y puede repetirse.
- El `Dockerfile` ofrece un contenedor mínimo de desarrollo. Supabase sigue siendo administrado exclusivamente por su CLI; no existe un segundo `docker-compose`.

## AUTH LOCAL DE FASE 1

Después de `bun run supabase:start` y `bun run db:reset`, se puede crear una invitación de desarrollo configurando `DEV_INITIAL_ADMIN_EMAIL` en el `.env` ignorado. El seed no crea una identidad Auth ni almacena contraseñas.

Para preaprovisionar cualquier entorno de forma explícita se utiliza:

```text
DATABASE_URL=... PREPROVISION_EMAIL=... PREPROVISION_NAME=... PREPROVISION_ROLES=ADMIN,INSTRUCTOR bun run user:preprovision
```

El comando crea o completa una invitación; no vincula UUIDs ni administra `auth.users`. En cloud debe ejecutarse con variables seguras y una conexión autorizada, nunca con valores versionados.

Solo una fila `INVITED` y sin vínculo Auth puede editarse mediante preaprovisionamiento. Los roles solicitados reemplazan atómicamente el conjunto anterior; una fila `ACTIVE`, `DISABLED` o vinculada se rechaza para evitar cambios accidentales sobre cuentas operativas.

Variables relevantes:

- `PUBLIC_SITE_URL`, `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: configuración pública Auth.
- `DATABASE_URL`: runtime server-side; usar pooler cuando corresponda en Vercel.
- `MIGRATION_DATABASE_URL`: conexión directa para migraciones.
- variables `SUPABASE_AUTH_EXTERNAL_GOOGLE_*`: configuración local del provider; el secret solo vive en `.env`.

La allowlist local y toda navegación usan `127.0.0.1`; no mezclar con `localhost` porque cambia origen y cookies.

## E2E LOCAL Y STORAGE

`bun run test:e2e` consulta el entorno de Supabase local y ejecuta `scripts/run-e2e.ts`, que entrega sus credenciales de test al proceso Playwright. El server E2E obtiene variables de base/Auth y una `SUPABASE_SERVICE_ROLE_KEY` local para cubrir el upload de artwork; esa key no se añade a `.env.example`, no se imprime y no llega al navegador. No reutilizar esta ruta de credenciales para producción.

Los E2E comparten estado en una base local y los fixtures incluyen un único curso destacado. Por eso `playwright.config.ts` limita los workers a uno y desactiva la ejecución totalmente paralela. Debe iniciarse/resetearse Supabase local de acuerdo con los comandos de Testing antes de ejecutar pruebas de integración o E2E.
