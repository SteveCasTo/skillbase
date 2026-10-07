# SECURITY

## OBJETIVO

Definir requisitos mínimos de seguridad para autenticación, autorización, rutas, archivos, datos y certificados.

## PRINCIPIO

No confiar en el cliente.

Toda operación sensible debe validarse en servidor.

## AUTHENTICATION

- Supabase Auth.
- Google OAuth.
- sesiones seguras.
- expiración manejada correctamente.
- no almacenar tokens innecesariamente.
- no exponer service-role key al navegador.

## AUTHORIZATION

Roles iniciales:

- ADMIN.
- INSTRUCTOR.

Participantes públicos no obtienen automáticamente acceso autenticado.

Cada operación debe validar permisos.

Ejemplos:

Administrador:

- puede gestionar cursos y grupos;
- puede confirmar inscripciones;
- puede gestionar certificados.

Instructor:

- el objetivo posterior es operar únicamente sobre cursos/grupos asignados;
- asistencia y evaluación solo se habilitan por módulos y autorizaciones explícitos; el rol por sí solo no concede acceso a cursos ajenos.

No confiar únicamente en ocultar botones.

### Auth dual e instructores (release PR 126 en producción)

- Email/password no habilita signup público. `createInstructorAccount` se invoca solo desde alta server-side autorizada a ADMIN activo; crea identidad confirmada con Supabase Admin API, verifica de nuevo al actor, transacciona usuario interno/rol `INSTRUCTOR`/perfil profesional, y compensa borrando la identidad nueva si la escritura interna falla. La contraseña no se persiste ni se registra.
- La validación del método actual de autenticación combina `getUser()` (identidad/sesión vigente) con `getClaims()` (claims firmados y `amr` para PASSWORD/OAUTH/confirmación). No confiar en lista de identidades del usuario para inferir por cuál método se autenticó.
- Supabase puede asociar automáticamente una identidad Google cuando verifica que su email coincide; la aplicación no afirma ni depende de que esa asociación de proveedor se pueda desactivar. Para usuarios cuyo proveedor primario legado es `GOOGLE`, se conserva su acceso Google verificado. Para cuentas `EMAIL`, la asociación nueva aprobada por la aplicación se registra en `approved_google_identity_id`; OAuth Google sin esa aprobación se deniega, mientras una sesión PASSWORD sigue siendo válida. Esto separa asociación Auth a nivel proveedor de aprobación de acceso de aplicación.
- El flujo de asociación inicia desde cuenta autenticada, valida origen y aplica rate limit. La prueba está firmada con `AUTH_RATE_LIMIT_SECRET`, cookie `HttpOnly`/`SameSite=Lax`/`Secure` según HTTPS, nonce con hash almacenado en DB, un solo uso y cinco minutos, ligada a usuario interno y sesión original; callback valida PKCE `flowId`, sesión OAuth, proveedor Google, email verificado normalizado y la misma identidad Auth. Ante un resultado no aceptado, intenta eliminar solo la identidad Google recién agregada (sin afectar las preexistentes) y restaurar la sesión inicial. La identidad de Auth sola nunca concede aprobación interna.
- Los intentos de login/recovery/callback/enlace usan bucket persistente atómico por acción y red, y por cuenta cuando hay email; claves HMAC con dirección y email no crudos. `AUTH_RATE_LIMIT_SECRET` es server-only (mínimo 32 caracteres). PR 126 aplicó 0012–0015 y el hook en cloud; el valor nunca se registra ni entrega al cliente.
- Los endpoints mantienen validación de origen, body form-urlencoded con límite/tamaño y campos únicos, `private, no-store`, redirects explícitos, errores neutros y sin credenciales. No exponer service-role secret/cliente privilegiado al browser.
- Las rutas `/app/instructores` y edición UUID son `ADMIN`; `/app/mis-cursos` y detalle UUID son `INSTRUCTOR`; perfil requiere usuario activo. El caso de uso y repositorio scopian cada lectura por el usuario interno autenticado, no solo por navegación o middleware. Las mutaciones de perfil propio restringen el actor al mismo ID, mantienen el email de cuenta read-only y verifican revisión; cursos/grupos siguen siendo mutaciones únicamente `ADMIN`.
- El selector/servidor permite asignar perfiles `INSTRUCTOR` con estado `ACTIVE`. Publicar curso exige esa asignación; drafts pueden tenerla opcional. Instructor no obtiene acceso a formatos/interesados/participantes/settings/finanzas; Fase 6 limita asistencia a sus propios grupos con ownership validado en servidor y roster sin CI/email.
- Asignaciones, fechas y grupos se validan bajo la misma barrera transaccional/advisory-lock, IDs de instructor anterior/nuevo en orden estable y luego bloqueo de curso. Las validaciones incluyen cursos con calendarios L–V que intersectan; la comprobación de grupos cuenta solo estados `PLANNED` (la cancelación libera intervalo). Cambio de instructor de curso iniciado y cambio de fechas de curso iniciado con asignación se rechazan server-side. Creación/edición de perfil y asignación tienen eventos no secretos e historial. Un password update exitoso intenta escribir `PASSWORD_CHANGED` con actor/target internos y sin metadata; como Auth y PostgreSQL no comparten transacción, el evento es posterior y un fallo solo genera `PASSWORD_CHANGE_AUDIT_WRITE_FAILED` con actor ID, sin revertir el cambio Auth confirmado.
- El perfil profesional no recopila descripción; su nombre completo es la única proyección pública del instructor asignado. Correo y teléfono permanecen en vistas privadas autorizadas.
- PRs 121–123 y el release PR 126 son antecedentes de Auth. SMTP cloud/local está configurado y la recepción de prueba local fue confirmada; recovery/cambio completo y entrega cloud aún requieren verificación. Google OAuth real y el callback local requieren su validación independiente. No inferirlos del estado de migraciones.

