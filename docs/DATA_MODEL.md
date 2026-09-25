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
- `schedule` continúa como texto no vacío por compatibilidad. El constructor administrativo ayuda a ingresar días/horas, pero persiste una cadena informativa, no una estructura calendario.
- `content_markdown` e `instructor_name` son campos de texto opcionales. `artwork` almacena una key canónica del objeto de Storage, no una URL arbitraria. `featured` solo puede ser true en un curso publicado y un índice parcial permite como máximo un destacado publicado.
- fechas públicas de inicio y fin usan `timestamptz`, son obligatorias y mantienen `starts_at < ends_at`; la UI recibe tiempo civil estricto `YYYY-MM-DDTHH:mm` de `America/La_Paz` y lo convierte a instante UTC.
- la ventana de preinscripción usa dos `timestamptz`: ambos son nulos o ambos existen con inicio anterior al fin. La conversión inversa UTC → Bolivia preserva exactamente la hora civil al reeditar.
- el slug normalizado es único, se genera al crear bajo un advisory lock global de asignación, resuelve colisiones —incluidas bases solapadas concurrentes— con sufijo numérico y no se modifica después.
- `updated_at` funciona como revisión optimista del curso y su referencia a formato; una edición con revisión obsoleta no actualiza ninguna fila.
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
- studentAmount
- externalAmount
- createdAt

Cada revisión es inmutable. Sus precios `STUDENT` y `EXTERNAL`, en `BOB`, pertenecen directamente a esa revisión y no son overrides del curso. Los importes son `numeric(12,2)` y se representan como strings en TypeScript. Una restricción de base de datos rechaza UPDATE/DELETE de revisiones.

#### Relación con Course

Un curso debe referenciar exactamente una `CourseTypeRevision`. El curso no conserva campos editables independientes para horas o precios. Al editar un tipo se crea una nueva revisión y los cursos `DRAFT` pasan a la revisión vigente; los cursos `PUBLISHED` y `ARCHIVED` mantienen la revisión exacta. Cursos históricos migrados reciben formatos/revisiones generados a partir de cada tupla distinta de duración y precios, sin sustituir sus valores por defaults.

### Campos editoriales añadidos

- `contentMarkdown`: texto opcional interpretado/renderizado de forma segura en el detalle.
- `instructorName`: texto opcional sin FK a la entidad `User`.
- `artwork`: key de Storage opcional, canónica y vinculada al curso; si falta o es inválida se utiliza el fallback gráfico.
- `featured`: booleano que solo puede aplicar a publicados; índice único parcial asegura singleton entre publicados.
- La landing omite precios y horario detallados; `/cursos/[slug]` presenta términos de la revisión referenciada y los datos editoriales públicos permitidos.

### Group

- id
- courseId
- instructorId
- code
- minimumParticipants
- maximumParticipants
- status
- startsAt
- endsAt

### Participant

- id
- names
- lastNames
- document data only if formally required
- email
- phone if required
- type
- createdAt

### PreRegistration

- id
- participantId
- courseId
- status
- createdAt

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
