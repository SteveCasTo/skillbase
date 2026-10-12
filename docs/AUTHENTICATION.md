# AUTHENTICATION

## OBJETIVO

Definir autenticación, identidad y autorización inicial.

## PROVEEDOR

Supabase Auth.

## GOOGLE

Google OAuth y email/password son mecanismos visibles para usuarios internos. El flujo dual y la asociación opcional de Google se liberaron mediante PR 126; signup público permanece deshabilitado. Google OAuth real y entrega SMTP/recovery no se verificaron durante el release.

La configuración requiere credenciales OAuth de Google y configuración correspondiente en Supabase.

## IDENTIDAD

No utilizar Google ID como PK del dominio.

Modelo:

```text
Supabase auth user
→ authUserId
→ User interno
```

El usuario interno conserva:

- rol;
- estado;
- propiedades de dominio.

## ROLES

Iniciales:

- ADMIN
- INSTRUCTOR

No asignar privilegios solamente por dominio de correo salvo decisión formal.

## SESIÓN

La sesión debe:

- validarse server-side para rutas privadas;
- renovarse mediante mecanismos soportados;
- eliminarse correctamente en logout.

## DESARROLLO

Supabase local debe permitir trabajar con Auth sin depender de producción.

Google OAuth real puede configurarse para pruebas manuales cuando sea necesario.

## TESTS

Los E2E no deben depender normalmente de la pantalla real de Google.

Crear usuarios/identidades de test de forma controlada.

Testear OAuth real como integración específica y limitada.

## CALLBACKS

Los redirects permitidos deben declararse explícitamente por entorno.

No permitir redirects abiertos.

## CUENTAS

Si un usuario autenticado no tiene un User interno habilitado, el sistema debe resolver explícitamente el caso.

No asumir que cualquier cuenta Google autenticada es automáticamente administrador o instructor.

## OFFBOARDING

Deshabilitar un User interno debe impedir acceso incluso si su identidad Google continúa siendo válida.

## IMPLEMENTACIÓN INICIAL DE FASE 1

El acceso visible usa Google OAuth con PKCE:

```text
POST /auth/google
→ Supabase/Google
→ GET /auth/callback?code=...
→ exchangeCodeForSession
→ identidad Google con correo verificado
→ invitación interna por correo normalizado
→ vínculo único con auth.users.id y activación
→ /app
```

El callback normal de OAuth acepta únicamente sesión cuyo método verificado sea OAuth, proveedor Google con correo verificado coincidente y usuario interno autorizado. Una invitación `INVITED` no tiene `authUserId`; el vínculo y el cambio a `ACTIVE` se realizan juntos bajo bloqueo de fila. Una invitación vinculada a otro UUID, una cuenta desconocida, deshabilitada o sin roles se rechaza y se cierra solamente la sesión local recién creada.

En requests posteriores, el middleware crea un cliente `@supabase/ssr` ligado a las cookies del request, valida la identidad con `getUser()` y carga estado y roles desde PostgreSQL mediante Drizzle. No se usa `user_metadata`, dominio de correo ni navegación como autorización.

El parámetro de retorno permite solo rutas relativas locales. El siguiente destino del OAuth se conserva en una cookie breve, `HttpOnly` y `SameSite=Lax`. Logout es `POST`, valida el origen y usa `signOut({ scope: "local" })`.

El callback normal de Google prepara «Sesión iniciada.» solo después de verificar sesión OAuth, identidad aprobada y usuario interno autorizado. El layout privado revalida el usuario y consume una cookie de feedback de un uso, `HttpOnly`, limitada a `/app`, al mismo origen y UUID Auth y con vigencia de 60 segundos; no contiene credenciales ni concede acceso. Sileo presenta el mismo éxito que el login password, incluso tras las navegaciones completas Google→Supabase→app. Los fallos del callback vuelven a login con aviso Sileo; los errores de campo siguen junto al campo. El botón Google muestra «Abriendo Google…» durante la salida, sin éxito anticipado ni toast loading permanente. La asociación Google desde perfil conserva su flujo separado. La cobertura del callback con proveedor controlado no equivale a consentimiento Google real end-to-end.

### Configuración local

- Site URL: `http://127.0.0.1:4321`.
- Redirect permitido exacto: `http://127.0.0.1:4321/auth/callback`.
- Callback que debe registrarse en Google para la configuración versionada de Supabase local: `http://127.0.0.1:55321/auth/v1/callback`.
- Client ID y secret de Google se leen desde variables ignoradas por Git declaradas en `.env.example`.