#### Correcciones Auth/lifecycle integradas y liberadas (PR 211; perfil refinado en PR 228)

- El release PR 126 conserva su estado histórico sin baja de instructor. Lifecycle se integró inicialmente por PR 134 (`b1855b1`), y refinamientos finales se incluyeron en PR 136 (`8cdb38f`), cuya fuente completa pasó el gate local. Lifecycle se liberó posteriormente con PR 211; edición inline de perfil/lifecycle y autoedición de nombre de ADMIN puro se liberaron en PR 228. La regla impide eliminar perfiles con historial; elimina solo rol único `INSTRUCTOR`, sin asignaciones ni dependencias. Accounts multi-role son rechazadas.
- La desactivación se bloquea server-side si la cuenta tiene cualquier asignación a curso no archivado (incluye drafts); se listan cursos con acción de resolver/asignar. Tras desactivar, guards de páginas y operaciones comprueban identidad/estado/rol vigentes y deniegan también sesiones existentes. Reactivación no recrea ni resetea la credencial.
- Borrado cruza PostgreSQL y Supabase Auth sin transacción distribuida: se escribe primero la intención/bloqueo y estado pendiente, se elimina identidad con Admin API server-only y se finaliza conservando tombstone/auditoría para no romper FKs. Error en proveedor/finalización mantiene acceso bloqueado y permite reintentar, en lugar de reactivar ambiguamente. `0016` se aplicó localmente sin reset y quedó incluida antes del release Fase 5 que avanzó cloud al ledger 18.
- La acción dedicada de crear password para cuenta Google-only exige claims firmados OAUTH y Google aprobado, sesión live/cuenta/actor revalidados en servidor y prueba reciente (menos de cinco minutos); no confía en metadata o identidad asociada histórica ni añade confirmación email a ese formulario. La prueba de recovery es una ruta separada. Password existente prueba contraseña actual server-side; password repetido da error específico seguro. PR 136 integró la fuente que pasó 178 unit, 98 integration y E2E 120/120.
- Las pruebas locales del feature branch no son verificación de entrega real. Configurar y verificar SMTP/recovery es trabajo aprobado pendiente; Google OAuth real continúa pendiente de forma independiente.
- Fase 5 trata CI, email y roster como datos personales. No exponer CI públicamente; exportación CSV/PDF es solo ADMIN, debe neutralizar fórmula CSV y no constituye recibo/boleta. No hay pasarela de cobro ni upload de comprobantes.

#### Seguridad de preinscripciones (rutas integradas; full-suite local PASS)

