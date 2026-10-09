# Demo integral F1–F8

## Alcance y autorización

La nueva autorización explícita del usuario permite datos ficticios de notas,
asistencia, cierre/reapertura y cuentas ADMIN, también en producción **después del
release de todas las correcciones y su CI completo verde**. Esto no inicia F9.
La autorización anterior de demos financieros/asistencia no incluía notas; esta
carga nueva es independiente y usa `skillbase-comprehensive-demo-v1`.

El runner `scripts/comprehensive-demo.ts` es una herramienta manual, nunca un
paso de deploy, un endpoint público ni una migración. PLAN es el modo por defecto.
No tiene reset, TRUNCATE, CASCADE, reparación de ledger, DDL ni desactivación de
triggers. No reescribe ni elimina filas existentes. La única baja elimina una
cuenta ADMIN **nueva, propia y sin uso**, mediante el lifecycle real; conserva
tombstone e intención completada.

## Datos agregados

| Sección actual                 | Escenarios nuevos                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catálogo/cursos/grupos         | 8 cursos `[DEMO]`, publicados/pasados/actuales/futuros, draft y archivado; 10 grupos, uno cancelado                                                                                                                    |
| Formatos                       | 3 formatos propios: pagado, gratuito y descontinuado sin cursos                                                                                                                                                        |
| Instructores/perfil/mis cursos | 4 identidades EMAIL propias y perfiles; asignaciones reales e historial, sin promover usuarios originales                                                                                                              |
| Interesados                    | 12 intereses públicos por casos de uso; preferencias/ninguna, activos/cancelados y conversión trazable; el interés independiente del otro curso permanece                                                              |
| Preinscripciones/participantes | 26 registros, 25 personas sintéticas por CI; una persona en dos cursos; STUDENT/EXTERNAL/AUXILIARY                                                                                                                     |
| Finanzas                       | Pago completo, parcial, segundo abono, saldo vencido, devolución pendiente/completada, transferencia de grupo y gratuidad sin ledger de cero                                                                           |
| Sesiones/asistencia            | Calendarios L–V; PRESENT/ABSENT/EXCUSED, rachas N y N+1, revisión histórica pendiente, sesión de hoy sin marca, cancelación por feriado y recuperaciones de hoy/fin de semana                                          |
| Evaluaciones                   | Esquemas de 2, 6 y 8 componentes, suma exacta 100 %, notas decimales, nota válida cero, aprobación exacta 70, reprobación y notas pendientes; componentes congelados por primera nota                                  |
| Cierre e informes              | Dos grupos cerrados: uno versión 1; otro cierre, reapertura justificada, corrección atómica, cambio de nombre del actor propio y versión 2; snapshots/versiones/receipts/auditorías producidos por repositorios reales |
| Administradores                | Cuenta nueva sin uso (eliminable), operador usado (desactivable), usada desactivada, usada reactivada y tombstone eliminado con outbox completado                                                                      |
| Configuración                  | Se conserva la configuración existente; la demo lee N/descuento/mínimo y muestra sus efectos sin cambiarlos                                                                                                            |

Las cinco tablas F8 reciben evidencia real: `academic_group_states`,
`academic_closure_versions`, `academic_group_reopenings`,
`academic_closure_receipts` y `admin_account_deletions`. No se fabrican snapshots
JSONB, hashes de export ni receipts manuales de comandos de negocio.

El schema actual solo evalúa/snapshottea `INSCRITO`; la persona con saldo vencido
se conserva en finanzas y **no bloquea el cierre** ni se introduce en el roster
académico por un bypass. La nota mínima 70 es una decisión del nuevo curso DEMO,
no un cambio global. Si el mínimo financiero configurado es 100 %, los ejemplos
«parcial/segundo abono» naturalmente se convierten en pago completo; nunca se baja
el umbral para forzarlos. N debe estar en 1–20 para una carga acotada; fuera de ese
rango el runner se niega, sin modificar settings.