La configuración versionada en el source base de esta documentación conserva API local `55321`. Durante la operación local F9 se autorizó un ajuste solo local a API `54321`; en ese runtime el callback esperado es `http://127.0.0.1:54321/auth/v1/callback`. La app mantiene Site URL/redirect `127.0.0.1:4321`. El inicio de OAuth local devolvió HTTP 302 hacia ese callback y la página de Google cargó HTTP 200 sin error de redirect observado; no se completaron consentimiento real, callback PKCE ni sesión. Esta observación parcial no demuestra login OAuth end-to-end ni modifica el source/release. Antes de una prueba real, el usuario/operador debe coordinar cuenta, invitación, autorización de callback y sesión; no se otorgan roles por defecto.

Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E controladas; Google real no es dependencia de la suite general.

El signup público por email/password permanece deshabilitado. El proveedor interno email/password, manual linking y el hook `before_user_created` hacia `private_auth.allow_invited_google_signup` están configurados localmente y en cloud; el hook autoriza solo invitaciones Google preaprovisionadas con roles. Las cuentas email/password las crea la Admin API desde servidor, que no pasa por el hook. Esta configuración no acredita que Google OAuth real o el callback local se hayan verificado.

Las rutas privadas tienen políticas fail-closed: `/app` y `/app/perfil` permiten usuario interno activo; mantenimiento de cursos/formats/interesados/participantes/configuración exige `ADMIN`; `/app/mis-cursos` y páginas de sesiones requieren `INSTRUCTOR` más ownership del repositorio. Instructor solo accede a asistencia de sus propios grupos y no a finanzas, CI/email ni settings. Rutas futuras no declaradas bajo `/app` fallan cerradas.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente en un boundary histórico desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`. Esa evidencia histórica se conserva, pero no sustituye la aceptación OAuth/recovery local y de producción end-to-end que queda en Fase 10A.

## AUTENTICACIÓN DUAL (Fase 4 liberada mediante PR 126)

### SMTP de Auth (configuración autorizada, 2026-10-04)

Supabase Auth sigue siendo responsable de enviar los correos; la aplicación no incorpora un cliente SMTP. Se configuró Gmail (`smtp.gmail.com`, puerto 587/STARTTLS, remitente `SkillBase`) en el proyecto cloud canónico y se preparó la configuración local mediante referencias a variables privadas. Solo se modificaron los seis campos SMTP y el asunto/contenido de recovery; las dos banderas derivadas de personalización de recovery cambiaron como consecuencia. Google, signup/hook, permisos, sesiones, Site URL, redirects y límites permanecen sin cambios (cloud conserva 2 correos/hora y OTP de 3600 segundos).

La plantilla `supabase/templates/recovery.html` está en español, explica una única acción y usa exclusivamente `{{ .ConfirmationURL }}`, generado y verificado por Auth. No construye redirects ni expone un token sin verificación; no afirma un plazo distinto de la configuración del proveedor. No se habilitan nuevos emails de invitación/signup ni notificaciones.

La configuración SMTP local está integrada en `development` mediante `supabase/config.toml`/plantilla y referencias privadas; el `.env` ignorado del checkout canónico contiene secretos, nunca versionados. Las suites aisladas eliminan el transporte SMTP externo y sus variables antes de arrancar, y copian únicamente las plantillas públicas. No necesitan credenciales de Gmail ni envían correo real.

La configuración SMTP cloud está comprobada por lectura de Admin API, pero la identidad destinataria autorizada no existe en Auth cloud; no se creó otra cuenta ni se hizo una prueba recovery cloud. El usuario confirmó históricamente la recepción de un correo de prueba en el buzón autorizado local, verificando entrega SMTP local. Esto no prueba clic de recovery/cambio de contraseña, ni entrega cloud. La prueba OAuth end-to-end local/cloud sigue en Fase 10A; el callback debe coincidir con el runtime usado (`55321` en config versionada, `54321` en el ajuste local temporal F9).

### Flujos internos y reglas del release dual

- Login email/password convive con Google. Un identificador interno conserva UUID propio y referencia `auth.users.id`; correo y role/state se resuelven desde el usuario interno. La aplicación valida el usuario en vivo mediante `getUser()` y valida los claims firmados mediante `getClaims()` para determinar el método de la sesión actual; no deduce el método de una identidad vinculada.
- `createInstructorAccount(actorAuthUserId, { email, name, password, profile })` se invoca solo desde el flujo server-side ADMIN `/app/instructores/nuevo`, no es endpoint público. Verifica ADMIN activo antes y después de llamar Supabase Admin API, normaliza/valida campos y provisiona usuario Auth confirmado. Después crea usuario interno `ACTIVE`, `authPrimaryProvider=EMAIL`, rol únicamente `INSTRUCTOR` y perfil profesional ligado al mismo ID en una transacción. Si falla la persistencia interna, intenta borrar la identidad Auth recién creada como compensación. La contraseña nunca forma parte del modelo/DTO/evento de auditoría ni respuesta `InternalUser`; no hay paso obligatorio de cambio al primer login.
- El usuario autenticado puede actualizar su propia contraseña opcionalmente en `/app/perfil`. Acepta contraseña actual o confirmación por email; los campos no se repueblan. Flujo de recovery entrega respuesta neutra. La contraseña inicial de cuenta de instructor la elige y establece ADMIN en el aprovisionamiento, sin invitación ni obligación de cambiar al primer acceso.
- Después de que Supabase Auth confirma el cambio, la aplicación registra `PASSWORD_CHANGED` en `audit_events` con actor/entidad internos y sin password, token ni metadata sensible. Auth y PostgreSQL no comparten transacción: si falla esa escritura, el cambio ya aplicado no se reporta como fallido y se emite únicamente `PASSWORD_CHANGE_AUDIT_WRITE_FAILED` con el ID interno del actor.
- El usuario puede solicitar asociación Google explícita desde `/app/perfil`. El intento se liga por cookie firmada y `HttpOnly`, nonce aleatorio almacenado como hash de un uso y expiración de cinco minutos, usuario interno, ID de sesión y `flowId` PKCE. La callback comprueba la sesión original, la identidad Auth resultante, OAuth vigente, Google verificado y coincidencia de email normalizada. Email/Supabase puede asociar automáticamente identidades Google de correo verificado y coincidente; Supabase no ofrece aquí una garantía de impedir esa asociación a nivel proveedor. Por ello la aplicación conserva `approved_google_identity_id` y **deniega autenticación OAuth** por Google no aprobada. En asociación rechazada intenta quitar únicamente la nueva identidad Google y restaura la sesión original; identidad ya asociada en Auth no constituye por sí sola autorización de la aplicación. No se auto-fusionan usuarios internos ni se cambia identidad primaria por una coincidencia de email.
- Para una identidad interna preexistente `auth_primary_provider=GOOGLE`, el login Google vigente se conserva y la contraseña puede añadirse opcionalmente desde perfil. Cuenta provisionada con `auth_primary_provider=EMAIL` requiere asociación explícita aprobada para que OAuth funcione; el login por password sigue siendo independiente y válido aunque Auth haya añadido una identidad Google no aprobada.
- La aprobación de la identidad de cuenta se revalida también para PASSWORD y confirmación/recovery: una cuenta primaria GOOGLE conserva su único Google verificado y coincidente aun después de añadir password/identidad email; una cuenta EMAIL conserva su provenance interno y correo de cuenta verificado coincidente, aunque se quite la identidad email del proveedor. Ningún método sustituye el UUID Auth vinculado, correo verificado, estado ACTIVE ni roles internos. Una asociación Google automática no bloquea password/recovery legítimo de EMAIL ni autoriza su OAuth.
- Se mantienen guards, rol/estado internos y rutas fail-closed. ADMIN gestiona perfiles desde `/app/instructores`; un instructor puede editar su nombre/apellidos/teléfono (email de solo lectura) en la sección profesional de `/app/perfil`, consultar `/app/mis-cursos` y operar asistencia solo en grupos propios. Los listados/consultas siempre filtran por `users.id` autenticado, además del guard exacto `INSTRUCTOR`; una URL directa ajena no otorga acceso. Instructor no obtiene acceso a edición de cursos/grupos, formatos, interesados, participantes, settings ni finanzas.
- Desde PR 222, un ADMIN **sin rol INSTRUCTOR** puede editar en `/app/perfil` únicamente `users.name`; el email se muestra solo lectura. La mutación revalida actor activo/rol y origen en servidor, exige la revisión observada, actualiza bajo bloqueo y audita `USER_PROFILE_UPDATED` con `fields: name`. No introduce apellidos, teléfono ni perfil profesional para ADMIN puro. Un usuario multirol que también tiene `INSTRUCTOR` usa los campos de su perfil profesional de instructor (nombre, apellidos y teléfono; email readonly), no el editor exclusivo de ADMIN puro.
- Los campos profesionales de INSTRUCTOR y las acciones lifecycle se editan por acción/campo desde PR 222; ciclo de vida se restringe según exclusividad de rol, asignaciones e historial. Estos cambios se liberaron junto con las correcciones mediante PR 228.
- Las migraciones 0012/0013 definen buckets Auth y requests de asociación; 0014 añade perfiles/asignación y 0015 repara el guard de borrado forward-only. PR 126 aplicó 0012–0015 (ledger 16); Fase 5 llegó a ledger 18 y el release de Fase 6/PR 211 avanzó cloud a ledger 20. El hook, email/manual-link provider config, redirects de recovery y `AUTH_RATE_LIMIT_SECRET` están configurados server-only en cloud; nunca registrar el valor.
- Los endpoints de Auth validan origen y límites de intentos (bucket persistente por red y, cuando aplica, cuenta/acción; claves HMAC y no IP/email crudos), limitan y validan cuerpos, usan cookies seguras, callbacks allowlisted y `private, no-store`. Supabase Admin API/service role permanece solo en servidor.
- Supabase Auth es el único almacén de passwords; no guardarlas en PostgreSQL, DTOs ni logs. Gmail SMTP está configurado en cloud y local; se confirmó recepción de un correo de prueba local. La entrega cloud y el flujo completo de recovery/cambio no están verificados; el login inicial password asignado por ADMIN no depende de recovery.

### Estado operacional SMTP

La configuración Supabase Auth SMTP autorizada se aplicó en cloud y local con el remitente de SkillBase. Secretos quedan exclusivamente en Auth y `.env` local ignorado; no se incluyen valores en Git, frontend, CI ni esta documentación. La recepción local de un correo de prueba fue confirmada históricamente por el usuario. Continúan pendientes el recovery/cambio completo end-to-end local y cloud y la prueba real OAuth local/cloud prevista para Fase 10A. Cualquier login/email real requiere coordinación autorizada con el usuario; no automatizar consentimiento, reutilizar acceso a un perfil real ni enviar correo como parte de una actualización documental.

La autorización manual del callback en Google Console debe verificarse con el usuario para el puerto del runtime de la prueba (configuración versionada `55321`, runtime F9 local `54321`). No afirmar OAuth real validado por configurar SMTP ni por el redirect HTTP parcial observado.

Al cierre inicial de PR 126 no había acción de baja ni esta política. La corrección posterior se integró por PRs 134/136 y se liberó con PR 211/Fase 6. PR 222 añadió edición inline individual de perfiles/lifecycle; ese cambio se promovió a producción con PR 228.

### Corrección Auth/lifecycle (release PR 211; UI de perfil PR 228)

- Un instructor con cursos asignados no archivados (incluidos `DRAFT`) no se puede desactivar. La UI lista cursos y explica que deben archivarse o reasignarse. Solo se puede desactivar cuando no hay asignaciones a cursos no archivados. Instructor con cualquier asignación histórica nunca se elimina físicamente.
- Eliminación disponible solo si la persona nunca fue asignada, tiene exclusivamente el rol `INSTRUCTOR` y no tiene dependencias de dominio. La operación ADMIN hace transición a `DISABLED`/deletion-pending en PostgreSQL, luego elimina la identidad mediante Supabase Auth Admin y finaliza con perfil/rol removidos y tombstone interno mínimo para conservar referencias/auditoría. Si falla Auth o el paso final, no se reactiva: queda bloqueada y el mismo flujo permite reintentar. Registro y sesión ADMIN se verifican en servidor.
- Todas las rutas/acciones revalidan estado interno; cookie ya emitida no mantiene acceso para instructor desactivado. Reactivación recupera la identidad preservada y la autorización sin recrear ni resetear credenciales.
- La página de cambio de contraseña es independiente de `/app/perfil`. Cuenta password exige validar password actual en servidor, además de nueva/confirmación. La acción «Crear contraseña» de Google-only exige claims firmados de sesión OAuth Google aprobada, `getUser()`/cuenta live y prueba OAuth reciente (menos de 5 minutos); no depende de metadata, de una identidad histórica aislada ni añade verificación por correo en ese formulario. Una prueba de recuperación válida es un camino distinto desde recovery. Auth vuelve a comprobar actor/sesión antes de escribir. Error de password igual a anterior se muestra de forma específica/recuperable. El recovery «Olvidaste tu contraseña» está en página independiente con validez del email y respuesta neutra.
- El cambio normal transmite además la contraseña actual validada como `current_password` a `auth.updateUser`; recovery y primera contraseña Google aprobada omiten esa propiedad, aunque el formulario envíe un valor. El gateway conserva esta separación fuera de presentación. Los códigos del proveedor `current_password_required`/`current_password_mismatch` se convierten al error seguro del campo actual; no se muestran detalles crudos ni se registran credenciales. La fuente fue liberada en PR 335; la configuración cloud nativa se activó después del deploy, según `docs/DEPLOYMENT.md`.
- Supabase JS/auth-js 2.116.0 tipa el parámetro; GoTrue implementa excepciones para sesión recovery y cuenta sin contraseña previa. CLI 2.117.0 no ofrece una clave TOML para activar `UpdatePasswordRequireCurrentPassword`; `auth.email.secure_password_change` es reautenticación/nonce, no contraseña actual. El release coordinado confirmó el boolean nativo cloud activo; no se alteró la configuración local ni se reinició el runtime local existente. El proveedor no conoce la aprobación Google interna: la frontera de primera contraseña Google sigue pendiente en AUTH-1.

- SMTP cloud/local está configurado; el usuario confirmó recepción de un correo de prueba local. No equivale a recovery/cambio completo ni a entrega cloud, que permanecen sin verificar. La verificación manual de Google OAuth/allowlist continúa pendiente de forma independiente.
- La fuente final `8735d676fe0d96e7230b4636efa8cb51045d1eca` (base `ddd0f3de`) pasó 178 unit, 98 integration y full E2E 120/120, además de lint/format/typecheck/build/Drizzle/diff checks; se integró en `development` por PR 136 (`8cdb38f`). Después, PR 211 liberó Fase 6 y PR 228 liberó las correcciones/profile UI. SMTP recovery y Google OAuth real mantienen verificaciones independientes pendientes.

### Estado post-release de enforcement nativo (2026-10-11)

PR 334 integró el envío de `current_password` en `development`; PR 335 liberó el árbol completo de desarrollo a `master` (`07042f851c8d0fe6b133288c088051bad6973bb5`). Después de CI exitoso y Vercel `READY` para ese SHA, se activó en Supabase cloud el boolean nativo `security_update_password_require_current_password` (`false` → `true`), y una lectura filtrada posterior confirmó que seguía activo. El cambio normal valida y envía la contraseña actual. Las sesiones de recovery y el alta de primera contraseña Google aprobada conservan la omisión semántica.

No se ejecutó un flujo autenticado de cambio/recovery/primera contraseña en producción ni se probaron Google OAuth o entrega SMTP real en este release. El usuario había confirmado anteriormente una asociación manual de recovery; esa observación es previa y no acredita compatibilidad con este último release. AUTH-1 permanece abierto/parcial por la frontera del proveedor en la primera contraseña Google y la falta de validación de esos flujos reales. No solicitar/repetir la asociación anterior salvo que se vaya a afirmar compatibilidad de ese flujo.

En el checkout local canónico, `development` está sincronizado con `dbf7f3158f24dccf9f2f271ab8d6a24e715ab291`; el proceso existente (PID 37512) conserva la app en `http://127.0.0.1:4321`, login HTTP 200 y el toast «Solicitud rechazada» al probar una clave inválida. La instancia Auth local observada es GoTrue v2.196.0 y no tiene asignación explícita de `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`; esto **no** demuestra que el boolean esté en `false` ni que el control nativo local esté aplicado. El runtime y el WIP de `supabase/config.toml` no se reiniciaron ni modificaron para este release.