- `participants`, `pre_registrations`, `registration_settings`, command receipts y ledger tienen RLS habilitada y privilegios Data API revocados. Las lecturas/escrituras usan repositorios server-side.
- Los casos de uso verifican ADMIN activo y los repositorios vuelven a comprobar identidad/rol/actor vigente en la transacción. Request key/fingerprint evita reejecutar un comando distinto con la misma clave. El ledger solo admite movimientos positivos y se protege como append-only; el snapshot de precio/identidad no se sobrescribe. El pago gratis (total cero por AUXILIARY al 100 %) no crea un pago falso de cero.
- El roster permite solo instructor actualmente asignado a ese curso/grupo desde su fecha de inicio, y construye un DTO con nombre/apellidos exclusivamente; no expone CI, email, teléfono ni información financiera.
- El caso de uso de exportación revalida ADMIN, pagina y rechaza más de 1000 filas o resultados inconsistentes. CSV aplica escape/mitigación de formula injection; PDF usa una fuente Noto Sans embebida desde asset local/licenciado y rechaza caracteres no soportados en lugar de truncar o reemplazar silenciosamente. Las columnas actuales incluyen etiquetas curso/grupo, participante/CI, categoría, estado membership/financiero y cantidades snapshot; los archivos no son recibos/boletas.
- PR 179 integró las páginas HTTP de preinscripciones/participantes, export y roster, junto con la allowlist privada para ADMIN e instructor. Roster se entrega solo después de comprobar instructor asignado/curso/grupo propio y fecha oficial, serializado a nombre/apellidos; no cargar CI/email/teléfono/finanzas.
- La suite full canonical E2E pasó 125/125 con las rutas integradas. El cierre local valida los límites descritos, pero no acredita migración cloud ni release a `master`; esos gates siguen separados.

### Renovación de demos sintéticos

La herramienta `renew-demo` es desarrollo local only: valida URL/puertos canónicos antes de conectar, requiere ADMIN interno `ACTIVE`, password/ID solo desde `.env` ignorado y bloquea ejecución en CI/Vercel/`NODE_ENV=production`. El modo de reset usa allowlist y `TRUNCATE ... RESTRICT`, no `CASCADE`; conserva `auth.users`, sesiones, `users`, roles/perfiles, Auth config, Storage y ledger. Preflight valida ownership de cuentas/IDs antes del reset y se niega ante colisiones no reconocidas. La renovación productiva de PR 126 se hizo por proceso manual con autorización y conteos auditables, no mediante la CLI; mantener esta separación y no debilitar el guard local.

### Runner de demo financiero/asistencia (APPLY de Fase 6; no es seed de evaluaciones)

El usuario autorizó renovar los datos sintéticos de demo de negocio, incluida producción, después del gate/release de Fases 5 y 6. El runner integrado es independiente de `renew-demo`, PLAN por defecto y exige target/proyecto explícitos, ownership/provenance estable y comprobación de dependencias. APPLY local y carga autorizada de demos de producción están registrados en `docs/PLAN.md`, `docs/TESTING.md` y `docs/DEPLOYMENT.md`; la carga no se repitió para PR 228. Ninguna de estas filas corresponde a calificaciones/evaluaciones. Esta autorización no habilita reset general, `CASCADE`, reset amplio ni desactivar triggers/guards globales.

El runner usa manifiestos/contexto hash-bound y permite únicamente alta append-only; no borra ni modifica datasets preexistentes. Debe preservar Auth identities/sesiones, `users`, roles, perfiles, settings/secretos, Storage, migration ledger y todo historial financiero. No deshabilita triggers ni guardas de ledger, y nunca introduce endpoints de borrado financiero en producción. Cada destino requiere revisar el plan de solo lectura y ejecutar APPLY manual explícito; producción sigue condicionada al gate y autorización de release. Ver [`docs/FINANCIAL_DEMO.md`](FINANCIAL_DEMO.md).

### Autorización de sesiones/asistencia (Fase 6, release en producción)

Las rutas y operaciones limitan instructor a sus propios grupos y ADMIN a configuración/revisión/correcciones; el roster contiene solo participantes `INSCRITO` sin CI/email/finanzas. Consultas y mutaciones vuelven a comprobar ownership/rol en servidor; correcciones ADMIN quedan auditadas. `0018/0019` se liberaron a cloud mediante PR 211. Las restricciones correctivas C1/C2 se integraron en PR 219 y se liberaron en PR 228. Véase `docs/REQUIREMENTS.md` y `docs/ATTENDANCE_CONTRACT.md`.