No se crean certificados, QR, firma institucional, boletas, pasarela, documentos
de CI ni identidades Google ficticias. Artwork/Storage son opcionales y se
conservan sin agregar uploads ni políticas. SMTP, recovery y OAuth real no son
pruebas de esta demo. No se generan buckets técnicos de rate limit artificiosos.

## Destino explícito y credenciales

Se usan únicamente variables `DEMO_*`, nunca fallback a `DATABASE_URL`:

- `DEMO_DATABASE_URL`: conexión del destino explícitamente revisado.
- `DEMO_SUPABASE_URL`: API/Auth del mismo proyecto.
- `DEMO_SUPABASE_SERVICE_ROLE_KEY`: credencial privilegiada server-only.
- `DEMO_ADMIN_ID`: UUID interno de un ADMIN existente ACTIVE, con identidad Auth
  válida. Este operador no se renombra ni cambia sus credenciales/roles.
- `DEMO_ACCOUNT_PASSWORD`: contraseña inicial externa de 12–128 caracteres para
  **solo cuentas nuevas**; requerida para APPLY, no para PLAN. Usar un secreto
  fuerte. No incluir su valor en Git, argumentos, salida, tickets ni esta guía.

Auth se crea confirmado por Admin API (`email_confirm: true`), sin invitación,
recovery ni correo. Identidades nuevas usan `comprehensive.v1.*@example.test` y
`app_metadata.seed_owner`. EMAIL es su único proveedor; no se agrega Google ni
ROOT. El reintento recupera el mismo UUID propio sin rotar su password. IDs de
cursos/grupos/componentes/comandos/marcadores usan la convención hash determinista
ya utilizada por los otros runners; UUID Auth/interno asignado por los servicios
se conserva por identidad y manifiesto, no se sustituye por una cuenta aleatoria.

### Local

```text
bun run db:seed:comprehensive-demo --target local --project local
bun run db:seed:comprehensive-demo --target local --project local --apply
```

Verifica identidad exacta contra el Supabase local en ejecución. No aplicar en el
stack canónico hasta revisar el plan y obtener autorización del operador.

### QA aislado

```text
bun run test:integration:comprehensive-demo
```

Reutiliza `runWithTestStack`: proyecto, puertos, Auth/Storage y credenciales
temporales propios; 23 migraciones normales. No copia `.env`, no reinicia el
servidor del usuario ni usa su DB. `--target qa --project <ID_DEL_RUNNER>` solo
admite el stack validado por `getTestSupabaseEnvironment`; no acepta una DB
loopback cualquiera. No ejecutar el test Bun directamente contra desarrollo.

CI ejecuta esta integración real como segundo paso obligatorio del **mismo job
`integration`**: primero `bun run test:integration` (suite de producto, una vez),
después `bun run test:integration:comprehensive-demo` (un caso focal, una vez).
Cada runner crea y destruye su propio proyecto temporal; no se mueve el caso a
`tests/integration` porque los snapshots/notas cerradas son inmutables y su
dataset no debe contaminar el stack compartido de la suite del producto. No se
repite la suite completa, no se añade otro job ni se debilita el agregador.
El error de cualquiera de los pasos bloquea el job/agregador/deploy. El runner
focal también falla si no puede limpiar su proyecto propio; imprime únicamente
el ID/ruta exactos para recuperación acotada, sin keys. Los conteos de producto
y del caso seed se reportan por separado, no como una corrida compartida.

### Producción: operación cloud protegida completada

#### Canal protegido GitHub

`production-comprehensive-demo.yml` es exclusivamente `workflow_dispatch` en
master y environment `production`, con permisos contents/actions read y la misma
cola no cancelable que el operador financiero anterior (que queda intacto).
El CI ordinario/Vercel siguen bloqueados. La excepción explícita comprueba
evento, repositorio, ref, workflow exacto, SHA de workflow/dispatch/aprobación y
checkout master limpio; no elimina `CI` ni abre endpoints HTTP.

