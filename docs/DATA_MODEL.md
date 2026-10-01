# DATA_MODEL

## OBJETIVO

Definir el modelo conceptual inicial.

El schema real se mantendrá en Drizzle y sus migraciones.

## PRINCIPIOS

- PostgreSQL es la base en todos los entornos relevantes.
- IDs internos no deben confundirse con códigos públicos.
- Evitar duplicación.
- Mantener auditoría donde exista impacto administrativo.
- Los montos deben usar representación adecuada para dinero.
- Fechas y zonas horarias deben modelarse explícitamente.

## ENTIDADES INICIALES

### User

- id
- authUserId
- email
- name
- role
- status
- createdAt
- updatedAt

Implementación de Fase 1:

- `users.email` se persiste en minúsculas y sin espacios, con unicidad y validación DB.
- `users.auth_user_id` es nullable y único: es `null` mientras el estado es `INVITED` y obligatorio para `ACTIVE`/`DISABLED`.
- `roles` contiene los códigos cerrados `ADMIN` e `INSTRUCTOR`.
- `user_roles` usa PK compuesta y permite múltiples roles por usuario.
- las FK de `user_roles` están indexadas cuando la PK compuesta no cubre el acceso inverso.
- todas las tablas públicas de Auth interno tienen RLS habilitado y los roles Data API `anon`/`authenticated`/`service_role` no reciben privilegios ni políticas.

La implementación dual-auth de la rama Fase 4 extiende `users` con `auth_primary_provider` (`GOOGLE`/`EMAIL`, default histórico `GOOGLE`) y `approved_google_identity_id` nullable. Esta última es la aprobación a nivel aplicación de una identidad Google concreta, no una afirmación de que Supabase no pueda asociar proveedores automáticamente. La contraseña y las identidades proveedor se mantienen en `auth.users`; el modelo interno conserva solamente `authUserId` y las referencias de identidad/aprobación necesarias. Las migraciones 0012/0013 están versionadas en la rama pero no están aplicadas en el stack local persistente ni en cloud.

`auth_attempt_buckets` (0012) persiste contador, inicio/expiración y clave HMAC para límites de intentos; no guarda IP/email en claro. `auth_google_link_requests` (0013) persiste hash del nonce de uso único, FK al usuario interno, ID de sesión y expiración de cinco minutos. Ambas tienen RLS habilitado y grants Data API revocados. La integración depende de `AUTH_RATE_LIMIT_SECRET` server-only (mínimo 32 caracteres) y del hook Auth descrito en `AUTHENTICATION.md`; no se ha escrito configuración secreta ni aplicado migración al entorno de desarrollo compartido.

Fase 4 aprobada, pendiente de implementación: separar un perfil interno de instructor con nombre, apellido, email normalizado y teléfono opcional (nombre completo solamente para exposición pública). La identidad Auth permanece en Supabase Auth, nunca se copia contraseña al modelo de aplicación. Mantener ID estable para cursos e historial; perfiles referenciados no se borran físicamente. La forma final de migración y el tratamiento de desactivación con asignaciones futuras requieren implementación/revisión; esa regla de ciclo de vida aún no está aprobada.

### Course

- id
- name
- slug
- description
- level
- totalHours
- minimumGrade
- status
- schedule
- conditions
- startsAt
- endsAt
- registrationStartAt
- registrationEndAt
- createdAt
- updatedAt

Implementación actual:

