# Escenarios de práctica: datos ficticios con nombres naturales

## Estado y límites

Perfil `realistic-v2`. Código y QA aislada; **APPLY canónico/local y cloud pendiente
de revisión del PLAN por el coordinador**. No hay reset, migración, promoción ROOT,
OAuth fabricado, cambio de configuración del proveedor ni rotación de passwords.
Los nombres son combinaciones ficticias; todos los contactos usan `example.test`.
No se atribuyen títulos profesionales, instituciones o retratos a personas reales.
El perfil de instructor actual no tiene campos de cualificaciones/biografía;
se utilizan sus campos soportados y el artwork/fallback aprobado existente.

### Dos operaciones diferentes

- Alta nueva: `db:seed:comprehensive-demo`, PLAN por defecto. Inserta 12 cursos,
  18 grupos, 34 preinscripciones/33 personas, 28 intereses distribuidos en cuatro
  cursos, cuatro instructores y cinco cuentas ADMIN de escenarios (una termina
  en tombstone mediante el lifecycle real). Cuatro formatos propios distintos
  de los dos formatos originales. Repite con **cero escrituras**.
- Base con v1 completo: `--refresh-scenarios` revisa valores originales exactos,
  actualiza solo etiquetas propias conocidas y añade cuatro cohortes, ocho
  grupos, ocho personas/preinscripciones, 16 intereses y un formato nuevo sin uso.
  No reproduce cobros, notas, asistencia, cierres ni lifecycle de cuentas v1.
  Una base v1 intacta propone hasta **88 campos editoriales en 60 filas**:
  ocho cursos (nombre/descripción/condiciones/programa), 25 personas (apellido),
  tres formatos (nombre), cuatro users instructor (nombre), cuatro perfiles
  (nombre/apellido), cuatro ADMIN propios (nombre), 12 interesados (apellido).
  Valores editados manualmente se enumeran en `skipped` y se preservan.
  El PLAN real, no estos máximos, decide el alcance.

Los dos formatos originales de 20/30 horas, sus IDs, revisiones, minutos y precios
se preservan exactamente, sin seleccionarlos por parecido para adoptar otras
filas. El refresh prueba los términos completos de sus tres formatos propios.
La función fuente v1 se conserva: mismo hash para el anchor/settings originales.
El manifiesto v1 no se sustituye; el refresh conserva su plan/contexto en
marcadores separados y verifica las relaciones curso/registro/persona/actor.

Cada excepción de preservación es una PK concreta con hash completo antes y hash
completo esperado después (o ausencia exacta para la única relación de rol
autorizada). Toda otra fila public/Auth/Storage/Drizzle se compara sin excepciones.
PLAN y replay exigen igualdad completa. El ledger sigue validándose contra
**todas** las migraciones del source; no se repara historial ni se debilitan guards.

## Matriz legible

Los reportes incluyen `scenarios`: UUID del curso/grupos, nombre, instructor,
fechas oficiales y de inscripción, ruta real, acción esperada y filas de
participantes con nombre/key/request key. Las claves internas no son títulos de
producto. Después del APPLY, los IDs aleatorios de preinscripción se resuelven
desde el contexto/receipts propios; no se confunden request key y registro UUID.
No incluir contraseñas, emails del ADMIN principal o sesiones en el documento.

