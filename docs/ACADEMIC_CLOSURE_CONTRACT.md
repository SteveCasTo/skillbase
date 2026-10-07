# Contrato backend de cierre académico por grupo (Fase 8)

## Estado y límite de release

El alcance funcional de Fase 8 está aprobado. El backend base de cierre por grupo está en el worktree `feat/academic-group-closure`, basado en `development` `7807fc1`; el source aún es WIP, no está integrado ni liberado. La migración candidata es `drizzle/0021_phase8_academic_group_closure.sql`. Solo se aplicó a stacks Supabase temporales de QA (ledger temporal 21→22); no se aplicó al Supabase local canónico ni a cloud. El release `master` sigue en `91beccf8`, cloud ledger 21.

El backend/helper y la interfaz SSR están implementados en branches de feature, pero Fase 8 no es aún una entrega disponible completa: la interfaz está en `feat/academic-closure-interface` sin integrar y los GET exportadores viven en otro branch. La policy de workspace/history ya está en el source UI, pero la integración con los seis adapters PDF/CSV y una prueba navegable de descarga quedan pendientes. Fase 8 permanece parcial; multi-ADMIN y release/gate completo siguen pendientes. El progreso/pruebas por etapa están en [`PLAN.md`](PLAN.md) y [`TESTING.md`](TESTING.md).

## Responsabilidades y helpers actuales

El cambio mantiene el monolito modular y no mueve reglas de dominio a la capa HTTP:

```text
src/domain/academic-closure
→ src/application/academic-closure
→ src/server/academic-closure (loader/HTTP helper)
→ src/server/db/repositories/academic-closure-*
→ Drizzle/PostgreSQL
```

- `loadAcademicClosure({actor, courseId, groupId, repository?})` devuelve disponibilidad más `ClosureStateDto` con estado/version, blockers, provisional u oficial e historial.
- `loadAcademicClosureVersion({actor, courseId, groupId, version, repository?})` carga una versión histórica inmutable.
- `handleClosurePost({request, actor, repository, siteUrl, operation, courseId, groupId})` acepta la operación de contexto `close` o `reopen`; el actor y grupo/curso vienen del servidor/ruta, no de una identidad declarada por el cliente.

La UI/adapter SSR se encuentra en `feat/academic-closure-interface`. Sus rutas
son `/app/cursos/:id/grupos/:groupId/cierre` y `/:version`, con equivalentes
`/app/mis-cursos/:id/grupos/:groupId/cierre` y `/:version`. El route policy
fail-closed fija ADMIN para cursos y INSTRUCTOR/ownership para Mis cursos. Los
route module files de export PDF/CSV están en el feature separado
`feat/academic-closure-exports`; la policy contempla paths `planilla.pdf`,
`planilla.csv`, `informe.pdf`, pero estos archivos aún no forman parte del branch
de interfaz. Por tanto, la UI puede mostrar enlaces de descarga acordados, pero
su destino real espera integrar el branch export; no afirmar que el download fue
probado desde la UI.

El comando requiere `requestKey` UUID y `revision`; `reopen` requiere además `reason` (1–500 caracteres). El body admite opcionalmente `courseId`/`groupId` solo como referencias que deben coincidir con el contexto de ruta; para reabrir no se aceptan campos desconocidos. El helper valida origen y límite de 65 536 bytes. Respuestas usan `{ok:true,value,message}` o `{ok:false,code,message,issues}`, JSON `private, no-store` y `nosniff`. Mapeo: autorización 403, contexto inexistente/ajeno 404, revisión/idempotencia/estado cerrado o bloqueo 409, validación 422 y fallo inesperado 503 saneado. Esto no constituye todavía endpoint HTTP desplegado.

## Autorización y elegibilidad para cierre

- Actor debe ser usuario interno `ACTIVE`, revalidado en el repositorio durante la transacción. `INSTRUCTOR` puede operar solo sobre sus grupos/cursos y desde el inicio oficial del curso. `ADMIN` activo puede operar sobre cualquier grupo. Solo `ADMIN` puede reabrir.
- La validación adicional de `course.startsAt` para `INSTRUCTOR` refleja el guard implementado en este backend; la regla de alcance aprobada especifica ownership del grupo y no define por separado esta ventana. No presentarla como requisito de negocio acordado; verificar/ajustar antes de montar la ruta si no es intencional.
- El cierre es **por grupo**, no por todo el curso. El reporte se construye para la membresía de ese grupo y sus participantes `INSCRITO`; `PREINSCRITO`/`SALDOVENCIDO` no son evaluables ni añaden una nota pendiente al gate.
- Los blockers del dominio son `SESSIONS_UNFINISHED`, `GRADES_PENDING` y `ATTENDANCE_PENDING`: sesión activa con `endsAt` futuro; nota incompleta de persona `INSCRITO`; revisión administrativa histórica pendiente; o marca `PENDING` de participante/instructor cuando corresponde. Las marcas usan la proyección de asistencia vigente: no se insertan ausencias ni marcas ocultas para satisfacer el gate.
- Una sesión cancelada es una resolución válida y se excluye de estos blockers; no se requiere reactivarla para cerrar. El cálculo de racha/elegibilidad se conserva como información y forma parte del resultado académico combinado, pero no bloquea el cierre. El saldo y balance financiero son informativos, no un requisito académico adicional.
- La nota completa se calcula con reglas/precisión de Fase 7 y se compara con `minimum_grade` vigente al generar el reporte. La elegibilidad final combina `result.passed` y `attendance.academicallyEligible`; reabrir nunca descongela componentes/pesos tras la primera nota, incluso `0`.

