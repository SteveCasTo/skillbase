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

La implementación dual-auth extendida a cloud por PR 126 añade `auth_primary_provider` (`GOOGLE`/`EMAIL`, default histórico `GOOGLE`) y `approved_google_identity_id` nullable a `users`. Esta última es la aprobación a nivel aplicación de una identidad Google concreta, no una afirmación de que Supabase no pueda asociar proveedores automáticamente. La contraseña y las identidades proveedor se mantienen en `auth.users`; el modelo interno conserva solamente `authUserId` y las referencias de identidad/aprobación necesarias. PR 126 aplicó 0012–0015 (ledger 16); el release posterior de Fase 5 avanzó cloud hasta ledger 18.

`auth_attempt_buckets` (0012) persiste contador, inicio/expiración y clave HMAC para límites de intentos; no guarda IP/email en claro. `auth_google_link_requests` (0013) persiste hash del nonce de uso único, FK al usuario interno, ID de sesión y expiración de cinco minutos. Ambas tienen RLS habilitado y grants Data API revocados. El hook Auth está activo local/cloud y `AUTH_RATE_LIMIT_SECRET` es server-only (mínimo 32 caracteres); valores nunca se registran. SMTP propio y entrega de recovery requieren configuración/verificación operacional independiente; las credenciales no pertenecen al modelo ni al repositorio.

Fase 4 añade perfiles de instructor vinculados por el mismo UUID de `users.id`, con nombre, apellido y correo normalizado de la cuenta, y teléfono nullable. El correo se edita únicamente mediante procesos de identidad Auth autorizados, no en la edición profesional del perfil; la UI permite editar nombre/apellidos y teléfono. No existe campo descripción. El nombre completo es el único dato de instructor proyectado públicamente para cursos asignados. Las credenciales siguen exclusivamente en Supabase Auth.

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
- `content_markdown` e `instructor_name` son campos de texto opcionales. `instructor_name` conserva el valor legado y no es fuente de identidad: no se hace backfill automático desde el texto. Cuando existe `instructor_id`, el nombre que se proyecta para ese curso deriva del perfil vinculado y no se exponen email/teléfono del instructor. `artwork` almacena una key canónica del objeto de Storage, no una URL arbitraria. `featured` solo puede ser true en un curso publicado y un índice parcial permite como máximo un destacado publicado.
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

El borrado de formato sin cursos asociados utiliza el setting transaccional `app.delete_unused_format_id`; el trigger permite eliminar revisiones solo cuando el ID coincide y no hay curso que las referencie. PR 123 añadió `0015_restore-format-deletion-guard.sql` para reponer la función guardada en bases cuyo 0005 histórico había variado. Aplicado al Supabase local estándar; no se reescribieron migraciones anteriores ni sus hashes.

`session_minutes` registra minutos por clase (15–480). En la migración es nulo para términos anteriores que nunca especificaron duración de sesión; únicamente las revisiones de los ejemplos conocidos que coinciden por nombre, duración y precios reciben 90/150 minutos. Los nuevos formatos requieren el valor. Los borradores planificados se recalculan al cambiar la revisión vigente sin alterar los cursos publicados o archivados.

#### Relación con Course

Un curso debe referenciar exactamente una `CourseTypeRevision`. El curso no conserva campos editables independientes para horas o precios. Al editar un tipo se crea una nueva revisión y los cursos `DRAFT` sin grupos pasan a la revisión vigente; los cursos con grupos y los `PUBLISHED`/`ARCHIVED` mantienen la revisión exacta. Cursos históricos migrados reciben formatos/revisiones generados a partir de cada tupla distinta de duración y precios, sin sustituir sus valores por defaults.

### Campos editoriales añadidos

- `contentMarkdown`: texto opcional interpretado/renderizado de forma segura en el detalle.
- `instructorName`: texto legado opcional, sin FK ni autoridad de asignación; la asignación actual usa `instructorId`.
- `artwork`: key de Storage opcional, canónica y vinculada al curso; si falta o es inválida se utiliza el fallback gráfico.
- `featured`: booleano que solo puede aplicar a publicados; índice único parcial asegura singleton entre publicados.
- La landing omite precios y horario detallados; `/cursos/[slug]` presenta términos de la revisión referenciada y los datos editoriales públicos permitidos.