| Clave / curso                                                      | Ruta contextual                                    | Resultado / acciones observables                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `closed` / Excel para la gestión administrativa                    | `…/grupos/{id}/cierre`, evaluaciones, certificados | CLOSED v1. Notas/asistencia bloqueadas. Aprobado, reprobado 54,25, cero explícito, frontera 70, N ausencias, N+1 pese a notas aprobadas. Saldo vencido permanece fuera del roster INSCRITO, sin bypass.                                              |
| `reclosed` / Análisis de datos con Python                          | cierre e historial `/cierre/1`, `/cierre/2`        | Dos snapshots reales, reapertura motivada y corrección 70→74,26; actor renombrado sin modificar la captura anterior. Solo última versión vigente para generar.                                                                                       |
| `pending` / Diseño de interfaces accesibles                        | sesiones, evaluaciones y cierre                    | Grupo terminado OPEN. Falta el último componente para dos personas; falta toda la fila de una tercera y revisión histórica de la última sesión. GRADES_PENDING/ATTENDANCE_PENDING.                                                                   |
| `current` / Comunicación efectiva en equipos                       | sesiones y evaluaciones                            | En curso, revisión histórica resuelta, nota incompleta, encuentro sin marcar, cancelación individual y recuperaciones. L–V ordinario; la recuperación de fin de semana es explícita y permitida por el servicio, no una clase ordinaria mal fechada. |
| `future` / Gestión de proyectos colaborativos                      | curso, grupos y preinscripciones                   | Pago completo/mínimo, devolución pendiente/completada, cambio al segundo turno, segundo abono, AUXILIARY/EXTERNAL, interesado convertido y persona compartida con `closed`. Tercer grupo cancelado.                                                  |
| `free` / Introducción a la programación web                        | curso e interesados                                | Gratuidad genuina sin abono cero; preferencia de turno no asigna plaza.                                                                                                                                                                              |
| `draft` / Seguridad digital para pequeñas organizaciones           | curso y grupos                                     | Borrador con grupo nunca expuesto; no público (404). Revisar/publicar o eliminar solo el grupo nunca publicado según contrato.                                                                                                                       |
| `archived` / Herramientas digitales para la oficina                | curso                                              | Histórico, sin nueva inscripción ni publicación; revisión exacta conservada. Alta nueva usa formato retirado; v1 conserva su revisión original, no se religa.                                                                                        |
| `next-open-data` / Visualización de datos para decisiones          | público, curso, interesados y preinscripciones     | Enero del siguiente año, inscripción abierta; cuatro personas y 12 intereses, un cancelado. Dos turnos; instructor sin roster antes del inicio.                                                                                                      |
| `next-open-web` / Desarrollo web con JavaScript                    | mismas rutas                                       | Abril del siguiente año, inscripción abierta; cuatro personas y cuatro intereses, un cancelado. Distribución de demanda distinta.                                                                                                                    |
| `next-upcoming-projects` / Planificación de proyectos comunitarios | detalle público                                    | Junio del siguiente año, ventana aún futura. No se inventan intereses/abonos que el servicio no admitiría hoy.                                                                                                                                       |
| `next-upcoming-security` / Protección de información en equipos    | detalle público                                    | Septiembre del siguiente año, ventana futura y dos turnos.                                                                                                                                                                                           |

Esquemas de dos/seis/ocho componentes con **solo THEORY/PRACTICAL**, pesos exactos
100 %. El primer guardado congela componentes incluso con nota cero. Clases,
horas y conflictos entre instructores usan los planificadores/servicios reales.
N y mínimo de pago son configuración existente, nunca valores forzados: con
mínimo 100 % un caso «parcial» es naturalmente pago completo. Pagos/devoluciones
son efectivos sintéticos registrados, no transacciones bancarias. Los exporters
administrativos existentes no son boletas/recibos institucionales inventados.

### Formatos y cuentas

- Taller de formación aplicada: referenciado; eliminar bloqueado. El contrato
  actual **sí permite desactivar un formato usado**, preservando sus revisiones;
  no se inventa un bloqueo de desactivación por asociaciones inexistente.
- Laboratorio abierto: gratuito y referenciado.
- Seminario de herramientas digitales: retirado; en alta nueva tiene historial
  archivado. En refresh v1 no se cambia ninguna asociación histórica.
- Clínica de proyectos: sin referencias, editable/desactivable/eliminable.
- Gabriela Salvatierra Ríos, Joaquín Arce Villalba, Natalia Quiroga Prado,
  Esteban Ledesma Paredes: cuentas EMAIL propias y perfiles naturales.
- Adriana Valcárcel Soria: operador usado; Renato Cárdenas Leiva: ADMIN sin uso;
  Isabel Alcázar Molina: usado desactivado; Tomás Rivero Salinas: reactivado;
  Clara Mendieta Solís: baja finalizada/tombstone. Son escenarios distintos al
  ADMIN principal. No se alteran cuentas QA multirol intencionales.