### Autorización y privacidad de evaluaciones (Fase 7, release PR 235)

- PR 232 integró cuatro páginas: `/app/cursos/:courseId/evaluaciones`, `/app/cursos/:courseId/grupos/:groupId/evaluaciones` y sus equivalentes `/app/mis-cursos/:courseId/...`; PR 235 liberó backend y UI a producción. La policy privada fail-closed exige `ADMIN` en rutas de administración y `INSTRUCTOR` en `/app/mis-cursos`; el backend vuelve a comprobar actor activo, ownership y contexto en cada lectura/escritura.
- Loader, HTTP helper y repositorio revalidan actor activo y permisos server-side. `ADMIN` puede operar sobre cualquier curso. `INSTRUCTOR` solo sobre su curso asignado y desde el inicio oficial; una URL/ID de curso ajeno no revela su existencia. El `groupId`, si se envía, debe pertenecer al curso.
- Solo membresía vigente `INSCRITO` permite registrar notas; `PREINSCRITO` y `SALDOVENCIDO` quedan excluidos. La inelegibilidad calculada por asistencia no bloquea la carga de notas.
- DTOs limitan datos de participantes a nombre/apellidos y evaluación; no incluyen CI, contacto ni datos financieros. El historial administrativo de correcciones se entrega solo a `ADMIN`.
- Las cinco tablas de evaluación tienen RLS habilitado y grants Data API revocados a `anon`, `authenticated` y `service_role`; las seis funciones trigger también revocan `EXECUTE` a esos roles y a `PUBLIC`. No hay acceso directo de browser/cliente a esas tablas. Los repositorios Drizzle aplican validaciones/ownership y escrituras transaccionales en servidor. El operador aplicó 0020 al Supabase local canónico (ledger 20→21); las tablas nuevas quedaron vacías y sus permisos se verificaron. El pipeline de PR 235 la aplicó a cloud; la comprobación posterior fue read-only y confirmó tablas/permisos vacíos, sin comparación de hashes pre/post de todas las filas.
- `handleEvaluationPost` valida origen, límite de 65 536 bytes y allowlist de campos; respuestas son `private, no-store`/`nosniff`, con errores saneados. Esquema/notas usan revisión optimista e idempotencia actor+requestKey+fingerprint; los receipts son append-only. Las notas son evidencia auditable, no un permiso de modificación de identidad.

El backend y las páginas UI se liberaron mediante PR 235. El detalle de modelo/API y los límites de verificación cloud están en `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATIONS_CONTRACT.md` y `docs/TESTING.md`.

### Cierre académico por grupo (Fase 8, backend parcial no liberado)

- Loader/casos de uso de cierre revalidan actor `ACTIVE`, rol y ownership en el
  repositorio: ADMIN puede cualquier grupo; INSTRUCTOR solo grupo propio y desde
  inicio oficial. Reabrir es ADMIN-only, con razón y auditoría transaccional.
  No hay route Astro/policy/UI montada en este source.
- La migración 0021 candidata habilita RLS y revoca grants Data API en estado,
  versiones, reaperturas y receipts. Triggers hacen inmutable la historia y
  protegen notas/sesiones/roster/asistencia con el advisory lock compartido.
  Altas y transferencias hacia grupo cerrado se protegen server-side dentro de
  la transacción; no se alteran las reglas de pago/refund existentes.
- El snapshot ADMIN es privado server-side y conserva CI y evidencia financiera
  existente, sin email/teléfono en el modelo. Las lecturas autorizadas proyectan
  un DTO discriminado `access`; la proyección INSTRUCTOR es allowlist recursiva
  de nombres/IDs académicos, notas y asistencia, excluyendo CI, categorías y datos
  financieros, incluso si aparecieran nuevos campos sensibles en el snapshot.
  Pruebas focales inspeccionan el JSON serializado y los campos futuros
  sintéticos; el fix está en el source WIP y aún no hay ruta HTTP/página de cierre
  integrada ni release.
- Futuros PDF/CSV deben usar el DTO autorizado por actor/contexto a través de los
  loaders server-side, nunca la fila snapshot JSONB directamente. No añadir
  CI/contacto/finanzas a la salida de instructor; mantenerlo protegido por
  servidor y Data API grants revocados.
