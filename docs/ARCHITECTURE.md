# ARCHITECTURE

## OBJETIVO

Definir la arquitectura técnica del sistema, responsabilidades entre capas, estructura del repositorio y reglas para mantener el código desacoplado y mantenible.

## ESTILO ARQUITECTÓNICO

El sistema inicia como un **monolito modular full-stack**.

No se utilizará un backend independiente mientras no exista una necesidad concreta de:

- múltiples clientes independientes;
- API pública significativa para terceros;
- integraciones institucionales complejas;
- procesamiento asíncrono especializado;
- escalado independiente;
- despliegues independientes entre frontend y backend.

Astro actuará como host de la aplicación web y de la capa server-side.

## STACK

### Runtime y tooling

- Bun.

Responsabilidades:

- instalar dependencias;
- ejecutar scripts;
- ejecutar herramientas;
- ejecutar tests unitarios cuando corresponda.

Vite no se considera runtime ni package manager del proyecto. Astro ya utiliza Vite internamente.

### Frontend

- Astro.
- React para componentes interactivos.
- Tailwind CSS.
- shadcn/ui.

Astro debe ser la opción por defecto para contenido estático o renderizado en servidor.

React debe utilizarse cuando exista interacción real del lado cliente.

No convertir páginas completas en React sin necesidad.

### Backend integrado

Astro server-side manejará:

- server actions;
- endpoints;
- coordinación de casos de uso;
- autorización;
- acceso a servicios;
- generación de respuestas.

Los endpoints no deben contener lógica de negocio extensa.

### Base de datos

- PostgreSQL mediante Supabase.
- Drizzle ORM como capa de acceso tipada.

Drizzle se utilizará para:

- schema de aplicación;
- queries;
- repositories;
- migraciones según la estrategia definida.

No acceder directamente a tablas desde componentes React.

### Supabase

Se utilizará para:

- PostgreSQL.
- Auth.
- Google OAuth.
- Storage.
- desarrollo local reproducible mediante Supabase CLI + Docker.

Supabase Realtime no debe utilizarse salvo que exista un caso de uso concreto.

### Storage

Los archivos deben clasificarse por sensibilidad y finalidad.

Ejemplos:

Privados:

- documentos administrativos;
- boletas;
- respaldos;
- certificados aún no emitidos;
- archivos internos.

Públicos o verificables:

- certificados emitidos cuando la política lo permita.

La existencia de un archivo en Storage no determina por sí sola su autorización.

## CAPAS

### Presentation

Responsable de:

- páginas Astro;
- componentes React;
- formularios;
- composición visual;
- interacción del usuario.

No debe contener reglas de negocio.

### Application

Responsable de casos de uso.

Ejemplos:

- CreateCourse.
- PublishCourse.
- CreateGroup.
- RegisterParticipant.
- RecordAttendance.
- ConfigureAssessmentPlan.
- RecordGrade.
- CloseGroup.
- IssueCertificate.
- RevokeCertificate.

### Domain

Responsable de:

- reglas de negocio;
- invariantes;
- políticas;
- cálculos;
- estados.

Debe poder probarse con la menor dependencia de infraestructura posible.

### Infrastructure

Responsable de:

- Drizzle;
- PostgreSQL;
- Supabase;
- Storage;
- generación de archivos;
- servicios externos;
- logging;
- integración OAuth.

## MÓDULOS

La aplicación debe mantener límites claros.

Módulos iniciales:

- Auth
- Users
- Instructors
- Courses
- Groups
- InterestRegistrations
- Participants
- PreRegistrations
- Enrollments
- Sessions
- Attendance
- Assessments
- Grades
- Payments
- Refunds
- Certificates
- Audit

No es obligatorio que cada módulo sea un package independiente.

El objetivo es separación lógica.

Fase 3 implementa `InterestRegistrations` como agregado autónomo: no es `Participant` ni `PreRegistration`, y el email público no verificado no puede actualizar identidad global. El formulario solo aparece en el detalle del curso; la administración (`/app/interesados` y sus detalles UUID) es solo ADMIN. La preinscripción presencial/pagada permanece en Fase 5. Dominio, aplicación, schema/migración y adaptadores viven separados en `src/domain/interests`, `src/application/interests`, `src/server/interests` y `src/server/db/repositories`. PR 105 se integró en `development` y el flujo se liberó posteriormente como parte del cierre de Fase 3; el registro de validación está en `docs/PLAN.md`/`docs/TESTING.md`.

