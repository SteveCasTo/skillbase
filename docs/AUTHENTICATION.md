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

### Configuración local

- Site URL: `http://127.0.0.1:4321`.
- Redirect permitido exacto: `http://127.0.0.1:4321/auth/callback`.
- Callback que debe registrarse en Google para Supabase local: `http://127.0.0.1:55321/auth/v1/callback`.
- Client ID y secret de Google se leen desde variables ignoradas por Git declaradas en `.env.example`.

Al cambiar los puertos locales, el callback anterior `http://127.0.0.1:54321/auth/v1/callback` se sustituye por el de arriba. La allowlist/credencial de Google en consola requiere actualización manual; no se afirma que ya se haya autorizado el nuevo callback ni que Google OAuth real se haya probado. Site URL y redirect de la aplicación web continúan en `127.0.0.1:4321`.

Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E controladas; Google real no es dependencia de la suite general.

El signup público por email/password permanece deshabilitado. En el Supabase local estándar, después de aplicar 0012, están activos el proveedor email/password interno, manual linking y el hook `before_user_created` hacia `private_auth.allow_invited_google_signup`, que autoriza solo invitaciones Google preaprovisionadas con roles. Las cuentas email/password las crea la Admin API desde servidor, que no pasa por el hook. La configuración dual-auth/hook aún no se ha aplicado ni verificado en cloud.

Las rutas privadas tienen políticas fail-closed: `/app` y `/app/perfil` permiten usuario interno activo; mantenimiento de cursos/formats/interesados/participantes/configuración exige `ADMIN`; `/app/mis-cursos` y páginas de sesiones requieren `INSTRUCTOR` más ownership del repositorio. Instructor solo accede a asistencia de sus propios grupos y no a finanzas, CI/email ni settings. Rutas futuras no declaradas bajo `/app` fallan cerradas.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`.

## AUTENTICACIÓN DUAL (Fase 4 liberada mediante PR 126)

### SMTP de Auth (configuración autorizada, 2026-10-04)

Supabase Auth sigue siendo responsable de enviar los correos; la aplicación no incorpora un cliente SMTP. Se configuró Gmail (`smtp.gmail.com`, puerto 587/STARTTLS, remitente `SkillBase`) en el proyecto cloud canónico y se preparó la configuración local mediante referencias a variables privadas. Solo se modificaron los seis campos SMTP y el asunto/contenido de recovery; las dos banderas derivadas de personalización de recovery cambiaron como consecuencia. Google, signup/hook, permisos, sesiones, Site URL, redirects y límites permanecen sin cambios (cloud conserva 2 correos/hora y OTP de 3600 segundos).

La plantilla `supabase/templates/recovery.html` está en español, explica una única acción y usa exclusivamente `{{ .ConfirmationURL }}`, generado y verificado por Auth. No construye redirects ni expone un token sin verificación; no afirma un plazo distinto de la configuración del proveedor. No se habilitan nuevos emails de invitación/signup ni notificaciones.

La configuración SMTP local está integrada en `development` mediante `supabase/config.toml`/plantilla y referencias privadas; el `.env` ignorado del checkout canónico contiene secretos, nunca versionados. Las suites aisladas eliminan el transporte SMTP externo y sus variables antes de arrancar, y copian únicamente las plantillas públicas. No necesitan credenciales de Gmail ni envían correo real.

La configuración SMTP cloud está comprobada por lectura de Admin API, pero la identidad destinataria autorizada no existe en Auth cloud; no se creó otra cuenta ni se hizo una prueba recovery cloud. El usuario confirmó la recepción de un correo de prueba en el buzón autorizado local, verificando entrega SMTP local. Esto no prueba clic de recovery/cambio de contraseña, ni entrega cloud. No afirmar esos flujos ni Google OAuth como verificados; la consola Google aún requiere autorizar el callback local `http://127.0.0.1:55321/auth/v1/callback`.

### Flujos internos y reglas del release dual

