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
Backend, UI y runner demo se integraron inicialmente mediante PRs 201–203;
PRs 204–205 y 207–209 cerraron consistencia y pruebas focales. Fase 6 se liberó
después mediante PR 211 y las correcciones operativas/calendario-filtros mediante
PRs 213, 214, 216–218. El commit de producción es
`3c6ae7e2cff74faeb2f0f7de05d63b753418df4a`. CI remoto de release:
`37405417986` y `37406246926`; 334 unitarias, 137 de integración y 127/127 E2E
pasaron sin flaky tests. Evidencia del gate de PR 218: comentario 6008610515.

La migración 0019 se aplicó a producción y al Supabase local sin reset; ambos
quedaron en ledger 20 y se preservaron Auth, Storage, configuración y filas
históricas. Producción tiene 22 grupos propios, 282 sesiones (280 originales,
2 reemplazos), 3 cancelaciones, 16 marcas de participantes y 4 del instructor.
El demo local contiene 12 cursos, 23 grupos, 16 registros y 13 movimientos de
caja; los conteos de producción correspondientes son 11/22/15/12. El E2E
histórico 126/127 y la revalidación focal 1/1 fueron ejecuciones previas
separadas; no deben confundirse con el gate posterior 127/127 de release.

Después del release, PR 219 integró C1/C2 backend; PR 223 integró la UI C3 de
grupo/participantes a `development` hasta `c6f98d3c0dba721d4c0f73450b68c8c31de8be90`.
El conflicto con el componente compartido `RegistrationActionDialog` se resolvió
al preservar el resolver de PR 221. Ninguno de estos cambios posteriores está
desplegado en producción. El gate final combinado sigue pendiente y no se
sustituye con pruebas focales.

### C1/C2 — límites backend de cancelación y reprogramación (PR 219)

Cancelación y reprogramación ADMIN solo proceden mientras `startsAt > now` y no
existe ninguna marca de participante ni del instructor, también en la mañana
del mismo día. La comprobación server-side ocurre dentro de la transacción: se
adquieren primero las barreras de horario/sesión, se vuelve a consultar la
presencia de marcas y se muestrea el reloj después de esperar por los locks. Así
se rechazan acciones con fecha/hora vencida o cambios de asistencia concurrentes.

`AttendanceSessionDto` expone `canCancel` y `canReplace` explícitos; son guía de
interfaz, no sustituyen la validación transaccional. `canReplace` además requiere
grupo `PLANNED` y que la familia no tenga otro encuentro activo. La fecha/hora de
reemplazo debe ser futura, mantener duración y superar la validación de conflictos
de instructor/grupo. Una familia de original/reemplazos tiene como máximo un
encuentro activo, mientras los cancelados y sus razones permanecen en cronología.
El backend está en `development` por PR 219 y la página de participantes/calendario
se integró mediante PR 223; ambos siguen fuera de producción.

La limitación operativa no impide la corrección histórica ADMIN por el flujo de
asistencia: una sesión cancelada no recibe marcas nuevas, pero evidencia ya
existente puede revisarse/corregirse conforme al contrato histórico. La UI C3
debe mostrar motivo y reemplazo y no presentar acciones operativas para la sesión
cancelada.

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
  Para escrituras del plan de grupos/asignaciones, un grupo `PLANNED` conserva
  los intervalos cancelados por desactivación del grupo que aún esperan una
  recuperación; reactivarlo no permite reservar simultáneamente otro grupo
  incompatible. Cancelaciones individuales liberan su intervalo y ancestros
  con recuperación vinculada no reservan de nuevo. El calendario operativo
  sigue excluyendo toda sesión cancelada y no se restaura automáticamente.

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
APPLY local confirmado añadió 28 sesiones, 16 marcas de participante y 4 marcas
de instructor junto con sus fixtures financieros; los totales y escenarios están
en [`FINANCIAL_DEMO.md`](FINANCIAL_DEMO.md). Producción no se ejecuta hasta el
gate/release autorizado. Para sesiones históricas se establece roster/revisión
explícitos; no se cambian timestamps financieros ni se crean cuentas Auth desde
tests.

El backend reportó 12 pruebas unitarias y 12 de integración focales; la UI y el
seed tienen cobertura dirigida propia documentada en el registro de milestone.
Las integraciones aisladas usan `runWithTestStack` en Supabase temporal y no
acceden al stack canónico. Esa evidencia focal no equivale al gate unit/
integration/E2E/build combinado: se ejecutará una vez al cierre coordinado.