### Instructores y asignación (implementación posterior a PR 126)

El módulo usa límites del monolito modular (`src/domain/instructors`, `src/application/instructors`, `src/server/instructors` y repositorios Drizzle). El perfil comparte ID estable con `users`; Supabase Auth posee credenciales. ADMIN crea/edita instructor y asigna instructor a un curso; los grupos heredan esa relación desde `courses.instructor_id`. Cursos draft admiten asignación opcional; publicar requiere perfil registrado activo. El nombre público de un instructor asignado se proyecta como nombre completo, sin correo/teléfono. La migración aditiva 0014 conserva texto `instructor_name` histórico sin autocorrelación. Las migraciones 0012–0015 se aplicaron en local y producción por PR 126 (ledger 16 en cada entorno).

Las rutas administrativas de instructor/curso permanecen limitadas a ADMIN. La ruta profesional `/app/perfil` y `/app/mis-cursos`/detalle pertenecen a INSTRUCTOR; consultas filtran además por el ID interno autenticado, de modo que una URL directa ajena no revela el curso. Las correcciones PR 134/136 añaden lifecycle de instructor y route guards, sin conceder asistencia/sesiones, formatos, interesados ni mutaciones de participantes. Fase 5 incorpora una consulta de roster minimalista read-only para instructor asignado desde el inicio oficial; no da acceso a datos de contacto/finanzas. Las correcciones de lifecycle preceden al release posterior de Fase 5 (`2e0eecb`); PR 126 sigue siendo la evidencia histórica del release inicial de Fase 4.

La validación del horario del instructor usa el calendario L–V de cada grupo y fechas civiles Bolivia inclusivas, con intervalos diarios semiabiertos. Solo grupos `PLANNED` compiten por el horario, también si el curso está en borrador; cancelar el grupo libera el intervalo. Para evitar carreras entre asignación, edición de fechas, publicación/transiciones y cambios/altas/cancelaciones/reactivaciones de grupos, los repositorios toman una barrera transaccional compartida, adquieren advisory locks de IDs previos/nuevos de instructor en orden estable y después bloquean la fila del curso. La revisión optimista y auditoría/historial se conservan. Lifecycle de instructores se añadió mediante PR 134/136: bloquea desactivar con cursos no archivados asignados y conserva tombstone para borrado seguro de cuentas sin historia. El release inicial PR 126 no incluía esta corrección; el release posterior de Fase 5 (`2e0eecb`, cloud ledger 18) es el boundary de producción vigente.

Los contratos distinguen DTO de formulario público (disponibilidad y horarios elegibles, sin PII/capacidad) y DTOs administrativos de registros/métricas bajo autorización; las preferencias no asignan cupos ni grupos. La administración filtra estado sin derivar métricas del subconjunto mostrado.

### Preinscripciones presenciales y administración financiera (Fase 5, liberada en producción)

El agregado `pre-registrations` sigue los límites del monolito modular: dominio/validaciones puras en `src/domain/pre-registrations`, casos de uso/ports en `src/application/pre-registrations`, y Drizzle/repositorios HTTP/exportes en `src/server/pre-registrations` y `src/server/db/repositories/registration-repository.ts`. Migración 0017 y schema están integrados por PR 173; los casos de uso y repositorio transaccional por PR 176. Los casos de uso validan ADMIN activo, settings/revision, ventana/first-day exception y destino; el repositorio vuelve a verificar el actor/ownership en transacción, serializa cupos, pagos, cancelaciones, transferencias y grupo cancelado. `requestKey`+fingerprint/`registration_command_receipts` mantiene operaciones idempotentes. `registration_settings` es singleton global; el total/precio se snapshottea por registro. El ledger solo admite movimientos positivos PAYMENT/REFUND append-only; la gratuidad no crea movimiento de cero. La interfaz monetaria recibe texto decimal BOB y lo convierte a centavos enteros en dominio. Los renderers CSV/PDF viven en `src/server/pre-registrations/exports`; limitan la exportación a 1000 filas, neutralizan fórmulas en CSV y embeben Noto Sans licenciada en PDF, pero no consultan/autorizan por sí mismos.