#### Asignación de Instructor (Fase 4 implementada; 0014 local/cloud)

`courses.instructor_id` es nullable para admitir borradores sin asignar instructor y tiene FK `ON DELETE RESTRICT` a `instructor_profiles.id`. Publicar exige perfil registrado y usuario interno `ACTIVE` con rol `INSTRUCTOR`; todos los grupos heredan la asignación del curso, no tienen instructor duplicado. Cursos existentes conservan su texto `instructor_name`; la migración 0014 no los vincula automáticamente.

Corrección de Fase 4 implementada/validada en `fix/phase4-lifecycle-guards` e integrada a `development` por PR 134 (no release todavía): publicar también requiere al menos un grupo `PLANNED`; no se puede cancelar el último grupo planificado de curso publicado. Para editar un draft puede mantenerse `instructor_id IS NULL`; el placeholder no es opción de selección/cambio.

`instructor_profiles.id` comparte la PK/FK restrictiva del `users.id`; guarda `first_name`, `last_name`, `phone` nullable y revisión `updated_at`. El correo/status/rol se leen desde `users`, y Supabase Auth conserva `auth_user_id`/password. `course_instructor_history` retiene IDs de curso, instructor, actor y primer instante de asignación, con restricciones que impiden borrar perfiles/cursos/actores referenciados. Creación/edición de perfil y cambios de asignación se auditan; la asignación y su evento/historial se persisten transaccionalmente. PR 122 añade `PASSWORD_CHANGED` sin password ni token. La llamada Auth y la escritura PostgreSQL son secuenciales, no una transacción distribuida; si falla la auditoría tras éxito Auth, se registra un fallback sanitizado y no se revierte/reporta como fallido el password ya cambiado.

Para disponibilidad se consideran grupos `PLANNED` del instructor entre cursos —con independencia del estado editorial del curso—; un grupo `CANCELLED` deja de reservar su horario. El intervalo de fechas de cursos es inclusivo por día civil `America/La_Paz`, con sesiones recurrentes L–V y horario diario semiabierto: turnos contiguos son válidos. Las comprobaciones abarcan cursos con fechas intersecantes y distintos grupos. Migración 0014 se desplegó a local y cloud mediante el release PR 126.

#### Lifecycle de cuenta instructor (0016, integrado en development y aplicado localmente)

La migración `0016_instructor_lifecycle_outbox` añade `instructor_account_deletions`: registro de eliminación pendiente/completada con instructor, actor, `auth_user_id` y tiempos de solicitud/fin; FK `RESTRICT` a users/actor, índice por actor, RLS habilitado y grants Data API revocados. El repositorio conserva una fila tombstone mínima tras quitar perfil/rol para respetar referencias de auditoría, y mantiene el estado bloqueado para reintentar la etapa Auth externa si falla. Solo permite eliminación cuando no existe historia/dependencia y el usuario tiene rol exclusivo `INSTRUCTOR`; perfiles con historia conservan identidad. La migración se integró en `development` mediante PR 134 y se aplicó localmente sin reset (ledger 16→17); el release posterior de Fase 5 lleva cloud a ledger 18. La fuente final validada en PR 136 pasó integration 98 y E2E 120/120.

### Group

- id
- courseId
- courseTypeRevisionId (revisión de formato conservada)
- capacity (máximo por grupo; no mínimo)
- status (`PLANNED` o `CANCELLED`)
- publishedAt (nullable; instante de primera exposición pública, inmutable una vez definido)
- startsAt / endsAt (primer y último encuentro, hora civil boliviana)
- createdAt / updatedAt (concurrencia optimista)