Inputs: `mode` (plan/apply), `approved_release_sha`, `release_ci_run_id`,
`project_ref` y, para APPLY, `reviewed_plan_sha256`. Primero integrar a development,
liberar a master y esperar CI completo attempt 1 verde y alias productivo READY
para **ese nuevo SHA**, no el release anterior `4e067311`.

El controlador verifica por APIs read-only master actual, run push del workflow
CI exacto, todos sus jobs obligatorios/deploy, evidencia E2E completa sin retries
ni flaky, y deployment actual del alias con proyecto/SHA/master/production READY.
PLAN enumera todas las tablas public/Auth/Storage/Drizzle y obtiene solo hashes
de PK/fila completos desde PostgreSQL. No lee/exporta valores secretos de filas.
El hash revisable vincula plan/anchor, settings, actor, baseline, proyecto y SHA.
APPLY exige ese hash idéntico, revalida release y baseline antes de crear cuentas,
compara preservación original tras APPLY y repite el runner una vez exigiendo
cero cambios completos. Cambio de fecha/settings/datos exige nuevo PLAN; actividad
concurrente legítima puede bloquear comparación, nunca se «repara» para pasar.

Solo el job protegido recibe `MIGRATION_DATABASE_URL`,
`DEMO_SUPABASE_SERVICE_ROLE_KEY` y `VERCEL_TOKEN` existentes. Variables:
`DEMO_ADMIN_ID`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Antes de APPLY, el operador
aprovisiona `DEMO_ACCOUNT_PASSWORD` como secreto protected production desde el
archivo privado de credenciales DEMO, sin poner su valor en comandos, logs, inputs
ni Git. No extraer secretos sensibles de Vercel.
PLAN no requiere esa contraseña; solo APPLY la recibe. Las credenciales originales
no cambian y no se envía correo. El canal protegido exige 20–128 caracteres; usar
la contraseña criptográfica ya generada, no una contraseña débil nueva.

El artifact exitoso contiene plan sintético, conteos/digests agregados y resultado,
no passwords, tokens, URL DB, identidad real del actor ni hashes por fila Auth.
Witnesses por fila permanecen solo en memoria. Ante fallo, el stage sanitizado
bloquea el job; Auth puede conservar cuentas propias parciales y exige revisión
antes de reintento. La cola serializa ambos operadores demo, **no** el deploy
existente: el owner debe evitar despliegues durante APPLY y cualquier cambio de
master previo a escribir se rechaza en la comprobación inmediata.

La validación focal del canal protegido cubrió 15 tests/385 assertions; el caso
real aislado pasó 1/1/894 assertions, preservó 70 tablas/416 filas originales y
su repetición no hizo cambios. También se comprobó el rechazo de un hash de plan
distinto antes de aprovisionar Auth. La ejecución cloud real se documenta abajo.

El workflow queda sujeto a los guards descritos: master exacto y limpio, gate y
deployment del SHA aprobados, hash del plan revisado, snapshot pre/post y APPLY
protegido. No usar la CLI de producción desde una shell ordinaria, Vercel o CI
ordinario; el canal soportado es el workflow manual protegido.

## Atomicidad, reintentos y límites

- El primer anchor es la fecha civil Bolivia actual; `--anchor` solo puede
  confirmarla. Tras completar, el anchor persistido no se mueve aunque cambie el
  día. Las fechas históricas se simulan únicamente con los relojes ya inyectables
  de los repositorios, sobre fixtures nuevos; no hay reloj cliente ni bypass de
  validación/autorización, settings o triggers en la app.
- Preflight detecta colisiones de IDs/slugs/formatos/CI/componentes antes de
  aprovisionar Auth y vuelve a comprobar bajo los locks existentes. Las cuentas
  se recuperan solo con metadata privilegiada y vínculo Auth interno exacto.