- Migration 0021 solo se aplicó en stacks QA temporales; no se aplicó a DB
  canónica/cloud. Integridad/privacidad y estado parcial están en
  [`ACADEMIC_CLOSURE_CONTRACT.md`](ACADEMIC_CLOSURE_CONTRACT.md) y
  [`DATA_MODEL.md`](DATA_MODEL.md).

### Gestión multi-ADMIN aprobada para Fase 8 (pendiente)

El proyecto aprobó crear cuentas ADMIN desde servidor mediante Supabase Auth privilegiado, con permisos iguales, y un lifecycle limitado por actividad de actor/dependencias. Cuentas con historia conservan UUID y trazabilidad; el guard de lifecycle debe serializarse y no puede dejar cero ADMIN activos. La contraseña inicial nunca se persiste, registra, expone en DTO ni audita. El flujo aún no está implementado; criterios de actividad, outbox, locks y recuperación están en [`docs/PLAN.md`](PLAN.md). No asumir rol `ROOT`, auto-baja prohibida ni operación de borrado físico de la fila `users`.

## RUTAS

Las rutas privadas deben validar sesión server-side.

No basta con redirect en React.

Las rutas públicas de certificados deben mostrar únicamente información permitida.

## RLS

Si se utilizan accesos directos mediante cliente Supabase, las políticas RLS deben considerarse obligatorias.

El uso server-side con Drizzle no elimina la necesidad de revisar qué credenciales se usan y qué acceso posee cada servicio.

## ARCHIVOS

Todo upload debe validar:

- autenticación;
- autorización;
- finalidad;
- tamaño;
- extensión;
- MIME;
- nombre generado por servidor;
- bucket;
- path;
- estado relacionado.

No confiar únicamente en `accept` del input.

No conservar nombre original como identificador interno.

## MIME

Mantener allowlists por caso de uso.

Ejemplo:

Certificado final:

- `application/pdf`.

No aceptar formatos arbitrarios.

El flujo actual acepta fotografía de curso mediante un editor que exporta WebP; ver las restricciones de upload y el bucket público específico en «Artwork de cursos» más abajo. Esto no habilita otros tipos de archivo.

## STORAGE

Separar buckets o políticas según sensibilidad.

No exponer buckets privados mediante URL pública permanente.

Utilizar URLs firmadas cuando corresponda.

### Artwork de cursos

- El bucket `course-artwork` es público solo para lectura porque sus objetos se destinan a cursos publicados; no contiene documentos personales.
- El endpoint de aplicación realiza la carga usando `SUPABASE_SERVICE_ROLE_KEY` exclusivamente server-side. Storage no concede upload directo al navegador y no se entrega esa credencial en props, respuestas ni bundle.
- Se exige origen esperado, usuario interno activo y rol `ADMIN`. El curso debe existir y no estar archivado.
- El request multipart está limitado; se valida `image/webp`, extensión `.webp`, bytes reales, dimensiones y contenedor WebP estático simple. Se rechazan formatos animados/extendidos. El editor convierte PNG/JPEG/WebP al WebP canónico recortado.
- Las keys son generadas por servidor bajo `courses/{courseId}/{uuid}.webp`; al guardar se comprueba que la key pertenezca al curso y que el objeto exista en el bucket. Solo keys canónicas generan URLs públicas, desde el origen Supabase configurado.
- La configuración del bucket (público, solo `image/webp`, 4 MiB) se comprueba/crea al usar el servicio; esto no equivale a despliegue cloud verificado.

## DATOS PERSONALES

Recolectar únicamente lo necesario.

No mostrar públicamente:

- CI;
- correo;
- teléfono;
- información administrativa;
- calificaciones parciales;
- asistencia.

La verificación pública de certificado debe limitarse a información necesaria para validar la credencial.

## CERTIFICADOS

Cada certificado debe tener:

- ID interno;
- credential ID público impredecible;
- estado;
- fecha de emisión;
- hash del archivo final;
- trazabilidad.

El QR debe apuntar a una URL de verificación controlada por la aplicación.

El QR no constituye por sí mismo prueba de autenticidad.

## HASH

Calcular SHA-256 del certificado final firmado.

Un cambio en el archivo debe invalidar la comparación de hash.

## REVOCACIÓN

Un certificado revocado no debe eliminarse.

Debe conservar:

- estado;
- fecha;
- motivo;
- actor responsable.

La página pública debe mostrar claramente que ya no es válido.

## AUDITORÍA