La migración aditiva 0014 vincula el perfil profesional con el ID interno estable y añade `courses.instructor_id`, preservando `instructor_name` histórico sin backfill automático. PRs 118–123 integraron Auth, instructores, seed local, auditoría de password y guard de formato; PR 126 los desplegó a producción.

### Seguimiento de identidad autorizada AUTH-1 (2026-10-11)

La regla autorizada no exige que toda primera contraseña se cree exclusivamente
desde una pantalla de SkillBase. Se acepta la excepción nativa del proveedor para
una cuenta Google legítima, con correo realmente verificado/coincidente, UUID Auth
ya vinculado y usuario interno ACTIVE con roles. Esa aprobación debe conservarse
en todos los accesos posteriores, incluidos PASSWORD y recovery; la credencial
nueva no autoriza otra identidad ni concede roles. Bootstrap continúa siendo
invitación ADMIN por correo, sin ROOT y sin fabricar verificación Google desde el
seed. El formulario de aplicación mantiene su prueba Google reciente de cinco
minutos y sus revalidaciones live; recovery conserva su prueba acotada separada.

`requireApprovedProviders` aplica esta frontera común desde
`loadRequestAuthContext`, usado por middleware, login, recovery y gateway de
password. Para GOOGLE, añadir una identidad email no elimina la aprobación del
Google primario verificado. Para EMAIL, el acceso password/recovery mantiene la
propiedad de cuenta verificada y provenance EMAIL internos, independiente de un
Google autoasociado no aprobado o del unlink nativo de la identidad email.
No cambia el provisioning, hook, roles, schema, SMTP, Sileo ni secretos.