PR 178 añadió `/app/configuracion` (SSR/POST/JSON, éxito `{settings}`, error `{code,message,fields}` y conflictos de revisión `409`) con guard ADMIN; PR 179 la registró en `PRIVATE_ROUTE_POLICIES` e integró el resto de páginas/rutas ADMIN de `/app/preinscripciones`, `/app/participantes` y el roster INSTRUCTOR de `/app/mis-cursos/[id]/grupos/[groupId]`. La política es fail-closed; operaciones y repositorios vuelven a autorizar al actor activo. El roster revalida ownership/start server-side y serializa solo nombre/apellidos. En la interfaz, montos se envían como strings BOB decimales y se convierten a centavos en servidor; las mutaciones tienen respuesta discriminada de éxito/error e issues. Los generadores exportan etiquetas de curso/grupo, participante/CI, tipo, estados y montos financieros. El full canonical E2E integrado pasó 125/125; Fase 5 se liberó en producción como `2e0eecb` con cloud ledger 18. Las correcciones UX posteriores se integraron por PRs 197–199; sesiones/asistencia se implementaron después en la sección siguiente.

Corrección post-release en el source actual (`fix/pre-registration-interface`, integrada a `development`): se retiraron las páginas/directorio UI `/app/participantes` y las rutas de edición asociadas. La ficha global se consulta/edita desde las páginas de preinscripción y la operación HTTP se ubica bajo el contexto de preinscripciones; no se conserva una ruta de participantes fantasma solo porque un formulario enviaba POST allí. La política privada, enlaces y skeletons reflejan las rutas presentes. La lógica de identidad, CI, historial financiero y multi-curso sigue en los casos de uso/repositorio existentes; el cambio de pantalla/ruta no reemplaza ni duplica reglas de dominio. Ver pruebas focales/límites en [`TESTING.md`](TESTING.md).

### Sesiones y asistencia (Fase 6, release en producción)

El módulo conserva límites del monolito: reglas en `src/domain/attendance`, casos de uso/port en `src/application/attendance`, servicio/HTTP en `src/server/attendance`, persistencia en `src/server/db/repositories/attendance-*` y schema Drizzle. La migración `0019_phase6_attendance` añade calendario, roster, marcas, configuración y receipts; migration 0018 hace opcional el motivo del movimiento de efectivo. Ambas se aplicaron al Supabase local canónico y producción mediante el release PR 211 (ledger 20 observado en ese release). Las correcciones C1/C2/C3 se integraron después en PRs 219/223 y se liberaron mediante PR 228; no requirieron cambios de schema.

PR 201 integró dominio/backend/schema; PR 202 implementó el runner de demo opcional de asistencia; PR 203 montó las rutas y UI. ADMIN configura la política y realiza correcciones; INSTRUCTOR entra solo a grupos propios y marca roster permitido durante el día civil Bolivia. `PRIVATE_ROUTE_POLICIES` aplica roles por ruta y los repositorios comprueban ownership dentro de la operación. Las páginas mantienen Astro SSR/POST, con JavaScript como mejora progresiva. No hay job de ausencias: `PENDING` y ausencias no marcadas son proyecciones calculadas desde reloj y revisión del roster.

La cancelación/reemplazo modifica la cronología operativa sin reescribir horas originales ni extender las horas oficiales del formato; feriados son una razón de cancelación individual, no un subsistema de calendario global. Los seed runners viven en `scripts/`, usan context/manifiesto de provenance propios, PLAN por defecto y límites de destino explícitos; no forman parte de la aplicación ni del pipeline de despliegue. El ledger financiero y sus guards no se debilitan. Ver [`ATTENDANCE_CONTRACT.md`](ATTENDANCE_CONTRACT.md) y [`FINANCIAL_DEMO.md`](FINANCIAL_DEMO.md).

Fase 6 y su release quedaron cerrados por PR 211; las correcciones de asistencia C1/C2/C3 quedaron cerradas por PR 228. Sus pruebas/limitaciones y el límite de verificación de ledger cloud están en `docs/TESTING.md` y `docs/DEPLOYMENT.md`.

### Evaluaciones y notas (Fase 7, release PR 235)

PR 230 integra el backend de evaluación en capas: políticas/tipos en
`src/domain/evaluations`, casos de uso/port en `src/application/evaluations`,
loader y adaptador HTTP en `src/server/evaluations`, y persistencia en
`src/server/db/repositories/evaluation-repository.ts`. El schema se declara en
`src/server/db/schema`; la migración versionada es
`drizzle/0020_phase7_evaluations.sql`.