- Login email/password convive con Google. Un identificador interno conserva UUID propio y referencia `auth.users.id`; correo y role/state se resuelven desde el usuario interno. La aplicación valida el usuario en vivo mediante `getUser()` y valida los claims firmados mediante `getClaims()` para determinar el método de la sesión actual; no deduce el método de una identidad vinculada.
- `createInstructorAccount(actorAuthUserId, { email, name, password, profile })` se invoca solo desde el flujo server-side ADMIN `/app/instructores/nuevo`, no es endpoint público. Verifica ADMIN activo antes y después de llamar Supabase Admin API, normaliza/valida campos y provisiona usuario Auth confirmado. Después crea usuario interno `ACTIVE`, `authPrimaryProvider=EMAIL`, rol únicamente `INSTRUCTOR` y perfil profesional ligado al mismo ID en una transacción. Si falla la persistencia interna, intenta borrar la identidad Auth recién creada como compensación. La contraseña nunca forma parte del modelo/DTO/evento de auditoría ni respuesta `InternalUser`; no hay paso obligatorio de cambio al primer login.
- El usuario autenticado puede actualizar su propia contraseña opcionalmente en `/app/perfil`. Acepta contraseña actual o confirmación por email; los campos no se repueblan. Flujo de recovery entrega respuesta neutra. La contraseña inicial de cuenta de instructor la elige y establece ADMIN en el aprovisionamiento, sin invitación ni obligación de cambiar al primer acceso.
- Después de que Supabase Auth confirma el cambio, la aplicación registra `PASSWORD_CHANGED` en `audit_events` con actor/entidad internos y sin password, token ni metadata sensible. Auth y PostgreSQL no comparten transacción: si falla esa escritura, el cambio ya aplicado no se reporta como fallido y se emite únicamente `PASSWORD_CHANGE_AUDIT_WRITE_FAILED` con el ID interno del actor.
- El usuario puede solicitar asociación Google explícita desde `/app/perfil`. El intento se liga por cookie firmada y `HttpOnly`, nonce aleatorio almacenado como hash de un uso y expiración de cinco minutos, usuario interno, ID de sesión y `flowId` PKCE. La callback comprueba la sesión original, la identidad Auth resultante, OAuth vigente, Google verificado y coincidencia de email normalizada. Email/Supabase puede asociar automáticamente identidades Google de correo verificado y coincidente; Supabase no ofrece aquí una garantía de impedir esa asociación a nivel proveedor. Por ello la aplicación conserva `approved_google_identity_id` y **deniega autenticación OAuth** por Google no aprobada. En asociación rechazada intenta quitar únicamente la nueva identidad Google y restaura la sesión original; identidad ya asociada en Auth no constituye por sí sola autorización de la aplicación. No se auto-fusionan usuarios internos ni se cambia identidad primaria por una coincidencia de email.
- Para una identidad interna preexistente `auth_primary_provider=GOOGLE`, el login Google vigente se conserva y la contraseña puede añadirse opcionalmente desde perfil. Cuenta provisionada con `auth_primary_provider=EMAIL` requiere asociación explícita aprobada para que OAuth funcione; el login por password sigue siendo independiente y válido aunque Auth haya añadido una identidad Google no aprobada.
- Se mantienen guards, rol/estado internos y rutas fail-closed. ADMIN gestiona perfiles desde `/app/instructores`; un instructor puede editar su nombre/apellidos/teléfono (email de solo lectura) en la sección profesional de `/app/perfil`, consultar `/app/mis-cursos` y operar asistencia solo en grupos propios. Los listados/consultas siempre filtran por `users.id` autenticado, además del guard exacto `INSTRUCTOR`; una URL directa ajena no otorga acceso. Instructor no obtiene acceso a edición de cursos/grupos, formatos, interesados, participantes, settings ni finanzas.
- Las migraciones 0012/0013 definen buckets Auth y requests de asociación; 0014 añade perfiles/asignación y 0015 repara el guard de borrado forward-only. PR 126 aplicó 0012–0015 (ledger 16); el release posterior de Fase 5 avanzó cloud a ledger 18. El hook, email/manual-link provider config, redirects de recovery y `AUTH_RATE_LIMIT_SECRET` están configurados server-only en cloud; nunca registrar el valor.
- Los endpoints de Auth validan origen y límites de intentos (bucket persistente por red y, cuando aplica, cuenta/acción; claves HMAC y no IP/email crudos), limitan y validan cuerpos, usan cookies seguras, callbacks allowlisted y `private, no-store`. Supabase Admin API/service role permanece solo en servidor.
- Supabase Auth es el único almacén de passwords; no guardarlas en PostgreSQL, DTOs ni logs. Gmail SMTP está configurado en cloud y local; se confirmó recepción de un correo de prueba local. La entrega cloud y el flujo completo de recovery/cambio no están verificados; el login inicial password asignado por ADMIN no depende de recovery.

### Estado operacional SMTP