- Finanzas/asistencia/notas/cierre/intereses/calendarios y manifiesto se completan
  en una única transacción con savepoints de los repositorios. Settings se
  revalidan/bloquean antes de escribir. Ningún comando de cierre debilita la
  inmutabilidad de notas/componentes/snapshots.
- Auth y PostgreSQL no tienen transacción distribuida. Si falla el bloque de
  negocio, pueden quedar cuentas demo propias aprovisionadas; sus UUIDs y
  lifecycle se recuperan idempotentemente. Compensación solo borra UUID creado
  por esa invocación; la baja ADMIN usa intención durable y permite reintento.
- Un manifiesto completo evita volver a ejecutar cualquier operación financiera,
  grading, cierre o lifecycle. Conserva ediciones posteriores de los demos y no
  «repara» datos. Mismo operador/namespace; otro actor o anchor incompatible se
  rechaza. Ejecutar un solo operador a la vez; una carrera falla cerrada por
  unicidad/locks, no es un coordinador distribuido de jobs Auth.
- Dataset deliberadamente acotado, no un generador de millones de filas ni prueba
  de carga. Para renovar fechas después de usar/editar los demos, diseñar una
  nueva versión revisada, nunca resetear historia inmutable.

## Validación

La suite unitaria cubre destino/release/CLI, IDs, rango de configuración, pesos y
fechas. La integración aislada usa Auth y servicios reales: PLAN sin escrituras,
colisión previa, fallo tardío y rollback financiero/académico, recuperación de
cuentas, primer APPLY/repetición sin duplicados, las cinco tablas F8 no vacías,
historial v1/v2 y actor capturado, N/N+1, cero versus pendiente, cierre readonly,
conversión independiente, lifecycle/outbox, preservación de ediciones y rechazo
de provenance alterada. Compara hashes de **todas las filas originales** en
public/Auth/Storage/Drizzle; prepara datos previos de los runners existentes,
notas congeladas, una sesión Auth y un objeto Storage sintético, no un baseline
vacío. Esto acredita QA, no una carga o verificación en producción.

### Evidencia local de esta implementación

- Unit completo: **415 PASS**, 2 810 assertions; incluye tres casos nuevos del
  plan/CLI/release. No se repitió la suite full integration/E2E del producto.
- Integración focal final: **1 PASS**, 890 assertions sobre Supabase temporal con
  ledger 23. Comparó **70 tablas / 416 filas originales**; primer APPLY y
  repetición conservaron todas las filas anteriores y la repetición agregó cero
  cambios. Quedaron 8 cursos, 10 grupos, 26 registros/25 participantes nuevos,
  3 versiones de cierre, 1 reapertura y 1 baja ADMIN completada.
- Lint y format check global PASS; Astro check **0 errores / 0 warnings / 310
  hints**; build PASS. Ninguna operación en canónico o cloud.
- Se conservaron los fallos previos como cronología: primer intento focal rechazó
  una fecha de reemplazo ISO (el contrato exige civil Bolivia); el siguiente
  detectó una expectativa equivocada de saldo vencido dentro del snapshot
  `INSCRITO`; una preparación ampliada intentó reutilizar el runner heredado de
  asistencia, cuya recuperación de hoy a las 04:00 viola su guard actual de fecha
  futura. Se corrigieron únicamente el fixture nuevo/formato de comando y las
  expectativas contra el contrato real. La preparación final conserva evidencia
  previa de asistencia mediante sus casos de uso reales, sin cambiar el runner
  heredado ni sus guards. Corridas verdes focales intermedias: 408 y 888
  assertions; no se suman como una suite única.
- La limpieza automática de un stack temporal intermedio devolvió exit 1 después
  del PASS (containers ya detenidos). Se reejecutó solo `supabase stop` para el
  project ID/ruta exactos emitidos por ese runner, sin backup; exit 0 y ausencia
  de containers propios confirmados. No se tocó ningún otro proyecto Docker.
  La validación final posterior al guard adicional de provenance pasó las mismas
  890 assertions y completó su limpieza normal sin error.

