# Contrato backend de sesiones y asistencia (Fase 6)

## Límites

`src/domain/attendance` contiene las políticas puras; `src/application/attendance`
expone casos de uso y el port `AttendanceRepository`. El adaptador es
`DrizzleAttendanceRepository(db, clock?)`. El reloj inyectable es server-side,
no una fecha enviada por el cliente. `getAttendanceRepository()` usa la conexión
del request existente. No se modifica dinero, cupo ni certificación al registrar
asistencia o cancelar/reemplazar una sesión. No hay porcentajes ni tardanzas.

La migración es `0019_phase6_attendance`, posterior a `0018_optional_payment_reason`.
Las seis tablas nuevas tienen RLS y grants Data API revocados. Las referencias
están indexadas; roster y command receipts son append-only. El guard de sesión
protege duración/revisión de formato, grupo del reemplazo y timestamps originales.
Backend, UI y runner demo están integrados en `development` mediante PRs 201–203.
Supabase local canónico aplicó 0018/0019 sin reset y quedó en ledger 20,
preservando 53 tablas. Cloud/`master` permanecen en Fase 5/ledger 18; 0019
no se ha aplicado en cloud y falta el gate combinado final/release.

## Casos de uso para UI y loaders

Todos reciben `(repository, actor, ...)`; los IDs son UUID.

| Export de `manage-attendance.ts` | Argumentos adicionales          | Resultado                    |
| -------------------------------- | ------------------------------- | ---------------------------- |
| `getAttendanceGroup`             | `courseId, groupId`             | `AttendanceGroupDto`         |
| `getAttendanceSession`           | `courseId, groupId, sessionId`  | `AttendanceSessionDetailDto` |
| `recordAttendance`               | `RecordAttendanceInput`         | `AttendanceCommandResult`    |
| `cancelAttendanceSession`        | `CancelSessionInput`            | `AttendanceCommandResult`    |
| `replaceAttendanceSession`       | `ReplaceSessionInput`           | `AttendanceCommandResult`    |
| `getAttendanceSettings`          | ninguno                         | `AttendanceSettingsDto`      |
| `updateAttendanceSettings`       | `UpdateAttendanceSettingsInput` | `AttendanceCommandResult`    |

Cada comando de sesión incluye `requestKey`, `courseId`, `groupId`, `sessionId`
y `revision` **entero** observado. La transacción vuelve a comprobar actor
ACTIVE, rol y ownership, tomando la barrera de horarios existente antes de
curso/grupo/sesión. Se rechazan revisiones obsoletas. Actor + requestKey +
fingerprint devuelve el mismo resultado confirmado al reintentar; cambiar
contenido con esa clave produce `IDEMPOTENCY_CONFLICT`.

`RecordAttendanceInput.marks` es un array de `{registrationId,status}` (sin
duplicados, máximo 1000 por comando). Estados internos: `PRESENT`, `ABSENT`,
`EXCUSED`; captions compartidas en `ATTENDANCE_LABELS`: Presente, Ausente,
Justificada. `PENDING` es una proyección, nunca un estado persistido.

Solo ADMIN puede enviar `instructorStatus`, `reviewRegistrationIds` o
`completeAdministrativeReview`, cancelar/reemplazar y cambiar settings.
Instructor solo registra sus grupos durante el mismo día civil Bolivia,
incluida la mañana anterior a la hora de clase. Nadie registra un día futuro.
ADMIN puede corregir evidencia pasada, incluso si después se canceló el grupo;
una sesión cancelada no admite nuevas marcas.

`AttendanceSessionDetailDto` entrega nombres/apellidos, ID de preinscripción,
marcas, rachas y flags académicos; no contiene CI, contactos, precios ni pagos.
`reviewCandidates` es un roster mínimo solo ADMIN para establecer explícitamente
la evidencia inicial de una sesión histórica. Los nombres de quienes marcaron
son reales; una ausencia inferida tiene `inferred:true`, actor/fecha nulos.

## Calendario y membresía

- Crear grupo genera sus sesiones en la misma transacción. Grupos existentes
  se materializan idempotentemente al leer por primera vez. Se reutiliza el
  planificador L–V y redondeo vigente: 20 h / 90 min = 13 encuentros completos,
  sin cambiar las 20 horas configuradas ni fechas oficiales del curso.
- Sesiones pasadas al generar quedan `administrativeReviewRequired:true`.
  No se inventa roster ni ausencia histórica. ADMIN selecciona candidatos
  realmente inscritos en ese día, registra evidencia y completa la revisión.
  **Completarla habilita inferencia de ausencias faltantes únicamente para el
  roster explícitamente establecido**; futuras lecturas no añaden participantes
  retrospectivamente a ese roster revisado.
- Para calendarios ordinarios, el roster se materializa sin jobs desde la
  cronología inmutable de registro/pagos. Activación = máximo de creación,
  inicio oficial y timestamp de registro del pago que cubrió el total. Total
  cero usa creación; nunca se usa una fecha efectiva de efectivo retroactiva
  para adelantar membresía. Transferencias ordinarias ya están limitadas al
  cutoff anterior al inicio, y cancelaciones conservan evidencia previa.