## ADMIN principal: confirmación privada obligatoria

`seed.ts` ya invita con **solo ADMIN**, provider GOOGLE legítimo; no activa una
invitación sin OAuth. No se fabrica ni reasocia una identidad Google.
Para quitar únicamente su relación INSTRUCTOR existente, el operador debe
confirmar en privado `DEV_INITIAL_ADMIN_EMAIL` y `DEMO_CONFIRMED_PRIMARY_ADMIN_ID`:
ambos deben identificar **exactamente al principal confirmado**, ACTIVE/GOOGLE,
con identidad Google/email verificados y aprobación coincidente cuando existe,
comprobados mediante Admin API. Puede ser distinto al actor histórico que creó
el manifiesto: no se reasigna la propiedad del dataset al principal nuevo. Sin ambos se
preservan los roles; con identificación parcial/mismatch se bloquea. Con cursos
o historial docente se bloquea y requiere coordinación, no eliminación de
referencias. No se borra el perfil, el ADMIN, Auth ni sesiones. El email no se
imprime en el plan; no documentar su valor.

## Certificados y documentos históricos

La extensión F9 existente sigue opt-in separada. Ocho registros o más según los
destinatarios oficiales, estados generated/awaiting_signature/issued/revoked/
replaced y ambos tipos se producen mediante `ManageCertificates`, Storage
privado, revisión, emisión y reemplazo reales. La identificación sintética usa
manifiestos/markers/Auth ownership y registro de participantes, **no la presencia
de la palabra Demo en el nombre**. Configuración y marca PDF de seguridad siguen
obligatorias; no se quita `[DEMO - SIN FIRMA INSTITUCIONAL]` de los PDFs.

El refresh no genera/regenera/reemite/revoca certificados ni modifica settings,
closure reports, versiones, IDs públicos, metadata, paths, bytes o hashes.
Enumera IDs/estados/hash de certificados y UUIDs de versiones que se preservan.
Los snapshots v1 y los ocho artefactos existentes pueden seguir mostrando los
nombres originales: es historia oficial congelada, no un fallo de renombrado.
Si se quiere sustituirla, hace falta un reemplazo explícito por el lifecycle real;
no reconstruir silenciosamente el PDF emitido. Reabrir nunca revoca automáticamente.
Las firmas sintéticas no prueban autoridad institucional; aquí no se introduce
una firma personal/institucional falsificada.

## Calendario acotado y operación

Para anchor Bolivia **2026-10-11**, las nuevas cohortes comienzan 2027-01-18,
2027-04-12, 2027-06-14 y 2027-09-06. Una alta inicial en 2027 planifica 2028.
El anchor de cada dataset/refresh queda fijado: **rerun no mueve fechas**, aunque
se ejecute años después. Los cursos pasados pasan a ser historia real del fixture.
Para una edición futura adicional se requiere namespace/cohorte explícita y un
nuevo PLAN aprobado, nunca arrastrar sesiones/cierres emitidos con el reloj.

Local: PLAN `--refresh-scenarios`; APPLY requiere `DEMO_REVIEWED_PLAN_SHA256`
exacto del PLAN ligado a target/proyecto/baseline, y luego verifica replay cero.
Cloud: workflow manual existente `production-comprehensive-demo.yml`, selección
`refresh_scenarios: true`, `include_certificates: false`; mismo environment,
master limpio, release/CI first-pass, deployment READY, ledger y hash PLAN.
No habilitar refresh desde shell cloud ni dispatch desde feature/development.
Los campos privados de principal se entregan mediante la configuración protegida;
no crear/exportar secretos de DB ni consultar variables Vercel crudas.

Antes de aprobar APPLY: revisar ediciones/skipped, colisiones, fechas actuales,
los dos formatos preservados, identificación del principal, relaciones de la
persona compartida y los ocho certificados/versiones oficiales. Credenciales
seeded y enlaces privados van al handoff con ACL restringida después del APPLY,
nunca al PR ni a screenshots públicos. La verificación visual posterior debe
usar las páginas auténticas; no sustituirla por una matriz o screenshots de mock.