La creación está disponible para cursos `DRAFT` o `PUBLISHED` con plan L–V y duración de sesión conocida; no para cursos archivados. Los grupos creados en curso publicado marcan `published_at` inmediatamente; si un curso borrador se publica después, las operaciones posteriores reflejan su exposición. La migración 0009 reconstruye la exposición histórica desde estados y auditoría de cursos, y un trigger impide borrar grupos con `published_at` o alterar ese instante. Por tanto, un grupo que nunca fue publicado puede eliminarse; uno ya publicado se conserva y se desactiva/cancela o reactiva. Los encuentros se repiten de lunes a viernes y solo cambia la hora inicial por grupo; la hora final y última fecha se derivan de la revisión fijada. No se almacena ni infiere número de inscritos mientras no exista el módulo de inscripciones. Las operaciones se auditan; la creación y las ediciones se serializan mediante bloqueo del curso padre y se rechazan solapamientos entre grupos planificados del mismo curso. El instructor se hereda del curso y los grupos `PLANNED` participan en la comprobación de conflictos entre cursos; la generación de sesiones, reprogramación individual y asistencia se describen abajo. No hay calendario global de feriados.

### Sesiones y asistencia (Fase 6, release en producción)

La migración `0019_phase6_attendance` incorpora seis tablas: `group_sessions`, `session_roster`, `participant_attendance`, `instructor_attendance`, `attendance_settings` y `attendance_command_receipts`, además del enum `attendance_state` (`PRESENT`, `ABSENT`, `EXCUSED`). Todas habilitan RLS y revocan grants de Data API. En el release de Fase 6/PR 211, 0019 se aplicó sin reset en Supabase local y producción, ambos ledgers quedaron en 20 y se preservaron filas históricas, Auth, Storage y settings. El release correctivo PR 228 no añadió migraciones; ledger y conteos cloud no se verificaron de nuevo de forma independiente en ese release.

`group_sessions` conserva la revisión de formato, hora y duración por encuentro. La cronología original es inmutable mediante trigger; cancelación conserva fecha/actor/motivo, y un reemplazo se vincula a una sesión cancelada del mismo grupo, con idéntica duración. Una cadena mantiene como máximo un encuentro activo por familia; cancelaciones individuales liberan el intervalo y mantienen el historial. La regla de conflictos también protege grupos planificados con encuentros cancelados que todavía esperan una recuperación por desactivación de grupo. El `officialEndsAt` del curso no cambia; el fin operativo deriva del último encuentro no cancelado. No hay calendario global de feriados: ADMIN cancela/reprograma sesiones específicas y puede indicar `Feriado` como motivo.

Crear grupos genera el calendario en la transacción del alta; grupos existentes se materializan idempotentemente en su primera lectura. Sesiones L–V pasadas requieren revisión administrativa inicial, estableciendo explícitamente el roster histórico. `session_roster` es evidencia append-only; tras completar la revisión, las ausencias faltantes se derivan únicamente para ese roster. Para calendarios ordinarios, la elegibilidad efectiva se deriva de la inscripción/pagos y timestamps registrados, sin adelantarla por fecha efectiva retroactiva de efectivo. Una marca faltante del día actual es `PENDING`; después del día se deriva como `ABSENT`, sin insertar marcas/auditoría ficticias. Sesiones canceladas no cuentan.

`participant_attendance` permite participantes `INSCRITO` elegibles para la sesión; los estados persistidos son presente/ausente/justificada. `PENDING` es una proyección, no valor almacenado. `instructor_attendance` conserva la asistencia del instructor asignado. `attendance_settings` es singleton independiente con `consecutive_absence_limit` entero positivo, default 3; no existe porcentaje mínimo ni snapshot porcentual. Se advierte al llegar a N ausencias consecutivas y `academicallyEligible` es falso si la racha máxima supera N. Justificada y presente interrumpen rachas; una marca pendiente separa la evidencia desconocida. La regla no genera certificado, no cancela inscripción/cupo ni provoca devolución.

Los command receipts son append-only e idempotentes por actor+request key/fingerprint. Las mutaciones validan actor/rol/ownership en servidor, estado del grupo/sesión, revisión optimista y conflicto temporal bajo la barrera de horarios existente. Fase 6 se liberó mediante PR 211; el contrato C1/C2 de cancelación/reprogramación (antes de inicio y sin marcas) se integró en PR 219 y salió en PR 228, sin cambio de schema/migración. Pruebas y límites del release en [`ATTENDANCE_CONTRACT.md`](ATTENDANCE_CONTRACT.md) y [`TESTING.md`](TESTING.md). El boceto `Session`/`Attendance`/`InstructorAttendance` inmediatamente debajo de esta sección es conceptual legado, no representa nombres de las tablas Drizzle reales.

