# Contrato de evaluaciones y notas (Fase 7)

## Estado y alcance

Contrato funcional/técnico aprobado antes de comenzar la implementación de
Fase 7. PR 230 integró el backend base y PR 232 integró cuatro páginas Astro y
componentes de esquema/notas en `development`. PR 235 liberó backend/UI y migration
0020 a producción. En local canónico, 0020 se aplicó con ledger 20→21 y rerun
idempotente; cloud Management API confirmó ledger 21 y las tablas F7 vacías con
permisos restringidos. La consulta cloud fue read-only y no comparó hashes
pre/post de todas las filas. Fase 7 está liberada dentro de su alcance; Fase 8/9
siguen fuera de alcance. El progreso y las limitaciones se registran en
[`PLAN.md`](PLAN.md), el modelo persistido en [`DATA_MODEL.md`](DATA_MODEL.md) y
la capa de seguridad/ownership en [`SECURITY.md`](SECURITY.md).

Helpers server integrados y usados por la UI: `loadCourseEvaluations({actor, courseId,
groupId?, repository?})` devuelve `{available:true,data}` o `{available:false,
status,code,unavailableReason}`; `handleEvaluationPost({request, actor,
repository, siteUrl, operation, courseId, groupId?})` admite `scheme`/`grade` y
devuelve `{status,payload}`. PR 232 los conecta a las rutas Astro ADMIN e
INSTRUCTOR descritas en [`ARCHITECTURE.md`](ARCHITECTURE.md); PR 235 los liberó.
La semántica de `passed` es clasificación académica de nota y no emite ni cierra
certificados/cursos.

Los comandos de POST llevan `requestKey`, `courseId`, `schemeRevision` y
`groupId` opcional; el fallback HTML de guardar una nota lleva `registrationId`,
`componentId`, `gradeRevision` y `score`. La UI interactiva guarda las
calificaciones modificadas de una fila en una sola operación `row`, que contiene
`registrationId` y la lista de `{componentId, gradeRevision, score}` modificados;
guardar esquema envía la lista completa de componentes. El helper HTTP valida origen, body de hasta 65 536 bytes y allowlist
de campos; curso/grupo se fijan desde el contexto de ruta. Respuestas correctas
son `{ok:true,value,message}`; errores son `{ok:false,code,message,issues}`.
Errores de validación: 422; autorización: 403; contexto ajeno/inexistente: 404;
revisión, esquema congelado o conflicto de idempotencia: 409; fallo inesperado:
503 sin detalles internos. JSON es `private, no-store` y `nosniff`.

El esquema se guarda como reemplazo completo bajo `schemeRevision`; la nota lleva
además `gradeRevision`. Una revisión obsoleta se rechaza y requiere recargar, no
sobrescribe cambios concurrentes. Los comandos guardan receipt por actor y
`requestKey` con fingerprint: repetir la misma operación devuelve el resultado
registrado; reutilizar la clave con otro payload da conflicto. Los resultados
completos se derivan tras cada nota; mientras falte alguna se conserva estado
`PENDING`/`finalGrade:null` y decisión explícita `0.00`.

La UI integrada expone el esquema global en páginas de curso y el roster de
calificaciones en páginas de grupo, para ADMIN y para INSTRUCTOR en sus cursos
propios. El esquema conserva drafts por atributo y una confirmación global; las
notas se editan visualmente por celda, pero la variante JavaScript guarda todos
los cambios de la fila atómicamente. Un valor vacío continúa como pendiente y no
es una petición para borrar una nota persistida. El fallback SSR/HTML conserva
formularios individuales de componente. El estado incompleto se distingue de una
nota completa cero, y ADMIN puede consultar historial de correcciones.

PR 258 integró `saveRow` en dominio/aplicación/repositorio y el adaptador HTTP.
Las escrituras de notas y sus triggers existentes se ejecutan dentro de la misma
transacción; un fallo no deja una fila parcialmente persistida. No fue necesaria
migración. La validación de PR 258 fue focal: 5 unitarias y 2 de integración,
63 assertions; no equivale a suite completa. PR 262 actualizó la UI de evaluación;
ver E2E focal y QA visual segmentada en [`TESTING.md`](TESTING.md). El gate
combinado del milestone de correcciones sigue pendiente.