La configuración Supabase Auth SMTP autorizada se aplicó en cloud y local con el remitente de SkillBase. Secretos quedan exclusivamente en Auth y `.env` local ignorado; no se incluyen valores en Git, frontend, CI ni esta documentación. La recepción local de un correo de prueba está confirmada por el usuario. Continúan pendientes el clic/cambio de contraseña desde el enlace, la entrega cloud y la verificación OAuth real.

La autorización manual del callback Google local `http://127.0.0.1:55321/auth/v1/callback` en Google Console sigue pendiente de forma independiente; conservar el callback activo y no afirmar que OAuth real esté validado por configurar SMTP.

Al cierre del release PR 126 no había acción de baja ni esta política. La corrección posterior está implementada e integrada por PR 134 (`b1855b1`), con refinamientos en PR 136 (`8cdb38f`). Se verificó localmente la migración 0016; el release posterior de Fase 5 (`2e0eecb`, cloud ledger 18) es el boundary de producción vigente.

### Corrección Auth/lifecycle (full-suite validada; release posterior de Fase 5)

- Un instructor con cursos asignados no archivados (incluidos `DRAFT`) no se puede desactivar. La UI lista cursos y explica que deben archivarse o reasignarse. Solo se puede desactivar cuando no hay asignaciones a cursos no archivados. Instructor con cualquier asignación histórica nunca se elimina físicamente.
- Eliminación disponible solo si la persona nunca fue asignada, tiene exclusivamente el rol `INSTRUCTOR` y no tiene dependencias de dominio. La operación ADMIN hace transición a `DISABLED`/deletion-pending en PostgreSQL, luego elimina la identidad mediante Supabase Auth Admin y finaliza con perfil/rol removidos y tombstone interno mínimo para conservar referencias/auditoría. Si falla Auth o el paso final, no se reactiva: queda bloqueada y el mismo flujo permite reintentar. Registro y sesión ADMIN se verifican en servidor.
- Todas las rutas/acciones revalidan estado interno; cookie ya emitida no mantiene acceso para instructor desactivado. Reactivación recupera la identidad preservada y la autorización sin recrear ni resetear credenciales.
- La página de cambio de contraseña es independiente de `/app/perfil`. Cuenta password exige validar password actual en servidor, además de nueva/confirmación. La acción «Crear contraseña» de Google-only exige claims firmados de sesión OAuth Google aprobada, `getUser()`/cuenta live y prueba OAuth reciente (menos de 5 minutos); no depende de metadata, de una identidad histórica aislada ni añade verificación por correo en ese formulario. Una prueba de recuperación válida es un camino distinto desde recovery. Auth vuelve a comprobar actor/sesión antes de escribir. Error de password igual a anterior se muestra de forma específica/recuperable. El recovery «Olvidaste tu contraseña» está en página independiente con validez del email y respuesta neutra.
- SMTP cloud/local está configurado; el usuario confirmó recepción de un correo de prueba local. No equivale a recovery/cambio completo ni a entrega cloud, que permanecen sin verificar. La verificación manual de Google OAuth/allowlist continúa pendiente de forma independiente.
- La fuente final `8735d676fe0d96e7230b4636efa8cb51045d1eca` (base `ddd0f3de`) pasó 178 unit, 98 integration y full E2E 120/120, además de lint/format/typecheck/build/Drizzle/diff checks; se integró en `development` por PR 136 (`8cdb38f`). 0016 se aplicó al Supabase local estándar (ledger 17) y el smoke pasó. La producción posterior de Fase 5 (`2e0eecb`) migró cloud hasta ledger 18; SMTP y Google OAuth real mantienen verificaciones independientes pendientes.

La migración aditiva 0014 vincula el perfil profesional con el ID interno estable y añade `courses.instructor_id`, preservando `instructor_name` histórico sin backfill automático. PRs 118–123 integraron Auth, instructores, seed local, auditoría de password y guard de formato; PR 126 los desplegó a producción.

El full E2E Auth PR 118 pasó 104/104 y PR 120 había pasado 107/107 antes de cambios posteriores. Tras restaurar la dependencia opcional Astro Sharp con `bun install --frozen-lockfile`, la fuente final pasó full E2E 107/107 en `127.0.0.1:4321`; el smoke público/privado pasó y el release CI/deploy de PR 126 se completó. Google OAuth real y SMTP/recovery no estaban probados en ese release histórico. El estado operacional vigente de SMTP (configuración cloud/local y receipt local confirmada, límites de recovery/cloud pendientes) está arriba y en `docs/DEPLOYMENT.md`.
