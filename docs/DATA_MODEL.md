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

Implementación de Fase 2A:

- `course_status` contiene únicamente `DRAFT`, `PUBLISHED` y `ARCHIVED`; disponibilidad de preinscripción no se persiste como estado.
- `course_level` contiene `BASIC`, `INTERMEDIATE` y `ADVANCED`.
- nombre, descripción, horario informativo y condiciones son obligatorios y no vacíos.
- duración es un entero positivo y `minimum_grade` está limitado a `0..100`; todavía no existe `minimum_attendance` ni cálculo académico.
- fechas públicas de inicio y fin usan `timestamptz`, son obligatorias y mantienen `starts_at < ends_at`; la UI recibe tiempo civil estricto `YYYY-MM-DDTHH:mm` de `America/La_Paz` y lo convierte a instante UTC.
- la ventana de preinscripción usa dos `timestamptz`: ambos son nulos o ambos existen con inicio anterior al fin. La conversión inversa UTC → Bolivia preserva exactamente la hora civil al reeditar.
- el slug normalizado es único, se genera al crear bajo un advisory lock global de asignación, resuelve colisiones —incluidas bases solapadas concurrentes— con sufijo numérico y no se modifica después.
- `updated_at` funciona como revisión optimista del agregado curso/precios; una edición con revisión obsoleta no actualiza ninguna fila.
- no existe borrado físico de cursos en el contrato de aplicación; `ARCHIVED` es terminal durante esta fase.
- la proyección `PublicCourseDto` solo se construye para cursos `PUBLISHED`, omite identificadores, estado, nota mínima y timestamps administrativos, y deriva la disponibilidad desde la ventana. En Fase 2A este contrato no tiene rutas HTTP públicas.

### CoursePrice

- id
- courseId
- participantType
- amount
- currency

Los tipos iniciales requeridos son `STUDENT` y `EXTERNAL`. Existe un único precio por curso y tipo. `amount` usa `numeric(12,2)`, se representa como string en TypeScript, no admite negativos y la moneda explícita queda restringida a `BOB`.

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

Las FK de Fase 2A están indexadas. `courses`, `course_prices` y `audit_events` tienen RLS habilitado sin políticas Data API, y privilegios revocados para `anon`, `authenticated` y `service_role`.

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