Fase 7 configura componentes de evaluación por curso, registra notas y calcula
un resultado académico final. No incluye cierre/reapertura de curso, planilla
oficial ni otros procesos de Fase 8; tampoco elegibilidad o emisión de
certificados de Fase 9.

## Esquema de evaluación

- Cada curso tiene componentes con nombre libre y peso decimal. Los pesos deben
  sumar exactamente 100 %, sin tolerancia ni comparación de punto flotante.
- La modalidad global se deriva de los tipos de sus componentes: `THEORY`,
  `PRACTICAL` o mixta. El nombre del componente no queda restringido a un
  catálogo cerrado.
- Una vez persistida la primera nota de cualquier participante en el curso,
  incluidos valores `0`, se congelan sus componentes y pesos. No se permite
  editar el esquema después de ese momento en este alcance. Una futura política
  para editar pesos no está aprobada.
- Las notas por componente son decimales con hasta dos posiciones y rango
  inclusivo 0–100. Las notas y resultados no se calculan usando `float`;
  sumas, productos y validaciones utilizan aritmética decimal exacta.

## Cálculo y resultado

Para una evaluación completa, la nota final es `Σ(nota × peso ÷ 100)`. Solo el
resultado final se redondea a dos decimales; no se redondean productos o
subtotales intermedios. Se persiste/presenta ese valor y se compara
ese mismo valor mostrado contra la nota mínima vigente del curso
(`minimum_grade`). La referencia inicial es 70/100, pero 70 es un default
provisional de configuración del curso, no una regla universal inmutable.

Si falta una nota requerida, el resultado se marca explícitamente incompleto o
pendiente. No se exime al participante ni se muestra el resultado como completo:
para la decisión académica, una evaluación incompleta equivale explícitamente a
0 hasta completar las notas faltantes. La interfaz debe distinguir ese 0
provisional/incompleto de una evaluación completa cuya nota final sea realmente 0.

No hay tolerancias ocultas en la suma de pesos ni doble redondeo. Toda validación
repite las reglas en servidor; los controles de interfaz no son autoridad.

## Participantes, roles y ventana

- Solo participantes con preinscripción en estado `INSCRITO` son evaluables.
  `PREINSCRITO` y `SALDOVENCIDO` no califican.
- Un instructor solo gestiona evaluaciones de cursos propios y desde el inicio
  oficial del curso.
- `ADMIN` puede gestionar evaluaciones de cualquier curso y conserva acceso
  administrativo independientemente de que también posea rol `INSTRUCTOR`.
- El estado de elegibilidad derivado de asistencia no bloquea ni impide registrar
  notas. No se convierte una regla de asistencia en una condición de la
  evaluación.

Las rutas, queries, DTOs y comandos deben aplicar autorización/ownership en
servidor y limitar los datos de participantes al roster permitido del curso.

## Integridad y auditoría

Las notas deben conservar precisión decimal y vínculo inequívoco entre curso,
componente y participante elegible. Las correcciones de notas son auditables;
el registro debe permitir identificar el cambio y su actor. No se exige en este
contrato una razón obligatoria para corregir. Los componentes/pesos no pueden
mutarse después del primer valor de nota persistido, aunque luego se corrija o
elimine esa nota; el estado de congelamiento debe permanecer verdadero.

La implementación debe probar validación exacta de suma de pesos, rango y
precisión, cálculo sin redondeo intermedio, el límite de nota mínima usando el
mismo redondeo presentado, estado incompleto, congelamiento al guardar cero,
autorización ADMIN/INSTRUCTOR, ventana de instructor, exclusión de estados
distintos de `INSCRITO` e independencia de la elegibilidad por asistencia.

## Fuera de alcance explícito

- Informe y firmas administrativos, que requieren definición aparte.
- Cambiar componentes/pesos tras existir la primera nota persistida.
- Eximir evaluaciones o participantes de componentes faltantes.
- Bloquear la calificación por asistencia.
- Certificados, PDF, firmas de certificado, QR, verificación o revocación
  (Fase 9).