- `course_status` contiene únicamente `DRAFT`, `PUBLISHED` y `ARCHIVED`; disponibilidad de preinscripción no se persiste como estado.
- `course_level` contiene `BASIC`, `INTERMEDIATE` y `ADVANCED`.
- nombre, descripción, horario informativo y condiciones son obligatorios y no vacíos.
- `course_type_revision_id` es obligatorio; horas y precios se resuelven desde esa revisión en lugar de guardarse directamente en `courses`/`course_prices`.
- `minimum_grade` está limitado a `0..100`; todavía no existe `minimum_attendance` ni cálculo académico.
- `schedule` continúa como texto no vacío por compatibilidad. Los cursos nuevos usan «Lunes a viernes · horario por grupo» y los históricos conservan su texto informativo u horario planificado.
- `weekdays_mask` es `31` para nuevos cursos planificados de lunes a viernes; los cursos históricos sin planificación estructurada lo conservan nulo. Los nuevos `starts_at`/`ends_at` representan las fechas comunes en Bolivia (00:00 de la primera y 23:59 de la última); la hora diaria vive en cada grupo. Los cursos existentes con grupos o con cierre de preinscripción el primer día conservan sus instantes horarios para no invalidar el calendario o la ventana de inscripción. Esto aún no sustituye la entidad futura de sesiones de grupo.
- `content_markdown` e `instructor_name` son campos de texto opcionales. `instructor_name` es un campo legado, no una identidad/asignación. `artwork` almacena una key canónica del objeto de Storage, no una URL arbitraria. `featured` solo puede ser true en un curso publicado y un índice parcial permite como máximo un destacado publicado.
- fechas públicas de inicio y fin usan `timestamptz`, son obligatorias y mantienen `starts_at < ends_at`. Para cursos nuevos planificados, la UI recibe fechas civiles `YYYY-MM-DD` y las convierte a los límites del día en `America/La_Paz` (00:00 inicial y 23:59 final); los cursos históricos que conservan horas se editan como tiempo civil estricto `YYYY-MM-DDTHH:mm`. La ventana de preinscripción también conserva precisión de hora.
- la ventana de preinscripción usa dos `timestamptz`: ambos son nulos o ambos existen con inicio anterior al fin. La conversión inversa UTC → Bolivia preserva exactamente la hora civil al reeditar.
- el slug normalizado es único, se genera al crear bajo un advisory lock global de asignación, resuelve colisiones —incluidas bases solapadas concurrentes— con sufijo numérico y no se modifica después.
- `updated_at` funciona como revisión optimista del curso y su referencia a formato; una edición con revisión obsoleta no actualiza ninguna fila. Se persiste con precisión de milisegundos (`timestamptz(3)`) para coincidir con `Date`/ISO en el navegador y evitar falsos conflictos por microsegundos.
- no existe borrado físico de cursos en el contrato de aplicación; `ARCHIVED` es terminal durante esta fase.
- la proyección pública solo se construye para cursos `PUBLISHED`, omite identificadores, estado, nota mínima y timestamps administrativos, y deriva la disponibilidad desde la ventana. La landing, catálogo y detalle consumen proyecciones server-side.

### CourseType (formato)

- id
- name
- active
- createdAt
- updatedAt

Representa un formato administrado. `active` permite activarlo o desactivarlo sin borrar sus revisiones ni modificar cursos históricos. `updatedAt` participa junto con la revisión vigente como token de frescura para cambios administrativos optimistas. El borrado físico está permitido solo si ninguna revisión del formato está referenciada por cursos; formatos usados se conservan y se desactivan cuando ya no deban ofrecerse.

#### CourseTypeRevision

- id
- courseTypeId
- revisionNumber
- totalHours
- sessionMinutes (nullable solo en revisiones históricas sin dato verificable)
- studentAmount
- externalAmount
- createdAt

Cada revisión es inmutable. Sus precios `STUDENT` y `EXTERNAL`, en `BOB`, pertenecen directamente a esa revisión y no son overrides del curso. Los importes son `numeric(12,2)` y se representan como strings en TypeScript. Una restricción de base de datos rechaza UPDATE/DELETE de revisiones.

`session_minutes` registra minutos por clase (15–480). En la migración es nulo para términos anteriores que nunca especificaron duración de sesión; únicamente las revisiones de los ejemplos conocidos que coinciden por nombre, duración y precios reciben 90/150 minutos. Los nuevos formatos requieren el valor. Los borradores planificados se recalculan al cambiar la revisión vigente sin alterar los cursos publicados o archivados.

#### Relación con Course

Un curso debe referenciar exactamente una `CourseTypeRevision`. El curso no conserva campos editables independientes para horas o precios. Al editar un tipo se crea una nueva revisión y los cursos `DRAFT` sin grupos pasan a la revisión vigente; los cursos con grupos y los `PUBLISHED`/`ARCHIVED` mantienen la revisión exacta. Cursos históricos migrados reciben formatos/revisiones generados a partir de cada tupla distinta de duración y precios, sin sustituir sus valores por defaults.

### Campos editoriales añadidos

- `contentMarkdown`: texto opcional interpretado/renderizado de forma segura en el detalle.
- `instructorName`: texto opcional sin FK a la entidad `User`.
- `artwork`: key de Storage opcional, canónica y vinculada al curso; si falta o es inválida se utiliza el fallback gráfico.
- `featured`: booleano que solo puede aplicar a publicados; índice único parcial asegura singleton entre publicados.
- La landing omite precios y horario detallados; `/cursos/[slug]` presenta términos de la revisión referenciada y los datos editoriales públicos permitidos.

