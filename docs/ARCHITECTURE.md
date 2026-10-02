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

### Instructores y asignación (Fase 4, integrada en development)

El módulo usa límites del monolito modular (`src/domain/instructors`, `src/application/instructors`, `src/server/instructors` y repositorios Drizzle). El perfil comparte ID estable con `users`; Supabase Auth posee credenciales. ADMIN crea/edita instructor y asigna instructor a un curso; los grupos heredan esa relación desde `courses.instructor_id`. Cursos draft admiten asignación opcional; publicar requiere perfil registrado activo. El nombre público de un instructor asignado se proyecta como nombre completo, sin correo/teléfono. La migración aditiva 0014 conserva texto `instructor_name` histórico sin autocorrelación. Las migraciones 0012–0015 se aplicaron en local y producción por PR 126 (ledger 16 en cada entorno).

Las rutas administrativas de instructor/curso permanecen limitadas a ADMIN. La ruta profesional `/app/perfil` y `/app/mis-cursos`/detalle pertenecen a INSTRUCTOR; consultas filtran además por el ID interno autenticado, de modo que una URL directa ajena no revela el curso. En Fase 4 no se concede acceso a asistencia/sesiones, formatos, interesados ni gestión de participantes.

La validación del horario del instructor usa el calendario L–V de cada grupo y fechas civiles Bolivia inclusivas, con intervalos diarios semiabiertos. Solo grupos `PLANNED` compiten por el horario, también si el curso está en borrador; cancelar el grupo libera el intervalo. Para evitar carreras entre asignación, edición de fechas, publicación/transiciones y cambios/altas/cancelaciones/reactivaciones de grupos, los repositorios toman una barrera transaccional compartida, adquieren advisory locks de IDs previos/nuevos de instructor en orden estable y después bloquean la fila del curso. La revisión optimista y auditoría/historial se conservan. La política de desactivar instructor con asignaciones futuras sigue pendiente; no hay acción de baja implementada ni se infiere una regla, y esto no limita los flujos ya aprobados de alta/edición/asignación.

Los contratos distinguen DTO de formulario público (disponibilidad y horarios elegibles, sin PII/capacidad) y DTOs administrativos de registros/métricas bajo autorización; las preferencias no asignan cupos ni grupos. La administración filtra estado sin derivar métricas del subconjunto mostrado.

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

La conexión `DATABASE_URL` corresponde al runtime y puede apuntar a un pooler compatible con serverless. `MIGRATION_DATABASE_URL` prioriza una conexión directa para Drizzle Kit. En local ambas apuntan a `127.0.0.1:54322`.

La configuración de base y la configuración pública de Auth se validan mediante accessors separados. Las lecturas de oferta pública reutilizan el singleton Drizzle y reintentan exclusivamente `listPublic` ante causas transitorias reconocidas, con tres intentos totales (esperas de 150 ms y 400 ms); errores de configuración, permisos, schema, validación y escrituras no se reintentan.

### Experiencia de mutación privada

Las páginas privadas siguen siendo SSR como fuente de contenido y autorización; `NavigationSkeleton` se conecta al ciclo de navegación/carga y sustituye temporalmente la región mientras la vista está pendiente y visible, con cancelación/recuperación al finalizar o fallar. Los controladores toleran navegación Astro sin registrar listeners duplicados. Las mutaciones de grupos y formatos usan estado de presentación local, pero delegan validación, autorización, revisiones y persistencia a los casos de uso/repositorios; el DTO específico de grupos no transporta navegación.

Los productores de feedback administrativo comparten la fachada `src/lib/notifications.ts` sobre Sileo. Asigna IDs UUID distintos por operación y entrega el mismo ID a loading/success/error en operaciones promise; la fachada tipa el campo runtime `id` que Sileo 0.1.5 no publica en sus declaraciones, sin `any` ni cambios en `node_modules`.

El alta de curso admite idempotencia opcional a través de UUID `requestKey` y fingerprint de datos. El repositorio persiste ambos con actor en la propia fila de curso bajo índice único actor/clave; reintentar la misma solicitud recupera el curso ya creado y una clave reutilizada con contenido distinto se rechaza. La fotografía se carga/asocia después de crear el borrador: no se promete atomicidad entre Storage y PostgreSQL y el fallo conserva una ruta de recuperación del borrador.