El cierre por grupo de Fase 8 recibió aprobación después del release F7. El
core backend se integró mediante PR 280, incluido su guard de escritura de
notas. Renderers de export y seis GET adapter modules están en el worktree
`feat/academic-closure-exports`, aún sin integrar. Sus reglas,
helpers y estado están en [`ACADEMIC_CLOSURE_CONTRACT.md`](ACADEMIC_CLOSURE_CONTRACT.md),
[`REQUIREMENTS.md`](REQUIREMENTS.md) y [`PLAN.md`](PLAN.md). El cierre no cambia
las invariantes F7: solo `INSCRITO` se califica, una nota faltante sigue
pendiente, elegibilidad de asistencia no bloquea calificar y esquema/pesos no
se descongelan al reabrir.

### Escritura por fila y cierre de grupo (backend parcial; no liberado)

- Un guardado de una fila de calificaciones debe guardar todas las celdas
  modificadas de esa persona atómicamente; la presentación puede permitir edición
  independiente por componente. Una celda vacía significa pendiente, no cero ni
  eliminación autorizada de una nota persistida.
- Los repositorios `saveRow` y `saveGrade` consultan el estado de cierre en su
  transacción y rechazan escrituras si el grupo de la inscripción está cerrado.
  La migración candidata también añade una guarda DB sobre `evaluation_grades`,
  como defensa en profundidad. Reabrir permite corregir notas, pero no descongela el esquema
  de Fase 7.
- El cierre requiere sesiones y asistencia resueltas y notas completas para todo
  el roster `INSCRITO` del grupo. Cancelar una sesión la resuelve; no es necesario
  restaurarla. Revisión histórica pendiente y marcas pendientes bloquean. No se
  crean marcas ocultas para completar el cierre. Las señales de elegibilidad de
  asistencia son informativas y no bloquean el cierre, pero forman parte del resultado
  académico combinado.
- Mientras el grupo está cerrado, el servidor debe rechazar escrituras de notas o
  asistencia que afecten el registro oficial, incluidas operaciones alternativas
  al editor visible. Reabrir requiere `ADMIN`, motivo obligatorio y auditoría;
  instructor solo puede cerrar grupos con ownership vigente y desde el inicio
  del curso; ADMIN puede cerrar cualquier grupo. Todos los ADMIN tienen permisos
  iguales, pero su creación/lifecycle permanece pendiente.
- Alta/preinscripción y transferencia hacia un grupo cerrado se rechazan incluso
  si la ventana Fase 5 sigue abierta. Reabrir primero mantiene sus ventanas y
  demás reglas financieras Fase 5. El guard no añade restricciones a transferir
  fuera del grupo cerrado, pagar, cancelar/refund ni caja existente. Replay de
  comando completado conserva su receipt/respuesta original; un intento nuevo
  rechazado no deja escritura parcial de participant/registration/payment/receipt
  ni auditoría.
- Cada cierre publica una versión inmutable con timestamp, UUID del actor y
  nombre del actor como se mostraba en ese momento; los reportes históricos no
  resuelven el nombre dinámicamente desde el perfil actual. La planilla puede
  exportarse como PDF/CSV; el PDF incluye resumen de resultados, elegibilidad y
  asistencia. Reapertura seguida de otro cierre genera una versión adicional y
  conserva la anterior. Este alcance no exige formato institucional, firma ni
  certificado. El snapshot JSONB y su versión se implementan en la migración
  candidata 0021; 0021 solo se aplicó a stacks QA temporales, no a la base local
  canónica ni a cloud. Renderers CSV/PDF y seis route adapter files están en el
  worktree de exports, sin integrar. No se han añadido a
  `PRIVATE_ROUTE_POLICIES`, por lo que middleware los bloquea hasta la integración;
  UI/descargas no están disponibles en la app.

El snapshot interno `ClosureReportDto` conserva CI/balance para ADMIN y no añade
email/teléfono. Las lecturas actuales proyectan un DTO discriminado por role:
INSTRUCTOR recibe una allowlist recursiva de nombres/IDs operativos, notas y
asistencia, sin CI/contacto/categoría/finanzas, incluso ante propiedades
sensibles futuras en el JSON. Todas las vistas autorizadas —actual/provisional e
histórica— usan esa proyección; el JSON serializado se cubre en pruebas focales.
No hay todavía route/UI montada. Los futuros exports PDF/CSV deben consumir el
reporte autorizado de los loaders server-side, nunca leer/entregar el snapshot
raw sin autorización/proyección.