Esta implementación aislada no acredita enforcement nativo local ni un flujo
autenticado con ese control activo en producción. La CLI fijada 2.117.0 sigue sin
mapear una clave TOML al boolean nativo; no se inventa una ni se reinicia el stack
compartido mientras el seed paralelo está trabajando. AUTH-1 permanece pendiente
de cierre operacional coordinado, con evidencia de configuración y flujos normales
autorizados; no repetir procedimientos de bypass del proveedor. Resultados y
límites en [`validation/SECURITY-AUDIT.md`](validation/SECURITY-AUDIT.md).

### Configuración nativa local reproducible (candidata; sin apply canónico)

`scripts/local-auth-config.ts` prepara/verifica únicamente la propiedad nativa
`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true` para el proceso
GoTrue v2.196.0. No copia el `.env` de la aplicación ni las credenciales Auth:
el archivo y su receipt, fuera de Git, contienen una sola clave literal y IDs/hash
no secretos. El helper exige proyecto/puertos locales conocidos, imagen fijada,
proceso y cwd esperados, ausencia de conflicto de entorno, archivo regular sin
symlink y hash exacto. Un archivo/configuración ajenos se rechazan sin sobrescribir.

La CLI 2.117.0 y la 2.120.0 inspeccionadas no ofrecen el mapeo TOML. GoTrue sí
soporta cargar `.env` desde su cwd `/` cuando no hay flags de configuración: ese
loader nativo se utiliza bajo ownership explícito y reinicio del mismo contenedor
Auth, nunca recreación de DB/Storage ni edición de secretos. Es una integración
del launcher local, **no un hook oficial de Supabase CLI**. El cambio normal sigue
enviando `current_password`; recovery y primera contraseña siguen las excepciones
nativas. No introduce una exigencia de contraseña actual inexistente para Google.

