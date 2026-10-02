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
- Callback que debe registrarse en Google para Supabase local: `http://127.0.0.1:54321/auth/v1/callback`.
- Client ID y secret de Google se leen desde variables ignoradas por Git declaradas en `.env.example`.

Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E controladas; Google real no es dependencia de la suite general.

El signup público por email/password permanece deshabilitado. En el Supabase local estándar, después de aplicar 0012, están activos el proveedor email/password interno, manual linking y el hook `before_user_created` hacia `private_auth.allow_invited_google_signup`, que autoriza solo invitaciones Google preaprovisionadas con roles. Las cuentas email/password las crea la Admin API desde servidor, que no pasa por el hook. La configuración dual-auth/hook aún no se ha aplicado ni verificado en cloud.

Las rutas privadas tienen políticas exactas: `/app` y `/app/perfil` permiten usuario interno activo; `/app/instructores` y mantenimiento de cursos/formats/interesados exigen `ADMIN`; `/app/mis-cursos` y su detalle requieren `INSTRUCTOR` y el repositorio filtra además por ownership. No se concede acceso de instructor a asistencia/sesiones, formatos ni interesados. Rutas futuras no declaradas bajo `/app` fallan cerradas.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`.

## AUTENTICACIÓN DUAL (Fase 4 liberada mediante PR 126)

- Login email/password convive con Google. Un identificador interno conserva UUID propio y referencia `auth.users.id`; correo y role/state se resuelven desde el usuario interno. La aplicación valida el usuario en vivo mediante `getUser()` y valida los claims firmados mediante `getClaims()` para determinar el método de la sesión actual; no deduce el método de una identidad vinculada.
- `createInstructorAccount(actorAuthUserId, { email, name, password, profile })` se invoca solo desde el flujo server-side ADMIN `/app/instructores/nuevo`, no es endpoint público. Verifica ADMIN activo antes y después de llamar Supabase Admin API, normaliza/valida campos y provisiona usuario Auth confirmado. Después crea usuario interno `ACTIVE`, `authPrimaryProvider=EMAIL`, rol únicamente `INSTRUCTOR` y perfil profesional ligado al mismo ID en una transacción. Si falla la persistencia interna, intenta borrar la identidad Auth recién creada como compensación. La contraseña nunca forma parte del modelo/DTO/evento de auditoría ni respuesta `InternalUser`; no hay paso obligatorio de cambio al primer login.
- El usuario autenticado puede actualizar su propia contraseña opcionalmente en `/app/perfil`. Acepta contraseña actual o confirmación por email; los campos no se repueblan. Flujo de recovery entrega respuesta neutra. La contraseña inicial de cuenta de instructor la elige y establece ADMIN en el aprovisionamiento, sin invitación ni obligación de cambiar al primer acceso.
- Después de que Supabase Auth confirma el cambio, la aplicación registra `PASSWORD_CHANGED` en `audit_events` con actor/entidad internos y sin password, token ni metadata sensible. Auth y PostgreSQL no comparten transacción: si falla esa escritura, el cambio ya aplicado no se reporta como fallido y se emite únicamente `PASSWORD_CHANGE_AUDIT_WRITE_FAILED` con el ID interno del actor.
- El usuario puede solicitar asociación Google explícita desde `/app/perfil`. El intento se liga por cookie firmada y `HttpOnly`, nonce aleatorio almacenado como hash de un uso y expiración de cinco minutos, usuario interno, ID de sesión y `flowId` PKCE. La callback comprueba la sesión original, la identidad Auth resultante, OAuth vigente, Google verificado y coincidencia de email normalizada. Email/Supabase puede asociar automáticamente identidades Google de correo verificado y coincidente; Supabase no ofrece aquí una garantía de impedir esa asociación a nivel proveedor. Por ello la aplicación conserva `approved_google_identity_id` y **deniega autenticación OAuth** por Google no aprobada. En asociación rechazada intenta quitar únicamente la nueva identidad Google y restaura la sesión original; identidad ya asociada en Auth no constituye por sí sola autorización de la aplicación. No se auto-fusionan usuarios internos ni se cambia identidad primaria por una coincidencia de email.
- Para una identidad interna preexistente `auth_primary_provider=GOOGLE`, el login Google vigente se conserva y la contraseña puede añadirse opcionalmente desde perfil. Cuenta provisionada con `auth_primary_provider=EMAIL` requiere asociación explícita aprobada para que OAuth funcione; el login por password sigue siendo independiente y válido aunque Auth haya añadido una identidad Google no aprobada.
- Se mantienen guards, rol/estado internos y rutas fail-closed. ADMIN gestiona perfiles desde `/app/instructores`; un instructor puede editar su nombre/apellidos/teléfono (email de solo lectura) en la sección profesional de `/app/perfil` y consultar `/app/mis-cursos`/detalle. Los listados/consultas de curso siempre filtran por `users.id` autenticado, además del guard exacto `INSTRUCTOR`; una URL directa ajena no otorga acceso. No incluye edición de cursos/grupos, formatos, interesados, participantes, asistencia ni sesiones.
- Las migraciones 0012/0013 definen buckets Auth y requests de asociación; 0014 añade perfiles/asignación y 0015 repara el guard de borrado forward-only. PR 126 aplicó 0012–0015 local/cloud; ambos ledgers tienen 16 entradas. El hook, email/manual-link provider config, redirects de recovery y `AUTH_RATE_LIMIT_SECRET` están configurados server-only en cloud; nunca registrar el valor.
- Los endpoints de Auth validan origen y límites de intentos (bucket persistente por red y, cuando aplica, cuenta/acción; claves HMAC y no IP/email crudos), limitan y validan cuerpos, usan cookies seguras, callbacks allowlisted y `private, no-store`. Supabase Admin API/service role permanece solo en servidor.
- Supabase Auth es el único almacén de passwords; no guardarlas en PostgreSQL, DTOs ni logs. No se configuró SMTP propio ni se verificó entrega de recovery en cloud; permisos/límites del remitente por defecto tampoco se probaron. El login inicial password asignado por ADMIN no depende de recovery; Forgot password no está listo para prometer en producción, y ADMIN Google-only que requiera confirmación por email depende de entrega aún no verificada.

Al cierre del release PR 126 no había acción de baja ni política aplicada para instructores con cursos asignados; el alcance correctivo autorizado después del release se registra a continuación. No describe comportamiento ya implementado.

### Correcciones de Auth autorizadas para trabajo futuro; todavía no implementadas

El backlog de correcciones Fase 4 cambia la política propuesta hacia baja controlada, sin alterar el hecho histórico de que el release PR 126 no incluía la acción. Eliminar físicamente sería candidato solo para un instructor nunca asignado, con rol único `INSTRUCTOR` y sin dependencias; debe eliminarse identidad interna/Auth de forma consistente y segura. Un instructor con cualquier asignación histórica no se elimina: solo activar/desactivar. Desactivado debe ser rechazado server-side en todas las rutas/acciones, incluidos password y Google, y en sesiones que todavía tengan cookies vigentes.

Política confirmada para implementar: si tiene asignaciones a cursos no archivados, bloquear desactivación, mostrar la lista y exigir resolver/reasignar asignaciones; permitirla cuando solo queden referencias a archivados. Borrado físico solo para instructor nunca asignado, único rol `INSTRUCTOR`, sin otras dependencias y con identidad Auth eliminada consistentemente. Las sesiones vigentes deben ser denegadas server-side comprobando estado/rol actual; no basta con ocultar interfaz o solo revocar una cookie.

El flujo futuro de establecer password para usuario Google-only debe tener página/acción dedicada, pero validar en servidor sesión Google aprobada, actor, identidad del proveedor y actualidad/autenticación reciente que corresponda; no confiar en metadata editable ni en que una identidad Google vinculada históricamente prueba el método de la sesión. No se elimina ninguna confirmación requerida para cambio de password. Para usuario password, el cambio dedicado solicita password actual, nueva y confirmación; diferencias, password repetida y validez se validan server-side con errores inline recuperables. Recovery por correo es flujo separado y permanece sin promesa de entrega hasta verificar SMTP/entrega real.

La migración aditiva 0014 vincula el perfil profesional con el ID interno estable y añade `courses.instructor_id`, preservando `instructor_name` histórico sin backfill automático. PRs 118–123 integraron Auth, instructores, seed local, auditoría de password y guard de formato; PR 126 los desplegó a producción.

El full E2E Auth PR 118 pasó 104/104 y PR 120 había pasado 107/107 antes de cambios posteriores. Tras restaurar la dependencia opcional Astro Sharp con `bun install --frozen-lockfile`, la fuente final pasó full E2E 107/107 en `127.0.0.1:4321`; el smoke público/privado pasó y el release CI/deploy de PR 126 se completó. Google OAuth real y entrega SMTP/recovery cloud siguen sin probarse, aunque el hook/provider/redirect config y secret están desplegados. Producción está en Fase 4 (`31623e7`); el antecedente Fase 3 (`8f5bb2d`) permanece en el historial.