#### Asignación de Instructor (diseño aprobado para Fase 4, no implementado)

El objetivo es una relación de exactamente un instructor interno por curso, con todos los grupos del curso heredando el instructor a través de su curso. La asignación referencia ID estable de usuario/perfil; no duplicar nombre libre como fuente de verdad. El contrato aprobado no fija todavía columnas, tabla de asignación ni constraints de migración: decidirlo en implementación preservando referencias/historial y sin borrar perfiles usados. La validación de solapamientos comprende al mismo instructor en cursos distintos y debe abarcar todas las escrituras concurrentes relevantes; intervalo civil Bolivia L–V semiabierto y contiguo permitido. No implementar sesiones ni asistencia en Fase 4.

### Group

- id
- courseId
- courseTypeRevisionId (revisión de formato conservada)
- capacity (máximo por grupo; no mínimo)
- status (`PLANNED` o `CANCELLED`)
- publishedAt (nullable; instante de primera exposición pública, inmutable una vez definido)
- startsAt / endsAt (primer y último encuentro, hora civil boliviana)
- createdAt / updatedAt (concurrencia optimista)

La creación está disponible para cursos `DRAFT` o `PUBLISHED` con plan L–V y duración de sesión conocida; no para cursos archivados. Los grupos creados en curso publicado marcan `published_at` inmediatamente; si un curso borrador se publica después, las operaciones posteriores reflejan su exposición. La migración 0009 reconstruye la exposición histórica desde estados y auditoría de cursos, y un trigger impide borrar grupos con `published_at` o alterar ese instante. Por tanto, un grupo que nunca fue publicado puede eliminarse; uno ya publicado se conserva y se desactiva/cancela o reactiva. Los encuentros se repiten de lunes a viernes y solo cambia la hora inicial por grupo; la hora final y última fecha se derivan de la revisión fijada. No se almacena ni infiere número de inscritos mientras no exista el módulo de inscripciones. Las operaciones se auditan; la creación y las ediciones se serializan mediante bloqueo del curso padre y se rechazan solapamientos entre grupos planificados de ese mismo curso. La asignación de identidad del instructor, calendario de feriados, códigos visibles y entidades `Session` permanecen pendientes.

### Participant

La entidad representa a una persona incorporada al proceso administrativo de inscripción (Fase 5), no a quien únicamente dejó sus datos de interés en Fase 3. La necesidad y momento de persistir CI se confirmarán antes de incorporarlo.

- id
- names
- lastNames
- document data only if formally required
- email
- phone if required
- type
- createdAt

### InterestRegistration (Fase 3, implementado)

Representa un registro público autónomo, separado de `Participant` y de la preinscripción presencial. El schema Drizzle y la migración versionada 0011 están implementados y desplegados. El email declarado públicamente no se verifica como identidad y no puede usarse para sobrescribir o fusionar datos de una persona global. La fila contiene `courseId`, nombre, apellidos, email normalizado, teléfono nullable, preferencia nullable, estado `ACTIVE`/`CANCELLED` y timestamps de precisión milisegundo. Un unique no parcial limita a un registro por curso/email en cualquier estado. La FK compuesta curso/grupo impide referencias cruzadas; las tablas nuevas habilitan RLS y revocan privilegios Data API a roles cliente.

No cobra, no ocupa cupo ni asigna grupo. La preferencia de grupo no implica asignación ni plazas. La tabla técnica `interest_registration_rate_limits` almacena solo claves HMAC, contador y expiración; no se conserva IP cruda. El limiter persistente y sus parámetros están implementados; el secreto server-only está configurado y el smoke de producción verificó el comportamiento de buckets ante headers forwarded falsificados (sin stress 429 ni verificación de HMAC sobre una IP real). El cierre de disponibilidad detiene nuevas solicitudes, no elimina registros. Política de retención, plazo y anonimización quedan pendientes; no se asume conservación perpetua. Ver [`INTEREST_REGISTRATION_CONTRACT.md`](INTEREST_REGISTRATION_CONTRACT.md) para reglas y estado detallado.