El wrapper `scripts/start-local-supabase.ts` reaplica/verifica después del start
normal mediante `supabase:start`; `supabase:auth:local` ofrece PLAN/apply/verify/
rollback explícitos. `scripts/dev.ts` exige la verificación antes de servir QA local. Una
recreación por CLI pierde el archivo de la capa writable: el wrapper debe ejecutarse
de nuevo. Un CLI alternativo o cambios de contenedor mientras Astro ya corre no
están monitorizados continuamente; no declarar enforcement perpetuo ni usar ese
runtime para QA hasta pasar otra vez el launcher. Los runners generales de tests
no se modifican ni aplican este control implícitamente. Integración de entradas
package se limita a esas dos entradas; PERF no modifica package en su rama
inspeccionada. El apply/reinicio canónico y cierre AUTH-1 requieren una ventana
operativa posterior del orquestador; no ocurrieron durante esta implementación.

La instalación del archivo es operator-owned mediante Docker archive (`docker
cp --archive -`) de un tar fijo de una sola entrada `.env`, UID/GID 1000 y modo 0444
independientes de ACLs Windows; se valida también el literal readonly host.
El proceso Auth permanece como `supabase` y
no se ejecuta como root ni se modifica su USER, imagen o privilegios. Hash,
owner/group `1000:1000` y permisos `0444` legibles se verifican antes del restart,
junto con el UID/GID originales del proceso `supabase`. No se afirma propiedad
root: Docker instala con el usuario del servicio; ownership significa gestión
exclusiva del operador y receipt del helper, no resistencia al propietario host
ni al propio servicio con capacidad de chmod sobre su archivo.
El helper serializa sus operadores por lock y revalida container ID/archivo
inmediatamente antes de copiar; Docker archive no ofrece compare-and-swap entre
operadores ajenos, por lo que exige ventana exclusiva sin otras operaciones
Docker. No confiar en esta cooperación como control contra el propietario host.
Rollback sustituye solo su literal por `...=false`, reinicia el mismo Auth y
mantiene receipt `rolledback` que bloquea QA; no elimina archivos como root. Ese
rollback restaura el boolean, **no la ausencia física original del archivo**.