El loader `loadCourseEvaluations` y `handleEvaluationPost` son helpers
server-side para lectura y comandos `scheme`/`grade`. La policy fail-closed
reconoce destinos privados bajo `/app/cursos/:id/evaluaciones`,
`/app/cursos/:id/grupos/:groupId/evaluaciones` y las rutas equivalentes de
`/app/mis-cursos/:id` para Instructor. PR 232 conectó esos helpers en cuatro
páginas Astro y en `src/components/evaluations/*`: ADMIN administra el esquema
global/curso y califica grupos; INSTRUCTOR consulta esquema propio y califica su
roster autorizado. PR 235 liberó estas superficies y el backend en `master`.

Las páginas usan SSR/POST como base y React para edición interactiva; conservan
drafts de campos independientes y proyección explícita de estado incompleto.
Ownership, fecha de inicio y estado `INSCRITO` se revalidan en repositorio, no
solo en la route policy/UI. La UI está integrada en development; aún no equivale
a gate final o release de Fase 7.

La migración 0020 declara cinco tablas protegidas por RLS y revoca acceso Data
API directo; los repositorios revalidan rol/ownership/membresía dentro de
transacciones. Se aplicó en stacks temporales y al Supabase local canónico
(ledger 20→21, idempotente), y se liberó a cloud con PR 235 (ledger 21
confirmado mediante inspección read-only). No hubo comparación cloud de hash
pre/post de todas las filas. Evidencia de preservación local y límites de cloud en
`docs/TESTING.md`; detalle del modelo, autorización e idempotencia en
`docs/DATA_MODEL.md`, `docs/SECURITY.md` y `docs/EVALUATIONS_CONTRACT.md`. Fase 7
está liberada dentro de su alcance. No incluye cierre de curso/planilla de Fase 8
o certificados de Fase 9.

Corrección de Fase 7 en PR 258: el caso de uso expone guardado atómico de una
fila de notas mediante `saveRow`; la interfaz puede editar celdas por separado,
pero persiste el conjunto cambiado en una transacción del repositorio. El
fallback HTML conserva comandos de nota individuales. No se añadió migración ni
se movieron reglas desde dominio/repositorio a React. El detalle de contrato y
verificación focal está en [`EVALUATIONS_CONTRACT.md`](EVALUATIONS_CONTRACT.md)
y [`TESTING.md`](TESTING.md).

### Cierre académico de grupo (Fase 8, implementación en capas)

El agregado nuevo mantiene las capas del monolito: reglas/tipos en
`src/domain/academic-closure`, casos de uso/port en
`src/application/academic-closure`, helpers de carga/HTTP en
`src/server/academic-closure`, persistencia en
`src/server/db/repositories/academic-closure-*` y schema/migración Drizzle.
`loadAcademicClosure`, `loadAcademicClosureVersion` y `handleClosurePost` son
helpers server-side reutilizados por las páginas SSR workspace/historial
integradas por PR 282. PR 281 añadió renderers PDF/CSV y seis GET adapters sobre
`loadAcademicClosureVersion`. La policy registra patrones acotados workspace,
versión y documentos: ADMIN opera en `/app/cursos`, INSTRUCTOR en `/app/mis-cursos`
con ownership revalidado por loaders. Evitar wildcards amplios. El cierre
transaccional bloquea curso/grupo y serializa estado, snapshot, receipt y auditoría
con escrituras de notas, asistencia, calendario y membresía destino; 0021 añade
trigger DB para evidencia cerrada. El owner reportó una verificación focal live
de los seis GET/download paths en QA; esto no equivale al gate/release F8.
Contrato y límites en [`ACADEMIC_CLOSURE_CONTRACT.md`](ACADEMIC_CLOSURE_CONTRACT.md).

### Cuentas ADMIN (backend PR 283; UI en feature)

El backend sigue capas: reglas/DTO en `src/domain/admin-accounts`, casos de uso
`src/application/admin-accounts`, helpers HTTP/loaders/Auth gateway en
`src/server/admin-accounts` y repositorio Drizzle. PR 283 integró el backend a
development. Migration 0022 añade la intención durable/inmutable de baja; tablas
`users`/`user_roles` se reutilizan. Auth queda fuera de la transacción PostgreSQL;
el repositorio revalida actor, revisión y actividad/dependencias bajo locks,
incluido el guard global del último ADMIN.