### Participant

Implementado mediante migración 0017 (release Fase 5, cloud ledger 18): persona global de administración sin cuenta Auth. CI es texto único tras trim, eliminación de whitespace y uppercase, preservando ceros iniciales, letras/sufijos; no cast numérico, validación de formato nacional, checksum ni escaneo documental. No es `InterestRegistration` ni se fusiona por email. Una persona puede tener una preinscripción activa por curso y otras en cursos distintos. CI no se expone al roster instructor.

- id
- firstName
- lastName
- ci (identificador único como texto normalizado)
- email (requerido)
- phone (nullable)
- createdAt

Nombre/apellidos y email requerido, más teléfono opcional, pertenecen a ficha global. CI/ email se normalizan como texto; CI es la clave de unicidad y no convierte a número. El tipo `STUDENT`/`EXTERNAL`/`AUXILIARY` se decide por preinscripción; `AUXILIARY` aplica la configuración global sobre tarifa `STUDENT`, sin evidencia adicional. El snapshot de precio/descuento pertenece a cada registro.

### InterestRegistration (Fase 3, implementado)

Representa un registro público autónomo, separado de `Participant` y de la preinscripción presencial. El schema Drizzle y la migración versionada 0011 están implementados y desplegados. El email declarado públicamente no se verifica como identidad y no puede usarse para sobrescribir o fusionar datos de una persona global. La fila contiene `courseId`, nombre, apellidos, email normalizado, teléfono nullable, preferencia nullable, estado `ACTIVE`/`CANCELLED` y timestamps de precisión milisegundo. Un unique no parcial limita a un registro por curso/email en cualquier estado. La FK compuesta curso/grupo impide referencias cruzadas; las tablas nuevas habilitan RLS y revocan privilegios Data API a roles cliente.

No cobra, no ocupa cupo ni asigna grupo. La preferencia de grupo no implica asignación ni plazas. La tabla técnica `interest_registration_rate_limits` almacena solo claves HMAC, contador y expiración; no se conserva IP cruda. El limiter persistente y sus parámetros están implementados; el secreto server-only está configurado y el smoke de producción verificó el comportamiento de buckets ante headers forwarded falsificados (sin stress 429 ni verificación de HMAC sobre una IP real). El cierre de disponibilidad detiene nuevas solicitudes, no elimina registros. Política de retención, plazo y anonimización quedan pendientes; no se asume conservación perpetua. Ver [`INTEREST_REGISTRATION_CONTRACT.md`](INTEREST_REGISTRATION_CONTRACT.md) para reglas y estado detallado.

La migración `0011_interest_registrations.sql` añade el enum `interest_registration_status`, las tablas `interest_registrations` y `interest_registration_rate_limits`, unicidad no parcial por curso/email, FK compuesta opcional curso/grupo, checks de strings/email/teléfono, índices de listado/preferencia/expiración, RLS y revocación de privilegios Data API. La migración está versionada y aplicada en stacks temporales, Supabase local estándar y Supabase cloud mediante el pipeline de release; checksums/timestamps del ledger cloud coinciden con el repositorio. La integración completa pasó 65/65; consultar `docs/TESTING.md` para resultados locales y CI.

### PreRegistration (presencial, Fase 5)

`pre_registrations` está implementada en migración 0017 y conserva `participant_id`, curso/grupo, revisión de tarifa, `source_interest_id` opcional (FK compuesta al mismo curso), estado persistido `ACTIVE`/`CANCELLED`, tipo, configuración/revisión y snapshot monetario, flag de excepción del primer día, actor creador y datos de cancelación/actor. Una unique parcial permite solo una ACTIVE por persona/curso. No se borra: historial cancelado se conserva; trigger impide borrar o mutar snapshot/identidad y congela estado/grupo/motivo una vez cancelado. `membershipStatus` (`PREINSCRITO`, `INSCRITO`, `SALDOVENCIDO`, `CANCELADO`) y estado financiero son valores derivados de registro, pagos, curso y reloj, no columnas de estado adicionales.