La QA temporal propia `skillbase_test_75b42dad4f824a0f` confirmó enforcement
nativo: cuenta QA recién creada con password conocido recibió
`current_password_required` al omitirlo; el cambio normal correcto y login
posterior conservaron UUID. Con el control activo pasaron los ocho E2E Auth
existentes, retries=0, incluidos primera contraseña Google-only ADMIN y recovery
acotado. No se añadieron casos/specs/suites. El proveedor Google es fixture
controlado; no prueba consentimiento Google ni SMTP reales.

Antes/después de apply, recreación CLI propia y rollback se conservaron conteos
observados y nombres de volúmenes: ledger 24, certificados **0**, un usuario Auth,
un usuario interno/rol, un bucket y cero objetos antes de preparar la suite. Son
conteos **del stack aislado**, no los ocho certificados ni cuentas canónicos.
No fue comparación por hash de todas las filas. Recreación eliminó el archivo y
el consumidor falló cerrado; reapply recuperó la configuración antes de QA.
Rollback al literal false conservó su snapshot y bloqueó el consumidor.
El runner limpió solo su proyecto propio. Esta prueba no activa ni cierra AUTH-1
en el runtime canónico, que sigue pendiente de revisión/ventana del orquestador.
Una comprobación separada en `skillbase_test_ab08e1bf1a7e3515` ejecutó el wrapper
real, comprobó el bloqueo tras recreación CLI directa y reaplicó mediante el
mismo wrapper antes de habilitar el consumidor. También fue limpiada por el
runner estricto, sin repetir la suite Auth.