### Inventario local previo (2026-10-11, solo lectura)

Snapshot completo: 75 tablas, 1.563 filas, ledger 24 aprobado, cero cambios
pre/post. Cursos/grupos/registros/personas/versiones/certificados: 10/10/27/26/3/8.
Se encontraron los dos formatos originales **editados**, no los defaults por
nombre: «Nuevo formato» (20 h, 90 min, 80/100 BOB) y «Formato de mentira»
(30 h, 150 min, 100/150 BOB). Se preservan exactamente; tampoco se adopta/borrar
el formato QA adicional no reconocido por este namespace.

El principal configurado coincide con una cuenta ACTIVE/GOOGLE y roles
ADMIN+INSTRUCTOR, sin asignaciones/historial docente; es distinto al actor del
manifiesto v1. Esto es inventario DB, **no validación del proveedor ni autorización
de APPLY**. El UUID y confirmación se mantienen en handoff privado.

El anchor v1 es 2026-10-09. Cuatro nombres de cursos ya fueron editados para
quitar el prefijo; el refresh reconoce explícitamente solo el texto v1 con/sin
ese prefijo. Los demás valores manuales permanecen `skipped`. Se preservan los
ocho certificados (dos issued, tres awaiting_signature, un generated, un revoked,
un replaced) y sus tres versiones de cierre, sin regenerar artefactos.

La instancia local usa **54321 intencionalmente**. El CLI ahora admite únicamente
selección explícita `--local-config-workdir <checkout canónico>` junto con
`--expected-local-api http://127.0.0.1:54321`: exige `project_id=skillbase`, DB
loopback55322/postgres, configuración/API exactas y estado del mismo proyecto
en ejecución. No acepta fallback60421/60422, hosts arbitrarios o clasificación
cloud como local; sin esos flags se mantiene el guard anterior. El hash PLAN
liga proyecto/DB/API/origen4321 y hash de la configuración completa. No cambia
puertos, configuración o stack. Cloud PLAN protegido permanece pendiente del release
combinado por el controlador protegido; no se ejecutó seed ni query cloud privada.

Playwright-cli sobre el catálogo público productivo actual: 16 tarjetas,
sin overflow desktop ni 390 px; screenshots before externos al repo. Es baseline
read-only, **no comprobación visual de los datos nuevos todavía no aplicados**.

### PLAN real local y propuesta read-only cloud (2026-10-11)

- Local: 81 campos editoriales en 58 filas propias, siete campos manuales
  preservados; cuatro cursos/ocho grupos/ocho participantes-preinscripciones,
  16 interesados y un formato sin uso nuevos. Se propone retirar únicamente
  INSTRUCTOR del principal privadamente confirmado/verificado, sin dependencia
  docente. Ocho certificados/tres versiones permanecen intactos. Hash de
  revisión local ligado a configuración y baseline en el handoff privado.
- Cloud: Management API mediante CLI autenticado y consultas SELECT explícitas;
  77 tablas/1.957 filas, ledger24 completo aprobado, snapshot pre/post idéntico.
  Propuesta de 88 campos en 60 filas propias, cero campos omitidos, mismas cuatro
  cohortes nuevas. Principal configurado coincide con identidad Google verificada
  y **ya tiene solo ADMIN**: no se propone quitar otro rol. Ocho certificados y
  tres versiones se preservan; formatos ajenos se enumeran sin modificaciones.
- La propuesta cloud tiene hash revisable propio, **no es el hash de aprobación
  APPLY del workflow protegido**. Tras release autorizado, volver a ejecutar su
  PLAN normal para ligar el mismo alcance al master/CI/deployment/baseline vigentes.
  No se cambia ni evita ese guard de release para hacer APPLY desde development.

No se aplicaron los planes ni se modificaron roles, Auth, datos, configuración,
ledger o Storage de ninguna instancia canónica. No se iniciaron sesiones OAuth
ni se hicieron restarts. Los campos manuales locales que siguen sin renombrar
están identificados como `skipped`; requieren decisión explícita del coordinador,
no reinterpretar cualquier nombre desconocido como propiedad sintética nueva.
