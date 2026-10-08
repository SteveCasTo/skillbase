# Contrato backend de cierre académico por grupo (Fase 8)

## Estado y límite de release

El alcance funcional de Fase 8 está aprobado. El core de cierre se integró por PR 280, exporters por PR 281, UI SSR/policy de cierre por PR 282, backend ADMIN por PR 283, pruebas de descarga por PR 284 y UI ADMIN por PR 285, todos en `development`. Las migraciones candidatas 0021/0022 solo se aplicaron en QA temporal (ledger 21→22→23), no en Supabase canónico/cloud (ledger 21). El release `master` sigue en Fase 7 `91beccf8`; Fase 8 aún no se ha promovido a producción y el gate combinado final sigue pendiente.

El árbol integrado contiene workspace SSR/historial, los seis GET adapters y policy de rutas acotadas para ambos contextos: ADMIN en `/app/cursos`, INSTRUCTOR en `/app/mis-cursos`; loaders revalidan actor/ownership. El owner verificó los seis endpoints de descarga de forma focal live en QA; esto no equivale al gate combinado ni a disponibilidad en producción. Fase 8 permanece pre-release. Progreso/evidencia en [`PLAN.md`](PLAN.md) y [`TESTING.md`](TESTING.md).

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
- `handleClosureDownload(context, artifact, requiredRole, repository?)` renderiza un documento a partir del `ClosureVersionDto` autorizado que obtiene `loadAcademicClosureVersion`; `artifact` se limita a `planilla.pdf`, `planilla.csv` o `informe.pdf`. No consulta el snapshot crudo ni sustituye datos históricos por valores live.

Se añadieron seis Astro GET route modules bajo contextos ADMIN/INSTRUCTOR:
`/app/cursos/:id/grupos/:groupId/cierre/:version/{planilla.pdf,planilla.csv,informe.pdf}`
y equivalentes bajo `/app/mis-cursos/:id/grupos/:groupId/cierre/:version/`.
Fijan role requerido y artifact. Las rutas están registradas en
`PRIVATE_ROUTE_POLICIES` con patrones acotados; el middleware sigue fail-closed
para rutas privadas no declaradas y el loader revalida contexto y ownership. Se
reportó una prueba focal live-browser/GET de las seis rutas en QA; no demuestra
disponibilidad en producción ni reemplaza el gate final.

Las rutas SSR de workspace/version son `/app/cursos/:id/grupos/:groupId/cierre`
y `/:version`, con equivalentes bajo `/app/mis-cursos`. La policy fail-closed
acotada incluye workspace, historial y `planilla.pdf`, `planilla.csv`,
`informe.pdf`: ADMIN para cursos e INSTRUCTOR para Mis cursos; loader revalida
ownership. Los seis route modules y enlaces SSR están integrados por PRs 281/282.
Su disponibilidad en producción depende del release F8.

El comando requiere `requestKey` UUID y `revision`; `reopen` requiere además `reason` (1–500 caracteres). El body admite opcionalmente `courseId`/`groupId` solo como referencias que deben coincidir con el contexto de ruta; para reabrir no se aceptan campos desconocidos. El helper valida origen y límite de 65 536 bytes. Respuestas usan `{ok:true,value,message}` o `{ok:false,code,message,issues}`, JSON `private, no-store` y `nosniff`. Mapeo: autorización 403, contexto inexistente/ajeno 404, revisión/idempotencia/estado cerrado o bloqueo 409, validación 422 y fallo inesperado 503 saneado. Páginas SSR workspace/history y los adapters GET están montados en development por PRs 281/282; no están desplegados en producción.

Las descargas reciben IDs/role context desde el route adapter y sesión fresca de
`Astro.locals`; versión debe ser entero positivo canónico. Requieren role
`ADMIN` o `INSTRUCTOR`, y el loader revalida estado/ownership antes de render.
401/403/404 y errores de evidencia invalidada salen con headers
`private, no-store`/`nosniff`; el éxito usa content type PDF o `text/csv` y
filename fijo derivado de número de versión y artefacto, nunca del nombre del
usuario.

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

## Proyección de privacidad y documentos exportados (integrados en development)

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
ID de versión, nunca el snapshot. Los renderers aceptan solo un
`ClosureVersionDto` con `AuthorizedClosureReportDto` obtenido por el loader
autorizado: no reciben un reporte JSONB raw ni valores live de umbral/settings.
Los seis route modules implementan estos GET versionados:

- ADMIN: `/app/cursos/:id/grupos/:groupId/cierre/:version/planilla.pdf`,
  `/planilla.csv` e `/informe.pdf`.
- INSTRUCTOR: mismos artefactos bajo
  `/app/mis-cursos/:id/grupos/:groupId/cierre/:version/`.

Cada módulo fija role requerido y artifact. Los paths están registrados en
`PRIVATE_ROUTE_POLICIES` con patrones acotados por contexto; policy más loader
revalidan rol y ownership. La verificación live focal pasó en QA; no se afirma
release a producción.

El CSV de planilla usa UTF-8 BOM, separador `;`, quoting/escaping y mitigación de
formula injection incluyendo espacios/caracteres Unicode iniciales. Notas/pesos
se escriben con dos decimales. La columna CI se incluye solo para ADMIN;
INSTRUCTOR recibe nombres, componentes/notas, resultado y asistencia/elegibilidad
sin CI/contacto/categoría/finanzas. El PDF embebe Noto Sans existente (OFL) en el
bundle SSR; no se descarga ni almacena una fuente/archivo de la persona. PDF
planilla e informe usan metadatos históricos; el informe añade resumen de
resultados/asistencia. Nombre de actor, fecha, minimum grade y umbral de
ausencias vienen del snapshot, no del perfil/curso/settings actuales. Glifos no
soportados fallan explícitamente (`PDF_UNSUPPORTED_TEXT`/409), no se truncan ni
sustituyen. Se reutilizan `pdf-lib`, `@pdf-lib/fontkit` y la fuente ya incluida;
no se añadieron dependencias.

PR 284 añadió tres E2E focales de descarga; el owner verificó seis GET/download
paths reales en QA. La suite directa de handler/adapter no sustituye la prueba
por navegador ni el gate combinado. El backend multi-ADMIN está integrado por PR
283 y su UI por PR 285; `closureActorDependencies` forma parte del inventario de
actividad usado por lifecycle. No se implementan certificados, firmas, QR,
emisión o verificación de Fase 9.