## Versiones, snapshots e idempotencia

Un cierre escribe en **una transacción** la versión completa del reporte, el estado cerrado/revisión, receipt idempotente y evento de auditoría. Cada cierre incrementa la versión por grupo. Reapertura requiere motivo, conserva la versión previa y registra timestamp/actor UUID+nombre/motivo enlazados a ella; un cierre posterior crea una versión nueva. Mientras está cerrado el DTO presenta la última versión `official`; abierto presenta un reporte `provisional` recalculado y mantiene `history`/`reopenings`.

La versión snapshot persiste `closedAt`, UUID y nombre del actor como fueron capturados, y el reporte académico completo: curso/grupo, instructor, `minimumGrade`, esquema/componentes, configuración de asistencia, roster `INSCRITO`, notas/resultados/elegibilidad y evidencias/resumen de sesiones/asistencia. Las consultas históricas usan el nombre almacenado, no el perfil dinámico. Las versiones y reaperturas son append-only; los FK de actor/historia son restrictivos. La transacción no sustituye una versión previa con el reporte provisional posterior.

El receipt se acota por `(actorId, requestKey)` y guarda fingerprint del comando (operación, curso, grupo, revisión y motivo). Si el actor está vigente y el fingerprint coincide, repetir un comando ya completado devuelve exactamente el resultado almacenado antes de aplicar la revisión obsoleta; reutilizar la clave con otro payload responde conflicto. Cierre y cambios de membresía comparten la barrera transaccional global/locks de curso y grupo. Los triggers usan esa misma barrera. El lock serializa la decisión de cierre con escrituras de notas, asistencia, roster y entradas que apuntan al grupo.

## Reglas de grupo cerrado y compatibilidad con Fase 5

- Nueva preinscripción/alta o transferencia **hacia** un grupo cerrado se rechaza en servidor aunque siga abierta la ventana Fase 5. El guard se ejecuta dentro de la transacción bajo los locks de curso/destino y antes de crear la ficha/preinscripción, movimiento, command receipt o auditoría de una operación nueva; no queda escritura parcial.
- El replay exacto de una operación financiera/membership ya completada responde desde su receipt idempotente original, antes de reevaluar el nuevo estado del destino. Reutilizar el `requestKey` con otros datos continúa siendo conflicto.
- El guard nuevo no impone una restricción adicional a transferencia **desde** el grupo cerrado, pagos/receipts de caja, cancelaciones o devoluciones/refunds existentes. Estas operaciones conservan sus reglas, límites temporales, historial append-only y comportamiento Fase 5.
- Reabrir está sujeto a ADMIN activo, motivo y revisión/idempotencia; tras reabrir, cualquier alta/transferencia sigue sujeta a las reglas F5 existentes (ventana, curso/grupo, cupo, estado y finanzas). El cierre no borra ni modifica historial financiero.

## Persistencia y guardas PostgreSQL

`0021_phase8_academic_group_closure.sql` añade cuatro tablas: `academic_group_states` (estado/revisión/última versión por grupo), `academic_closure_versions` (snapshot JSONB con curso/grupo, versión, timestamp, actor ID/name), `academic_group_reopenings` (reapertura, actor y motivo) y `academic_closure_receipts` (clave, fingerprint y resultado). Unicidad de versión por grupo, receipt actor/key y reapertura por versión; relaciones a grupo/curso/actor/historia usan `RESTRICT`. RLS queda activado y los grants Data API a `PUBLIC`, `anon`, `authenticated` y `service_role` revocados.

Triggers hacen inmutables snapshots/reaperturas/receipts y rechazan insert/update/delete de grades, sesiones, roster y attendance que afecten un grupo cerrado; updates tampoco permiten mover evidencia cerrada a grupo abierto. Esta defensa complementa los guards transaccionales de los repositorios, no expone una RPC ni sustituye autorización server-side. `academic_group_states` es administrado por el repositorio autorizado.

## Proyección de privacidad e integración pendiente

El snapshot de administración queda privado en el backend e incluye los campos
actuales del reporte, entre ellos CI y balance; el modelo no incorpora email ni
teléfono. Los DTOs de salida añaden discriminante `access: "ADMIN" | "INSTRUCTOR"`.
Todas las lecturas autorizadas (estado actual/provisional, versión histórica y
loader) aplican la proyección de rol. `ADMIN` recibe el reporte íntegro. El DTO de
`INSTRUCTOR` es allowlist recursiva: nombres/IDs operativos, calificaciones y
asistencia; no incluye CI, contacto, categoría de participante ni datos
financieros, incluidos atributos privados que pudieran añadirse al snapshot más
adelante. La proyección no muta el snapshot almacenado. La prueba focal recorre
datos sintéticos que contienen también campos sensibles futuros.

`handleClosurePost` devuelve únicamente resultado de estado/revisión/versión e
ID de versión, nunca el snapshot. Cualquier futuro export PDF/CSV debe tomar un
`AuthorizedClosureReportDto` obtenido por `loadAcademicClosure` o
`loadAcademicClosureVersion`, respetando actor/contexto/rol; no leer la fila
JSONB directamente para entregarla al navegador ni a un renderer sin autorizar.

Siguen pendientes de integración: rutas/policies Astro, SSR/UI accesible de
cierre/reapertura y exportadores PDF/CSV. No hay endpoint público/privado ni
plantilla institucional montada. El lifecycle/provisionamiento multi-ADMIN está
aprobado pero sigue siendo paquete posterior; `closureActorDependencies` solo
expone las nuevas referencias actor-dependent para esa futura validación. No se
implementan certificados, firmas de certificado, QR, emisión o verificación de
Fase 9.