- Marcas faltantes permanecen pendientes durante el día; después del día son
  ausencias efectivas, sin insertar marcas manuales, actores ni auditoría falsa.
  Canceladas se excluyen de rachas y del horario reservado.
- `UPCOMING`/`ONGOING`/`COMPLETED` derivan del reloj; cancelación sí se persiste.
- Reemplazar cancela original + crea recuperación atómicamente. Se conserva
  vínculo y duración, incluso fines de semana o una hora anterior el mismo día.
  Se permite extender el calendario operativo. `officialEndsAt` permanece
  intacto; `operationalEndsAt` es el máximo fin de sesiones no canceladas.
- Una familia de original/recuperaciones conserva como máximo un encuentro
  activo, incluso al cancelar/recrear o encadenar reemplazos. No hay clases
  adicionales independientes ni ampliación de horas configuradas.
- Cambiar explícitamente el horario de un grupo antes del inicio conserva los
  timestamps viejos como cancelados y genera reemplazos vinculados: no se
  reescribe el calendario. Después de comenzar, o si faltan encuentros activos,
  se requiere reprogramar sesiones individuales. La cancelación del grupo
  cancela encuentros aún no terminados y retiene evidencia pasada. Reactivar
  grupo no deshace cancelaciones de sesiones; ADMIN planifica recuperaciones.
- Conflictos de instructor/grupo incluyen calendarios operativos y recurrencia
  de grupos todavía no materializados. Asignaciones/altas existentes usan la
  misma barrera y reconocen recuperaciones y cancelaciones.

## Configuración y elegibilidad

Singleton independiente `attendance_settings`: `consecutiveAbsenceLimit`
(entero positivo, default 3), revisión entera y fecha. Nunca se escribe el
singleton financiero al editar N; tampoco se crea un snapshot porcentual.
La lectura aplica la política **actual** a la evidencia existente. Hay aviso
al llegar a N ausencias consecutivas y pérdida de elegibilidad al superar N
en cualquier racha confirmada. PRESENT y EXCUSED interrumpen la racha;
PENDING no demuestra ausencia ni permite unir dos rachas a través de evidencia
desconocida. Una corrección puede reparar la elegibilidad; no cancela inscripción,
libera cupo, devuelve dinero ni emite/bloquea certificados en esta fase.

## Adaptador HTTP reservado para las rutas de UI

`handleAttendancePost({request,actor,repository,siteUrl,operation,courseId?,groupId?,sessionId?})`
acepta operaciones `record`, `cancel`, `replace`, `settings`. `operation` y los
IDs de contexto provienen de la ruta del servidor, no del body. Verifica origen,
body de hasta 65 536 bytes, tipos y allowlist de campos. JSON admite arrays;
el fallback form-urlencoded transmite `marks`/`reviewRegistrationIds` como JSON
en campos únicos. `startsAt` de recuperación es tiempo civil `YYYY-MM-DDTHH:mm`.
Revision/N admiten número JSON o texto decimal entero. Las rutas deben conservar
los guards privados/fresh Auth existentes y registrar su política fail-closed.

Resultado: `{status,payload}`. Éxito: `{ok:true,value,message}`, donde value es
`{kind:'session',sessionId,revision}` o `{kind:'settings',settings}`. Error:
`{ok:false,code,message,issues}`. `attendanceJson` añade `private,no-store` y
`nosniff`. Conflictos: 409; autorización: 403; inexistente/ajeno: 404;
validación: 422; infraestructura: 503 sin detalles internos.

La UI SSR/POST está montada en `/app/configuracion/asistencia`, en las rutas
ADMIN de grupos/sesiones y en las rutas equivalentes del instructor asignado.
Las rutas están incluidas en la política privada fail-closed. ADMIN configura N,
revisa/corrige evidencia histórica, cancela y reemplaza; el instructor solo
opera sus grupos y registra en el día civil Bolivia.

## Seed y validación

El runner financiero admite la extensión opcional de asistencia en
`scripts/attendance-demo.ts`; usa el contrato y repositorios existentes con
ADMIN existente y reloj server-side, y no hace reset. Su PLAN es de solo lectura,
exige destino/proyecto explícitos y verifica ownership/provenance; preserva
settings e historial financiero y aborta ante colisiones/ediciones inesperadas.
La carga APPLY local está en curso y no tiene resultado confirmado en este corte;
producción no se ejecuta hasta el gate/release autorizado. Ver
[`FINANCIAL_DEMO.md`](FINANCIAL_DEMO.md). Para sesiones históricas se establece
roster/revisión explícitos; no se cambian timestamps financieros ni se crean
cuentas Auth desde tests.

El backend reportó 12 pruebas unitarias y 12 de integración focales; la UI y el
seed tienen cobertura dirigida propia documentada en el registro de milestone.
Las integraciones aisladas usan `runWithTestStack` en Supabase temporal y no
acceden al stack canónico. Esa evidencia focal no equivale al gate unit/
integration/E2E/build combinado: se ejecutará una vez al cierre coordinado.
