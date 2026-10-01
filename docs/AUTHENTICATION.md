# AUTHENTICATION

## OBJETIVO

Definir autenticación, identidad y autorización inicial.

## PROVEEDOR

Supabase Auth.

## GOOGLE

Google OAuth y email/password son mecanismos visibles para usuarios internos. El flujo de email/password y la asociación opcional de Google están implementados en la rama de feature de Fase 4; integración en `development`, migraciones aplicadas y habilitación cloud siguen pendientes. No hay signup público abierto.

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
- Callback que debe registrarse en Google para Supabase local: `http://127.0.0.1:54321/auth/v1/callback`.
- Client ID y secret de Google se leen desde variables ignoradas por Git declaradas en `.env.example`.

Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E controladas; Google real no es dependencia de la suite general.

El signup público por email/password permanece deshabilitado tanto en Supabase local como en cloud. Para permitir invitaciones Google existentes, el stack de aplicación configura el hook `before_user_created` y la migración 0012 define `private_auth.allow_invited_google_signup`; el hook autoriza solo invitaciones Google preaprovisionadas con roles. Las cuentas email/password las crea la Admin API desde servidor, que no pasa por el hook. La aplicación no ofrece signup.

Las rutas privadas tienen políticas exactas: `/app` permite cualquier usuario interno activo con al menos un rol; rutas administrativas (cursos, formatos e interesados) exigen `ADMIN`; `/app/perfil` permite al usuario activo. No se concede acceso de instructor a asistencia/sesiones en esta etapa. Cualquier ruta futura bajo `/app` se rechaza hasta declarar su política.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`.

## AUTENTICACIÓN DUAL IMPLEMENTADA (feature de Fase 4; integración y habilitación pendientes)

- Login email/password convive con Google. Un identificador interno conserva UUID propio y referencia `auth.users.id`; correo y role/state se resuelven desde el usuario interno. La aplicación valida el usuario en vivo mediante `getUser()` y valida los claims firmados mediante `getClaims()` para determinar el método de la sesión actual; no deduce el método de una identidad vinculada.
- `createInstructorAccount(actorAuthUserId, { email, name, password })` es operación de servidor, no endpoint público. Verifica ADMIN activo antes y después de llamar Supabase Admin API, normaliza/valida campos y provisiona usuario Auth confirmado. Después crea usuario interno `ACTIVE`, `authPrimaryProvider=EMAIL` y rol únicamente `INSTRUCTOR` en transacción. Si falla el registro interno, intenta borrar la identidad Auth recién creada como compensación. La contraseña nunca forma parte del input persistido, usuario interno, evento de auditoría ni respuesta `InternalUser`; no existe aún pantalla administrativa de alta/asignación de instructores.
- El usuario autenticado puede actualizar su propia contraseña opcionalmente en `/app/perfil`. Acepta contraseña actual o confirmación por email; los campos no se repueblan. Flujo de recovery entrega respuesta neutra. La contraseña inicial de cuenta de instructor la elige y establece ADMIN en el aprovisionamiento, sin invitación ni obligación de cambiar al primer acceso.
- El usuario puede solicitar asociación Google explícita desde `/app/perfil`. El intento se liga por cookie firmada y `HttpOnly`, nonce aleatorio almacenado como hash de un uso y expiración de cinco minutos, usuario interno, ID de sesión y `flowId` PKCE. La callback comprueba la sesión original, la identidad Auth resultante, OAuth vigente, Google verificado y coincidencia de email normalizada. Email/Supabase puede asociar automáticamente identidades Google de correo verificado y coincidente; Supabase no ofrece aquí una garantía de impedir esa asociación a nivel proveedor. Por ello la aplicación conserva `approved_google_identity_id` y **deniega autenticación OAuth** por Google no aprobada. En asociación rechazada intenta quitar únicamente la nueva identidad Google y restaura la sesión original; identidad ya asociada en Auth no constituye por sí sola autorización de la aplicación. No se auto-fusionan usuarios internos ni se cambia identidad primaria por una coincidencia de email.
- Para una identidad interna preexistente `auth_primary_provider=GOOGLE`, el login Google vigente se conserva y la contraseña puede añadirse opcionalmente desde perfil. Cuenta provisionada con `auth_primary_provider=EMAIL` requiere asociación explícita aprobada para que OAuth funcione; el login por password sigue siendo independiente y válido aunque Auth haya añadido una identidad Google no aprobada.
- Se mantienen guards, rol/estado internos y rutas fail-closed. Instructor aún no tiene gestión de perfil de instructor ni asignación/cursos propios; la ruta `/app/perfil` es la configuración de la cuenta autenticada, no CRUD administrativo de instructores. La autorización de asistencia y sesiones sigue fuera del alcance implementado.
- Las migraciones 0012 y 0013 definen buckets de rate-limit/seguridad, aprobación de identidad y requests de asociación. Antes de habilitar el feature hay que aplicar ambas, configurar el hook `private_auth.allow_invited_google_signup` en el stack correspondiente y proveer `AUTH_RATE_LIMIT_SECRET` server-only de al menos 32 caracteres. La configuración local versionada contiene el hook, pero el estado de stack/configuración cloud no está aplicado/verificado.
- Los endpoints de Auth validan origen y límites de intentos (bucket persistente por red y, cuando aplica, cuenta/acción; claves HMAC y no IP/email crudos), limitan y validan cuerpos, usan cookies seguras, callbacks allowlisted y `private, no-store`. Supabase Admin API/service role permanece solo en servidor.
- Supabase Auth es el único almacén de passwords; no guardarlas en PostgreSQL, DTOs ni logs. SMTP/entrega real de email de recovery no ha sido configurada ni probada en local/cloud. El login inicial password no depende de recovery.

La política de activación/desactivación cuando existen cursos futuros asignados está pendiente de aprobación; no implementar una regla de negocio inferida.

La rama de implementación consta de commits `5613399`, `958053a` y `5ff585c` sobre `cf601d8`. Al corte de esta actualización el feature no tiene PR ni se ha integrado en `development`; producción continúa en el release Fase 3 de `master` (`8f5bb2d`) y no se ha promovido ningún cambio Auth a `master`.
