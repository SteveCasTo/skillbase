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

### Ramas por categoría

Crear ramas desde `development` según el tipo de cambio y mantener cada PR cohesivo:

- `feature/...`
- `fix/...`
- `refactor/...`
- `chore/...`
- `docs/...`
- `test/...`

## FLUJO

```text
feature/* | fix/* | refactor/* | chore/* | docs/* | test/*
→ Pull Request
→ development
→ validación del milestone
→ Pull Request de release
→ master
→ CI
→ migraciones
→ deploy
```

Todos los cambios se integran mediante PR hacia `development`. La promoción a `master` se realiza únicamente mediante PR de release de un milestone validado, no por cada bloque individual ni con pendientes de gate ocultos. No desarrollar directamente en `master`.

## ORQUESTACIÓN Y TRABAJO PARALELO

El orquestador prioriza el uso de subagentes para bloques independientes y conserva la responsabilidad de coordinar dependencias, revisión e integración.

1. Definir el alcance, los criterios de aceptación y las dependencias de cada bloque.
2. Confirmar y estabilizar contratos compartidos (tipos, DTO, operaciones y errores) antes de paralelizar tareas dependientes. No repartir decisiones pendientes como si fueran contratos aprobados.
3. Asignar ownership disjunto por archivos o módulos a cada subagente, con entregables y pruebas explícitos. Evitar escrituras simultáneas sobre los mismos archivos; cualquier cambio de ownership debe coordinarse.
4. Implementar pruebas unitarias junto a la lógica de cada bloque e integración junto a persistencia y permisos. No posponer esta cobertura hasta el cierre.
5. Añadir E2E cuando el flujo esté estabilizado, sin retrasar las pruebas unitarias ni usar E2E para sustituirlas.
6. Revisar cada bloque antes de integrarlo y resolver conjuntamente los hallazgos entre el orquestador y los responsables afectados; volver a verificar tras las correcciones.
7. Integrar mediante ramas y PR por categoría hacia `development`, y ejecutar el gate conjunto antes de preparar la release del milestone hacia `master`.

Si los contratos o el ownership no permiten trabajo independiente, estabilizar primero ese bloque en lugar de forzar paralelismo. Cada entrega debe indicar archivos modificados, pruebas ejecutadas, resultados y pendientes, sin declarar verificaciones no realizadas.

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

Editar `.env`: configurar `DEV_INITIAL_ADMIN_EMAIL` con el correo de Google del administrador y sustituir `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` y `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` por credenciales reales. En Google autorizar `http://127.0.0.1:55321/auth/v1/callback` como callback de Supabase local, conservando los callbacks existentes de otros entornos. Con Docker encendido:

```sh
bun run setup
bun run supabase:status
```

`setup` crea `.env` solo si falta, instala Chromium, inicia Supabase local, **reinicia destructivamente la base local** mediante `db:reset`, aplica migraciones y carga los formatos acordados. No ejecutes este setup para conservar datos de un stack local ya existente: para aplicar cambios de schema sin borrar su contenido, inicia Supabase si hace falta y ejecuta `bun run db:migrate`. Del resultado de `supabase:status`, copiar exclusivamente la clave **Publishable** a `PUBLIC_SUPABASE_PUBLISHABLE_KEY` en `.env`; la clave Secret no va en una variable pública. Después ejecutar `bun run dev`. La invitación ADMIN se creó durante el setup si el correo se configuró antes; si se añadió después, ejecutar `bun run db:seed`. El login manual se realiza en `/login` con ese mismo correo Google. Sin credenciales OAuth válidas se pueden probar las páginas públicas, pero no entrar a `/app` mediante Google.

No requerir crear tablas manualmente desde Dashboard.

## VARIABLES DE ENTORNO

Mantener:

- `.env.example`
- archivos locales ignorados por Git.

Nunca commit de secretos.

Separar variables públicas y privadas.

## SUPABASE LOCAL

Los puertos canónicos son API `55321` y PostgreSQL `55322`, definidos en `supabase/config.toml` y `.env.example`. Se movieron desde `54321`/`54322` porque Windows reservó el rango TCP `54296–54395`. La aplicación sigue en `http://127.0.0.1:4321`. En instalaciones existentes, actualizar las URLs locales del `.env` ignorado y los bindings de los contenedores preservando los volúmenes, Auth, Storage y el ledger; **no ejecutar setup/reset ni reescribir hashes históricos** para cambiar puertos. El callback nuevo debe autorizarse manualmente en Google; cambiar puertos no acredita OAuth real ni modifica cloud.

Utilizar Supabase CLI del proyecto.