Registrar eventos sensibles.

No guardar secretos ni tokens completos en logs.

Eventos sugeridos:

- login administrativo relevante;
- cambio de rol;
- modificación de nota después de publicación;
- cambio de asistencia;
- descuento;
- devolución;
- emisión;
- revocación;
- reemplazo de certificado.

## INPUT VALIDATION

Validar entradas server-side.

No confiar solo en validación React.

Usar schemas compartibles cuando tenga sentido.

Normalizar datos antes de persistir.

### Cursos y formatos de Fase 2

- Las rutas administrativas de cursos están enumeradas por política; la edición dinámica solo acepta el patrón con UUID y cualquier ruta privada desconocida falla cerrada.
- Cada POST de creación, edición, publicación, retiro o archivo exige origen exacto, usuario interno `ACTIVE` y rol `ADMIN`, incluso después del guard del middleware.
- Los POST de edición con `Accept: application/json` pasan por la misma autorización, validación y revisión optimista que los formularios HTML. Las respuestas de error JSON contienen solo mensajes de dominio y campos, sin detalles de infraestructura ni credenciales.
- `/app/cursos/[id]/grupos` solo admite UUID y `ADMIN`; cada POST comprueba origen y pertenece al curso indicado, no confía en un ID de grupo enviado por el cliente. La persistencia serializa escrituras por curso y rechaza solapamientos incluso bajo concurrencia. La tabla `groups` tiene RLS y no otorga privilegios de Data API a `anon`, `authenticated` ni `service_role`; el servidor usa el repositorio autorizado.
- El cliente no puede enviar un estado editorial arbitrario: cada intención invoca un caso de uso y una transición cerrada.
- El slug se normaliza y asigna en servidor bajo bloqueo transaccional; nunca se acepta durante edición.
- La asignación usa un namespace global estable de advisory lock para que nombres concurrentes con bases solapadas no compitan por el mismo slug.
- Curso y evento de auditoría se escriben transaccionalmente; el formato/revisión se referencia desde el curso. Las revisiones son inmutables y su modificación/eliminación se bloquea en DB mediante un trigger con `search_path` fijado. No existe endpoint `DELETE` de cursos.
- Las ediciones usan `updatedAt` como revisión optimista y fallan con conflicto antes de sobrescribir cambios más recientes.
- Los fallos de infraestructura responden `500` con texto público genérico y emiten únicamente contexto estructurado sanitizado en servidor; no se registran SQL, causas, secretos ni payloads de formulario.
- Los DTO públicos se proyectan de forma explícita y solo consultan `PUBLISHED`; no reutilizan el DTO administrativo. Landing, catálogo y detalle son SSR.
- El destacado singleton se limita a cursos publicados mediante constraint/index DB y lógica de aplicación.
- El contenido Markdown no se inserta como HTML; el parser crea únicamente nodos soportados y filtra esquemas/destinos de enlaces.
- `courses`, `course_types`, `course_type_revisions` y `audit_events` mantienen RLS sin políticas Data API y revocación de privilegios a roles de cliente. El browser no recibe credenciales de base ni service role.
- Las respuestas bajo `/app` siguen usando `Cache-Control: private, no-store`.

## CSRF / XSS / HTML

- No renderizar HTML no confiable.
- Evitar `dangerouslySetInnerHTML`.
- Si se requiere, sanitizar.
- revisar cookies/sesiones según configuración de Auth.
- mantener dependencias actualizadas.

## RATE LIMITING

Evaluar límites para endpoints públicos susceptibles a abuso:

- preinscripción;
- verificación;
- auth callbacks.

No añadir mecanismos complejos hasta que exista una necesidad, pero dejar el punto documentado.

## SECRETS

Prohibido en Git:

- service role keys;
- Google client secret;
- access tokens;
- Vercel token;
- Supabase access token.
- `AUTH_RATE_LIMIT_SECRET`.
- `SEED_INSTRUCTOR_PASSWORD` (solo seed local; tratar como credencial).

Usar GitHub Secrets y variables de entorno.
`AUTH_RATE_LIMIT_SECRET` es server-only, requiere al menos 32 caracteres y no debe comenzar por `PUBLIC_` ni aparecer en logs.
`SEED_ADMIN_ID` selecciona una identidad interna, no contiene contraseña; su valor tampoco se registra junto con datos de seed. Ningún valor de `.env` se incluye en esta documentación.