La interfaz aún no integrada en `feat/admin-account-interface` agrega SSR en
`/app/administradores`, `/nuevo` y `/:id`, componentes en
`src/components/admin-accounts` y mejoras progresivas de cliente. POST y lectura
delegan a helpers/casos server-side, sin lógica de negocio en UI. Route policy
registra ADMIN para lista/creación/UUID detail y navegación para cualquier ADMIN;
no hay ROOT ni interfaz de promoción/edición de perfiles. Ver
[`ADMIN_ACCOUNTS_CONTRACT.md`](ADMIN_ACCOUNTS_CONTRACT.md).

El POST público limita y parsea el body en el adaptador server-side, valida Origin y llama el caso de uso de interés. Un limiter persistente usa PostgreSQL y un HMAC server-only sobre `Astro.clientAddress`; no confía en forwarded headers. Sin secreto válido o dirección de cliente confiable, el flujo falla cerrado. Los defaults técnicos y requisitos de despliegue se describen en el contrato y en `docs/DEPLOYMENT.md`; no implican que los valores cloud estén configurados.

## ESTRUCTURA DE REFERENCIA

```text
src/
├── components/
│   ├── ui/
│   └── shared/
├── layouts/
├── pages/
│   ├── app/
│   ├── cursos/
│   ├── certificados/
│   └── api/
├── features/
│   ├── courses/
│   ├── groups/
│   ├── participants/
│   ├── enrollments/
│   ├── attendance/
│   ├── assessments/
│   ├── certificates/
│   └── ...
├── server/
│   ├── auth/
│   ├── db/
│   │   ├── schema/
│   │   ├── repositories/
│   │   └── migrations/
│   ├── services/
│   ├── policies/
│   └── storage/
├── domain/
│   ├── rules/
│   ├── types/
│   └── errors/
├── lib/
├── styles/
└── test/
```

La estructura puede evolucionar.

No crear directorios vacíos únicamente por seguir este ejemplo.

## RUTAS PÚBLICAS Y PRIVADAS

### Públicas

Ejemplos:

- `/`
- `/cursos`
- `/cursos/[slug]`
- `/certificados/[code]`
- `/login`

El registro de interesados de Fase 3 se accede desde el detalle existente `/cursos/[slug]`; no se define una ruta pública independiente `/preinscripcion/[slug]`. La preinscripción presencial/pagada pertenece a Fase 5.

### Privadas

Ejemplos:

- `/app`
- `/app/cursos`
- `/app/grupos`
- `/app/asistencia`
- `/app/evaluaciones`
- `/app/certificados`

Toda ruta privada debe validar sesión y autorización server-side.

## LÓGICA DE NEGOCIO

Ejemplo de flujo incorrecto:

```text
React component
→ db.insert(...)
```

Flujo esperado:

```text
React/Astro
→ action/endpoint
→ application service
→ repository
→ Drizzle
→ PostgreSQL
```

## TRANSACCIONES

Utilizar transacciones cuando una operación requiera consistencia entre múltiples escrituras.

Ejemplos:

- confirmar inscripción;
- cerrar grupo;
- emitir certificado;
- registrar devolución y actualizar estado relacionado.

No dividir artificialmente una operación atómica entre múltiples requests.

## ESTADOS Y ENUMS

Los estados importantes deben modelarse explícitamente.

Para Fase 2A, el curso usa únicamente:

- `DRAFT`;
- `PUBLISHED`;
- `ARCHIVED`.

La disponibilidad de preinscripción (`UNAVAILABLE`, `UPCOMING`, `OPEN`, `CLOSED`) se deriva de la ventana de fechas y no es un estado persistido. Los estados operativos de grupos y el resto del ciclo académico quedan para fases posteriores.

Grupo:

- planned
- open
- confirmed
- cancelled
- in_progress
- completed

Certificado:

- pending
- generated
- awaiting_signature
- issued
- revoked
- replaced

La lista definitiva debe mantenerse en el modelo de datos.

## ERRORES

Definir errores de dominio y aplicación diferenciados.

No mostrar errores internos de PostgreSQL al usuario.