Evidencia privada de salida en `comprehensive-seed-*.log` bajo el directorio
aprobado temporal de OpenCode; no contiene valores de credenciales. La validación
remota del runner está registrada debajo. En ese boundary previo a producción no
se había ejecutado carga en canónico ni cloud; el estado posterior se registra
abajo.

### Release y ejecución canónica posterior

El runner se integró mediante PR 288; correcciones UI por PR 289 y canal
protegido mediante PR 292. El source de `master` quedó en
`2789d55e93a97cc5344930e690e9feecc2cc10f5`, alineado con `development`
`a276e30fab3526cc086fc3efbe03a42d08681ba9`; Vercel `dpl4CZ` quedó `READY` para
ese mismo código. El release CI `37846141904` pasó en primer intento: 429 unit
/ 2,945 assertions, 162 integration / 1,332 assertions, demo seed 1/1 / 894
assertions y E2E 140/140 (132 desktop, 8 mobile); cero fallos, retries, flakes
o skips; TypeScript 0 errores/0 warnings/313 hints. PR 292/run `37845044909`
integra la preparación del workflow; PR 293/run `37843958082` añadió diagnóstico
de primera falla, sin atribuir un fix de aplicación. La observación anterior de
flake en `378382` conserva causa raíz desconocida y scope de un caso.

El owner ejecutó PLAN/APPLY en local canónico desde checkout limpio de
`master` `4e067311`, después del gate de release. Ledger quedó en 23. La
comparación previa/posterior conservó hashes de 2,906 filas originales en 70
tablas; reejecutar APPLY produjo cero cambios. Se añadieron 8 cursos, 10 grupos,
26 registros/25 participantes, 4 instructores, 5 ADMIN demo, 3 versiones de
cierre, 1 reapertura y 1 baja ADMIN unused con outbox completado. Se preservaron
las credenciales Auth existentes y las notas, finanzas y auditoría de usuarios
originales; no se usaron identidades reales como fixtures.

Cloud PLAN `37854318652` y APPLY `37854790028` se ejecutaron exitosamente a través
del workflow protegido para `fvzxqlezdrlzykyoevub`, en source liberado
`2789d55e93a97cc5344930e690e9feecc2cc10f5`. El hash aprobado del plan fue
`2bb8db152ff4ce2a4088ee372c632c17767dd5928c6d2ac28db9655f2b5c09ab`. Se verificó
N=3 y mínimo de primer pago=25; el seed no alteró estos settings ni usó un bypass.

El snapshot pre-APPLY midió 72 tablas y 899 filas originales. El workflow comparó
hashes SHA-256 server-side de filas completas identificadas por PK; todo el
baseline se preservó, ledger continuó en 23 y el total quedó en 1,850 filas. El
APPLY de repetición terminó con cero cambios. Se agregaron 8 cursos, 10 grupos,
26 registros/25 participantes, 12 intereses, 4 instructores y 5 ADMIN demo; el
ciclo de la cuenta ADMIN unused terminó con Auth eliminado y tombstone/outbox
completado. Se crearon 3 versiones de cierre y 1 reapertura. Siete GET públicos
respondieron 200. No se tocaron credenciales Auth originales ni se enviaron
correos. La credencial de la cuenta ADMIN demo se mantuvo únicamente en archivo
privado fuera del repositorio; no registrar su valor en ningún artefacto.

La carga local anterior permanece como ejecución independiente: baseline 70
tablas/2,906 filas originales, preservadas por hash y APPLY repetido con cero
cambios. No comparar el tamaño local con cloud ni tratarlo como el baseline de la
ejecución protegida. Ambas operaciones son F1–F8: no generaron certificados,
QR, firmas ni nuevas tablas de Fase 9; ledger/canónico/cloud sigue en 23 hasta el
release futuro aprobado de F9.