El full E2E Auth PR 118 pasó 104/104 y PR 120 había pasado 107/107 antes de cambios posteriores. Tras restaurar la dependencia opcional Astro Sharp con `bun install --frozen-lockfile`, la fuente final pasó full E2E 107/107 en `127.0.0.1:4321`; el smoke público/privado pasó y el release CI/deploy de PR 126 se completó. Google OAuth real y SMTP/recovery no estaban probados en ese release histórico. El estado operacional vigente de SMTP (configuración cloud/local y receipt local confirmada, límites de recovery/cloud pendientes) está arriba y en `docs/DEPLOYMENT.md`.

### Gestión multi-ADMIN de Fase 8 (release PR 286)

El backend de aprovisionamiento y lifecycle ADMIN se integró por PR 283 y las
páginas/UI por PR 285; el conjunto se liberó a producción mediante PR 286. No se
crearon cuentas ADMIN reales ni se ejecutaron operaciones autenticadas ADMIN
durante ese release. Si ADMIN activo aprovisiona otra cuenta, crea identidad
confirmada con
contraseña inicial vía Supabase Auth Admin API server-side; la credencial no se
persiste, registra ni retorna y no se fuerza cambio en primer login. Permisos
ADMIN son iguales, sin rol ROOT ni privilegio del primero.

Las rutas `/app/administradores`, `/app/administradores/nuevo` y detalle UUID
son privadas ADMIN. Listado/búsqueda, alta y edición de nombre usan
helpers/loaders server-side; correo es readonly. El backend calcula una acción:
eliminar solo cuenta sin actividad propia/dependencia, o desactivar/reactivar
conservando UUID/historial; baja pendiente se reintenta sobre la misma identidad.
El guard serial mantiene al menos un ADMIN activo, sin prohibición general de
auto-baja cuando queda otro ADMIN. Auth ocurre fuera de la transacción DB y la
compensación de alta solo apunta al UUID recién creado. PR 286 aplicó migration
0022 por el pipeline normal; ledger cloud/canónico es 23. La entrega real de
Google OAuth y recovery/email cloud continúa sin verificarse. Contrato en
[`ADMIN_ACCOUNTS_CONTRACT.md`](ADMIN_ACCOUNTS_CONTRACT.md).