Los mensajes públicos deben ser comprensibles.

Los logs internos deben conservar contexto técnico suficiente sin incluir secretos.

## AUDITORÍA

Operaciones sensibles deben ser auditables.

Ejemplos:

- cambios de nota;
- cambios de asistencia;
- confirmación de inscripción;
- aplicación de descuento;
- devolución;
- emisión de certificado;
- revocación;
- cambios de rol.

## MÓDULO COURSES EN FASE 2

El flujo implementado conserva los límites del monolito modular:

```text
páginas Astro SSR
→ casos de uso Courses
→ validación y políticas de dominio
→ CourseRepository
→ Drizzle/PostgreSQL
```

Las páginas administrativas hacen render server-side y usan POST tradicional como base sin JavaScript. La edición de campos de formato y el guardado del formulario de curso utilizan `fetch` con respuestas JSON cuando hay JavaScript: conservan el formulario, actualizan el token de revisión optimista y muestran errores sin navegar. El servidor reutiliza los mismos casos de uso, validación y autorización que para POST HTML. Cada escritura vuelve a verificar origen y autorización `ADMIN`; el middleware registra de forma explícita las rutas de cursos y formatos y mantiene el comportamiento fail-closed para cualquier otra ruta `/app`. El constructor/recortador de imágenes es una isla React acotada a la interacción que la necesita.

La navegación entre páginas privadas usa Astro ClientRouter. Altas de cursos y formatos, eliminación de formatos y transiciones editoriales obtienen confirmación del mismo POST autorizado y actualizan o navegan entre vistas SSR sin descargar nuevamente el documento. Un formulario HTML y POST/redirect preservan el fallback sin JavaScript. Publicación, retiro y archivo se confirman mediante diálogo corto accesible; las operaciones siguen ejecutándose exclusivamente en servidor.

`DrizzleCourseRepository` agrupa curso y auditoría en transacción; los términos comerciales se resuelven desde la revisión inmutable de formato referenciada por el curso. `DrizzleFormatRepository` crea y revisa formatos, conserva auditoría, mueve cursos `DRAFT` a la revisión vigente y deja intactas revisiones de cursos publicados/archivados. La migración versionada reconstruye formatos a partir de las tuplas históricas de duración y precios y elimina los campos/tablas directos al completar la migración.

El módulo `groups` separa reglas y casos de uso del adaptador `DrizzleGroupRepository`: los grupos tienen cupo y estado propios, conservan la revisión del formato del curso y sus horas L–V se derivan en dominio. Crear/editar un grupo bloquea brevemente el curso padre dentro de la transacción para serializar comprobación y escritura de horarios, con auditoría y revisión optimista; cancelar no borra datos. La ruta privada `/app/cursos/[id]/grupos` está incluida explícitamente en la política `ADMIN`, valida origen y autorización en servidor y ofrece JSON para mutaciones sin recarga con fallback HTML. RLS y la revocación de privilegios Data API protegen la nueva tabla; no hay acceso PostgreSQL directo desde UI.

El contrato administrativo incluye campos operativos; el contrato público independiente se construye solo desde filas `PUBLISHED`, omite estado, nota mínima, IDs y timestamps administrativos, y deriva disponibilidad de la ventana en tiempo de lectura. `/` y `/cursos` cargan catálogo SSR en cada solicitud; `/cursos/[slug]` consulta detalle publicado y responde 404 para no-publicados e inexistentes. La landing elige el destacado único si existe y usa un fallback determinista si no.

El contenido Markdown del curso se interpreta mediante un parser de nodos permitidos y se renderiza sin insertar HTML arbitrario; destinos de enlaces pasan por allowlist. El horario textual permanece para los cursos históricos; los nuevos cursos fijan lunes a viernes y el planificador puro de dominio deriva horario y finalización a partir de la fecha/hora civil y la duración de sesión de la revisión del formato. El repositorio verifica el plan en el servidor. Todavía no hay sesiones operativas ni ajustes por feriados; instructor es texto, no una relación de identidad.

El editor de artwork produce una imagen WebP recortada y la envía a un endpoint SSR. El endpoint exige origen esperado, sesión/usuario activo y rol `ADMIN`, limita tamaño, comprueba MIME/extensión y dimensiones/contenedor WebP y sube con credencial service-role solo en servidor al bucket público `course-artwork`. Las filas guardan una key de formato canónico vinculada al curso, no una URL proporcionada por el cliente; la URL pública se genera desde el host Supabase configurado. El bucket se verifica/crea con política pública de lectura y escritura solo server-side mediante privilegio privilegiado.