La migración `0011_interest_registrations.sql` añade el enum `interest_registration_status`, las tablas `interest_registrations` y `interest_registration_rate_limits`, unicidad no parcial por curso/email, FK compuesta opcional curso/grupo, checks de strings/email/teléfono, índices de listado/preferencia/expiración, RLS y revocación de privilegios Data API. La migración está versionada y aplicada en stacks temporales, Supabase local estándar y Supabase cloud mediante el pipeline de release; checksums/timestamps del ledger cloud coinciden con el repositorio. La integración completa pasó 65/65; consultar `docs/TESTING.md` para resultados locales y CI.

### PreRegistration (presencial, Fase 5)

En este proyecto el término se refiere a la preinscripción administrativa presencial que registra pago parcial o total y ocupa cupo. Puede iniciarse directamente o prellenarse desde un interesado de forma editable. La relación con ese registro debe ser explícita y trazable; no debe inferirse identidad global, pago ni equivalencia entre interesado y persona participante. Su modelo persistido y campos aún están por definir; la lista histórica de `Participant`/`PreRegistration` no debe interpretarse como contrato vigente. Esta entidad no implica por sí misma una transición a inscripción definitiva.

### Enrollment

- id
- participantId
- groupId
- appliedPrice
- discount
- status
- paymentStatus
- createdAt

### Session

- id
- groupId
- startsAt
- endsAt
- status
- replacementForSessionId

### Attendance

- id
- sessionId
- participantId
- status
- recordedBy
- recordedAt

### InstructorAttendance

- id
- sessionId
- instructorId
- status

### Assessment

- id
- groupId
- name
- type
- weight
- order

### Grade

- id
- assessmentId
- participantId
- score
- recordedBy
- updatedAt

### Refund

- id
- enrollmentId
- amount
- reason
- status
- createdAt

### PaymentReference

- id
- enrollmentId
- reference
- amount
- metadata
- createdAt

### Certificate

- id
- publicCredentialId
- participantId
- courseId
- groupId
- type
- status
- issuedAt
- filePath
- fileHash
- revokedAt
- revocationReason
- replacedByCertificateId

### AuditEvent

- id
- actorId
- action
- entityType
- entityId
- metadata
- createdAt

Fase 2A registra atómicamente `COURSE_CREATED`, `COURSE_UPDATED`, `COURSE_PRICES_UPDATED`, `COURSE_PUBLISHED`, `COURSE_WITHDRAWN` y `COURSE_ARCHIVED`. `actorId` referencia al usuario interno y está indexado; las consultas por entidad también están indexadas.

## RESTRICCIONES

### Idempotencia del alta de cursos

`courses` incluye `create_actor_id` (FK restrictiva a `users.id`), `create_request_key` (UUID) y `create_fingerprint` (SHA-256 hexadecimal de 64 caracteres). Los tres son nulos en altas sin clave o están presentes conjuntamente; un índice único por actor/clave evita duplicar altas cuando se reintenta una creación. La misma combinación y fingerprint recupera la fila existente; si la clave se reutiliza con otro fingerprint, la solicitud se rechaza. Estos campos son internos y no forman parte de los DTO administrativos/públicos. La migración 0010 es aditiva; no automatiza borrado de historial.

Ejemplos que deben evaluarse a nivel DB:

- email de User cuando corresponda;
- publicCredentialId unique;
- slug unique según política;
- attendance unique por sesión + participante;
- grade unique por evaluación + participante;
- weight >= 0;
- score dentro de rango;
- montos no negativos.

Las FK de aplicación están indexadas. `courses`, `course_types`, `course_type_revisions` y `audit_events` tienen RLS habilitado sin políticas Data API y privilegios revocados para `anon`, `authenticated` y `service_role`. La tabla directa `course_prices` se elimina en la migración del nuevo modelo.

## AUTH

`auth.users` pertenece a Supabase Auth.

La tabla de dominio `User` se enlaza mediante `authUserId`.

No duplicar secretos o credenciales OAuth.

No se creó una FK cross-schema hacia `auth.users`. Supabase es propietario de ese schema y ha endurecido sus privilegios; la integridad se mantiene con UUID único, identidad validada por Auth y vinculación transaccional en el repository. Los tests locales crean primero la identidad Auth y luego su fixture interno. Drizzle sigue siendo propietario exclusivo de las tablas de aplicación y su migración.

## SOFT DELETE

No aplicar soft delete globalmente.

Utilizar estados donde tenga sentido.

Eventos legales/administrativos como certificados revocados no deben eliminarse.

## AUDITORÍA

No confiar en `updatedAt` como auditoría completa.

Usar eventos para cambios críticos.