## CI/CD

Los secretos de producción deben estar disponibles únicamente en jobs que realmente los necesitan.

PRs de forks o código no confiable no deben obtener secretos.

## DEPENDENCIAS

Antes de añadir una dependencia:

- comprobar mantenimiento;
- revisar licencia;
- revisar necesidad;
- evitar paquetes redundantes;
- fijar versión cuando sea crítico.

## INCIDENTES

Si un secreto se expone:

1. revocar;
2. rotar;
3. revisar logs;
4. eliminarlo del repositorio e historial si corresponde;
5. documentar la causa;
6. introducir prevención.

## POSTURA DE AUTH PRIVADO IMPLEMENTADA

- Las cookies de sesión se leen y renuevan mediante un cliente Supabase nuevo por request; las cabeceras anti-cache entregadas por `@supabase/ssr` se copian a la respuesta.
- La identidad se valida contra Supabase Auth con `getUser()`. Estado y roles se consultan siempre en las tablas internas mediante una conexión server-side.
- El callback normal de OAuth exige Google y correo verificado; las rutas de autenticación dual también validan método con claims firmados y aprobación de identidad Google del usuario interno. La asociación de identidad Google que Supabase puede hacer automáticamente no equivale a aprobación de acceso.
- Los endpoints mutables de inicio y cierre de sesión son `POST` y verifican el origen esperado.
- Los redirects de retorno se restringen a paths relativos y la allowlist local contiene una URL exacta.
- Los valores de service-role key no se guardan en código/Git ni se entregan al browser. El aprovisionamiento del feature usa el valor configurado en `process.env` solo en un cliente Auth Admin server-side; setup E2E obtiene la key efímera local desde Supabase CLI, la conserva únicamente en el entorno del proceso de prueba y no la imprime.
- `users`, `roles` y `user_roles` tienen RLS sin políticas para Data API y privilegios revocados a `anon`, `authenticated` y `service_role`. Los guards Astro/Drizzle siguen siendo autoritativos porque las conexiones owner/bypass RLS no quedan restringidas por esas políticas.
- Supabase Auth local/cloud conserva signup público deshabilitado y usa hook `before_user_created` para aceptar solo invitaciones Google permitidas. La migración 0012 crea la función segura del hook y restringe su ejecución. Las cuentas email/password se provisionan mediante Admin API server-side. PR 126 habilitó la configuración dual Auth en cloud; Google OAuth real y la entrega SMTP no se probaron.
- Las cookies SSR declaran `HttpOnly`, `SameSite=Lax`, path `/` y `Secure` cuando `PUBLIC_SITE_URL` usa HTTPS.
- Las respuestas de `/app`, `/app/**`, `/login`, `/unauthorized` y `/auth/**` usan `Cache-Control: private, no-store`.
- Toda ruta bajo `/app` requiere una política exacta registrada. Las rutas futuras no declaradas fallan cerradas; los endpoints de operaciones sensibles deben seguir invocando guards propios aunque una página ya esté protegida.

### Idempotencia y recuperación del alta

La clave de idempotencia del curso se vincula en servidor al actor autenticado y al fingerprint de la carga validada; no se acepta identidad de actor del cliente y reutilizar la clave con datos distintos falla. Los metadatos no salen en DTOs. El artwork se asocia después de crear el borrador; ante fallo se ofrece recuperar/reintentar sobre ese borrador. No se sustituye silenciosamente la asociación existente ni se asume una transacción distribuida entre PostgreSQL y Storage. La migración aditiva 0010 no automatiza borrado de historial.

### Contraseñas de cuentas internas (implementadas; recovery SMTP no verificado)

Las credenciales pertenecen exclusivamente a Supabase Auth. Crear cuenta y asignar contraseña inicial requiere API privilegiada exclusivamente server-side; no versionar secretos ni retornar/registrar la contraseña después de la respuesta inicial necesaria para entregarla al ADMIN. Nunca persistirla en PostgreSQL, auditarla, incluirla en telemetría, devolverla en cargas de navegación ni repoblar el formulario. Mantener signup público deshabilitado, protección CSRF/origen, cookies seguras, `Cache-Control: private, no-store`, redirects permitidos y rate limiting del proveedor/endpoint. Configurar y comprobar SMTP antes de prometer recuperación por correo en cloud.