## Aceptación nativa canónica local — 2026-10-12

Supersede únicamente el estado anterior de «apply canónico pendiente». PR340 se
integró como `3ca27c003b85b65ae546aed6077caf3afe9de862` tras revisión del source
`1942a95acfbeb804ca3461d06215f4b74ed58a70` y CI38178212282 SUCCESS: 464 unit,
176 integración más un skip previo, demos independientes 1/1 cada una y 145 E2E
sin flakes/retries. El root hizo fast-forward a
`33578fb1a3369b4f3cddd1a4516ad1c4495eb104` y frozen install preservando WIP y
archivos privados; el helper coincidió exactamente con el source revisado.

La ventana exclusiva autorizada instaló únicamente el literal nativo true
readonly y reinició **el mismo Auth** v2.196.0, ID
`65d0b33548c0cf99be3887a0b5d3014eed2515aa65789c622dd84556d6583d21`, usuario
`supabase` UID/GID1000/label `skillbase`. No hubo stop/start de Supabase,
recreación, reset, seed, migración ni reinicio de DB/Storage. Pre/post inmediato,
antes de QA, coincidió por HMAC server-side en las 78 tablas observadas,
configuración/IDs/volúmenes de contenedores y hashes de TOML/.env/.env.local.
Baseline real: ledger24/certificados8/Auth11/internos20/user_roles12/bucket1/
objetos15/ADMIN activos5. No se imprimieron secretos ni hashes de passwords sin
protección; evidencia privada fuera de Git con ACL del operador.

Las QA ficticias nuevas se aprovisionaron por el caso de uso administrativo y
gateway Admin server-side autorizados. No se inició sesión como otro usuario ni
se cambiaron passwords/roles preexistentes. Una validación estándar del campo
actual sobre la primera QA confirmó enforcement con `current_password_invalid`.
La expectativa inicial del script buscaba erróneamente el literal
`current_password_mismatch`: en la definición oficial v2.196.0,
`ErrorCodeCurrentPasswordMismatch` significa **`current_password_invalid`**. La
incidencia se preservó y esa QA se eliminó por la acción lifecycle ofrecida,
conservando tombstone/intención/auditoría. No se repitió la negativa en la
aceptación UI siguiente ni se alteró producto para ocultar el resultado.

La segunda QA propia verificó login/éxito Sileo, cambio normal con contraseña
actual correcta, nuevo login del mismo UUID y auto-desactivación normal tras su
actividad. El guard rechazó acceso posterior y se revocaron sus sesiones propias.
Por política conserva Auth/cuenta DISABLED/rol/auditoría; no se borra historia
para restaurar artificialmente conteos. Resultado: ledger24/certificados8,
Auth12/internos22/user_roles13/bucket1/objetos15/ADMIN activos5. HMACs de todos
los usuarios/roles/identidades/sesiones/tokens **preexistentes**, y de negocio,
Storage y ledger, permanecieron iguales excluyendo solo las dos QA identificadas.
Auditoría, intención de eliminación y buckets Auth tienen cambios esperados.
**Refrescar seed PLAN después de esta operación**; no se aplicó ningún seed.

Checkpoint final: app normal4321/PID32228/login200, API54321/DB55322 originales,
helper verify PASS y WIP hash
`BBF77E4251CD3CC2F2FF1DFD02FAC41C7B9C582D4C77F8C6DB6F6352F99444C2` intacto.
Antes del lanzamiento4321 estaba libre; no se detuvo un proceso ajeno. La
aceptación **local** AUTH-1 queda validada bajo la regla de identidad aprobada y
los límites documentados; **no es cierre productivo**. Master permanece
`07042f851c8d0fe6b133288c088051bad6973bb5`, sin la promoción combinada; cloud no
se modificó. Recovery/primera contraseña Google mantienen evidencia aislada 8/8
con control activo, no una nueva prueba canónica ni Google OAuth/SMTP reales.
Rollback sigue siendo literal false, no ausencia física; no hay monitorización
continua de operadores CLI alternativos.