La configuración singleton `registration_settings` guarda porcentajes enteros mínimos (1–100, default 25) y descuento auxiliar (0–100 inclusive, default 50), revisión, actor/fecha; afecta nuevas preinscripciones solamente. El precio aplicado queda como snapshot BOB en centavos, no float. Base AUXILIARY = tarifa STUDENT. El total con descuento se convierte a centavos con redondeo half-up; para total positivo el pago inicial alcanza `ceil(total × mínimo / 100)`. Total cero por AUXILIARY 100 % permite registro gratuito y exime mínimo, sin insertar abono cero. Migración 0018 permite que el motivo del movimiento de efectivo quede vacío (longitud 0–500); 0019 añade sesiones/asistencia.

`registration_ledger` almacena únicamente movimientos de efectivo positivos (`PAYMENT`/`REFUND`) con preinscripción, fecha efectiva civil Bolivia, actor, razón, receipt idempotente y `recorded_at`; la tabla tiene RLS, Data API grants revocados y trigger append-only. Fecha efectiva no puede ser futura respecto de la fecha Bolivia de registro. `registration_command_receipts` identifica comandos por actor + `request_key` único y fingerprint, guarda respuesta para reintentos idempotentes y es append-only. El servidor registra devoluciones, no ejecuta la transferencia; libre de pagos no produce refund monetario. `participants`, `pre_registrations`, `registration_settings`, command receipts y ledger tienen RLS y privilegios Data API revocados.

El prellenado desde `InterestRegistration` permite editar datos de participante; el origen se muestra read-only y se traza mediante `source_interest_id`, nunca se fusiona por email y no cambia métricas de intereses. Alta ordinaria exige curso publicado, instructor activo, grupo planificado y cupo; excepción ADMIN de primer día requiere pago completo y auditoría (registro gratuito no requiere pago cero). Cambio de grupo está limitado al mismo curso y cutoff, con transferencia atómica de ocupación; cancelar grupo genera devolución pendiente de lo efectivamente pagado, no una supuesta transferencia bancaria.

PR 179 integra rutas HTTP ADMIN de listado/alta/detalle/participante, búsqueda de interesado/participante, pagos/devoluciones/transfer/cancel, exportes y roster instructor. El roster DTO contiene solo nombre/apellidos del instructor asignado y no se consulta antes del inicio. CSV/PDF exportan curso/grupo, participante/CI, categoría, estados y montos financieros. Al release inicial de Fase 5 (`2e0eecb`), cloud quedó en ledger 18; Fase 6 avanzó después a ledger 20 (ver sección de sesiones). Los cierres documentales históricos de producción (`46fa1c0`, `152f610`) no se incorporan a esta rama.

### Enrollment

El boceto `Enrollment`/`Refund`/`PaymentReference` a continuación es histórico/no aprobado y no corresponde a tablas actuales. El modelo implementado de Fase 5 usa `pre_registrations` y `registration_ledger`; no existen tablas separadas de enrollment, payment reference o refund.

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

Fase 2A registra atómicamente `COURSE_CREATED`, `COURSE_UPDATED`, `COURSE_PRICES_UPDATED`, `COURSE_PUBLISHED`, `COURSE_WITHDRAWN` y `COURSE_ARCHIVED`. PRs 120–122 añaden `INSTRUCTOR_CREATED`, `INSTRUCTOR_UPDATED`, `COURSE_INSTRUCTOR_CHANGED` y `PASSWORD_CHANGED`; estos eventos no contienen passwords/tokens. `recordPasswordChanged` se persiste después de Auth: ambas fuentes no comparten transacción, así que un fallo de auditoría solo genera `PASSWORD_CHANGE_AUDIT_WRITE_FAILED` con actor ID y no revierte el cambio del proveedor. `actorId` referencia al usuario interno y está indexado; las consultas por entidad también están indexadas.

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