Los formularios `datetime-local` representan exclusivamente tiempo civil de `America/La_Paz`. La conversión pura de dominio aplica UTC-04 —Bolivia no utiliza horario de verano— tanto al persistir instantes UTC como al volver a editar, sin depender del timezone del proceso. La edición envía `updatedAt` como revisión optimista y el repositorio rechaza escrituras obsoletas. La asignación de slugs se serializa con un advisory lock transaccional global y estable para evitar colisiones incluso entre bases solapadas como `foo` y `foo-2`.

## CRITERIOS PARA EXTRAER UN BACKEND

Considerar Elysia + Bun únicamente cuando aparezca al menos una necesidad real:

- múltiples aplicaciones cliente;
- API externa estable;
- integraciones externas complejas;
- workers especializados;
- necesidad clara de escalar backend y frontend independientemente.

No extraer backend por anticipación.

## AUTH EN EL MONOLITO MODULAR

La Fase 1 mantiene los límites siguientes:

```text
middleware/endpoints Astro
→ casos de uso Auth
→ políticas y errores de dominio
→ AuthUserRepository
→ Drizzle/PostgreSQL
```

La integración Supabase SSR vive en infraestructura server-side y se instancia por request únicamente en rutas dependientes de sesión. El middleware clasifica antes de inicializar dependencias: las rutas públicas ordinarias no crean contexto Auth; `/auth/**` recibe el cliente SSR ligado a cookies; `/login` y `/app/**` resuelven identidad y usuario interno. `Astro.locals` modela ese contexto como opcional y los consumidores protegidos lo exigen mediante assertions server-side. Los guards de ruta reutilizan políticas de aplicación, mantienen autorización fail-closed y la navegación solo refleja permisos ya evaluados.

La conexión `DATABASE_URL` corresponde al runtime y puede apuntar a un pooler compatible con serverless. `MIGRATION_DATABASE_URL` prioriza una conexión directa para Drizzle Kit. En Supabase local actual ambas apuntan a `127.0.0.1:55322`; el API/Auth local está en `http://127.0.0.1:55321`. Estos puertos reemplazaron `54322`/`54321`, que caían dentro del rango Windows reservado `54296–54395`; la aplicación web conserva `http://127.0.0.1:4321`. La configuración autoritativa local está en `supabase/config.toml` y `.env.example`.

La configuración de base y la configuración pública de Auth se validan mediante accessors separados. Las lecturas de oferta pública reutilizan el singleton Drizzle y reintentan exclusivamente `listPublic` ante causas transitorias reconocidas, con tres intentos totales (esperas de 150 ms y 400 ms); errores de configuración, permisos, schema, validación y escrituras no se reintentan.

### Experiencia de mutación privada

Las páginas privadas siguen siendo SSR como fuente de contenido y autorización; `NavigationSkeleton` se conecta al ciclo de navegación/carga y sustituye temporalmente la región mientras la vista está pendiente y visible, con cancelación/recuperación al finalizar o fallar. Los controladores toleran navegación Astro sin registrar listeners duplicados. Las mutaciones de grupos y formatos usan estado de presentación local, pero delegan validación, autorización, revisiones y persistencia a los casos de uso/repositorios; el DTO específico de grupos no transporta navegación.

Los productores de feedback administrativo comparten la fachada `src/lib/notifications.ts` sobre Sileo. Asigna IDs UUID distintos por operación y entrega el mismo ID a loading/success/error en operaciones promise; la fachada tipa el campo runtime `id` que Sileo 0.1.5 no publica en sus declaraciones, sin `any` ni cambios en `node_modules`.

El alta de curso admite idempotencia opcional a través de UUID `requestKey` y fingerprint de datos. El repositorio persiste ambos con actor en la propia fila de curso bajo índice único actor/clave; reintentar la misma solicitud recupera el curso ya creado y una clave reutilizada con contenido distinto se rechaza. La fotografía se carga/asocia después de crear el borrador: no se promete atomicidad entre Storage y PostgreSQL y el fallo conserva una ruta de recuperación del borrador.