Flujo habitual:

```text
bun run supabase:start
bun run db:migrate
bun run dev
```

No levantar PostgreSQL adicional.

`bun run dev` inicia Astro en `http://127.0.0.1:4321` con las variables de `.env` cargadas en el proceso servidor (incluida `DATABASE_URL`, necesaria para `/app` y la oferta pública). Si se usa Supabase local, obtiene su credencial de Storage solo en el proceso servidor para la carga de fotografías; no la imprime ni la envía al navegador. Detener Astro con `Ctrl+C` no detiene Supabase. Para conservar datos existentes, usar `bun run db:migrate` en lugar de `bun run db:reset`.

Para poblar un entorno **exclusivamente local** con ejemplos visibles en landing, catálogo y administración, ejecutar `bun run db:seed:demo` después de las migraciones. El comando aplica el seed base (formatos 20 h: Bs 80/100, 30 h: Bs 120/150 e invitación opcional), añade cuatro cursos publicados y un borrador con grupos iniciales, y no duplica cursos al repetirse. Los slugs `demo-*` reservados se omiten si ya existen; no modifica cursos, grupos ni fechas ya existentes. Por tanto, las filas demo existentes son históricas: conservarán sus datos previos y el operador debe **no reiniciar ni resetear la base** para intentar actualizarlas. El seed añade solo slugs que falten; tampoco renueva las fechas en ejecuciones posteriores. El destacado demo solo se marca si no hay ya otro publicado destacado. No se crean usuarios Auth, contraseñas ni datos personales reales. Las suites de integración y E2E no utilizan este stack: cada ejecución crea y elimina su propio Supabase temporal aislado.

Para reconciliar **únicamente los cinco cursos demo ya existentes** sin perder fotografías, textos ni estado, usar `bun scripts/reconcile-demo-courses.ts` (solo muestra preview, no escribe). Examinar los IDs, fechas anteriores y nuevas, capacidades y estado de los cinco; si algún slug falta, hay grupos existentes inesperados, una revisión no tiene `session_minutes`, o las fechas fijas (noviembre–diciembre 2026) ya pasaron, el script aborta. Nunca ejecutar `db:reset` para resolverlo. Solo tras revisar el preview y autorizarlo explícitamente ejecutar `bun scripts/reconcile-demo-courses.ts --apply --actor-id <UUID_ADMIN_ACTIVO>`; el actor **obligatorio** debe ser un administrador activo de esta base local y la migración 0009 debe estar aplicada (sin reiniciar la base). Antes de escribir, el script guarda filas completas de los cinco cursos, revisiones vinculadas, grupos y auditorías asociadas en un archivo privado dentro del directorio temporal **fuera del repositorio**; imprime su ruta al finalizar. La transacción bloquea los cursos y escribe solo horario, planificación L–V, fechas y ventana de inscripción más los grupos; todo lo demás permanece intacto. Los grupos publicados registran `published_at` y auditoría `GROUP_CREATED` con ese actor; el grupo del borrador conserva `published_at = null`. El seed ordinario sigue siendo insert-only: en ausencia de un actor humano no genera eventos de auditoría pero sí marca la exposición inicial de sus grupos publicados. Repetir la reconciliación tras aplicarla no escribe ni duplica grupos. Este flujo no sirve para cursos reales, cloud o actualización periódica; si el preview falla, detenerse y resolver el conflicto manualmente antes de cualquier aplicación.

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

`bun run test:integration` y `bun run test:e2e` crean cada uno un proyecto Supabase temporal propio mediante el runner documentado en `docs/TESTING.md`. No inician, reinician ni escriben en el Supabase de desarrollo, la base configurada en `.env` ni un stack local poblado con datos manuales. Los fixtures Auth, los cursos y los objetos de Storage de test quedan circunscritos al proyecto temporal, que se detiene y elimina al terminar. La `SUPABASE_SERVICE_ROLE_KEY` temporal solo se entrega a procesos de test/server E2E y nunca al navegador; no reutilizar este flujo de credenciales para producción.

Antes de esta separación, fixtures de pruebas podían contaminar el Supabase local compartido y algunas preparaciones de suite eliminaban datos de ese entorno. `bun run db:cleanup:legacy-test` es una limpieza **opcional** y acotada de perfiles y usuarios Auth sintéticos de test heredados: solo acepta el Supabase local en ejecución, verifica nombres de perfil exactos y no elimina cursos, formatos ni auditoría. No restaura filas o contenido borrados anteriormente ni recupera datos; solo debe usarse si se desea retirar esos fixtures heredados del entorno local.
