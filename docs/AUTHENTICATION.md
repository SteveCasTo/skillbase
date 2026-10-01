# AUTHENTICATION

## OBJETIVO

Definir autenticación, identidad y autorización inicial.

## PROVEEDOR

Supabase Auth.

## GOOGLE

Google OAuth es el mecanismo visible actualmente. El contrato aprobado para Fase 4 añade email/password para cuentas internas; no implica signup público.

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

## IMPLEMENTACIÓN DE FASE 1

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

El callback acepta únicamente identidades que incluyan el proveedor `google`, correo y `email_confirmed_at`. Una invitación `INVITED` no tiene `authUserId`; el vínculo y el cambio a `ACTIVE` se realizan juntos bajo bloqueo de fila. Una invitación vinculada a otro UUID, una cuenta desconocida, deshabilitada o sin roles se rechaza y se cierra solamente la sesión local recién creada.

En requests posteriores, el middleware crea un cliente `@supabase/ssr` ligado a las cookies del request, valida la identidad con `getUser()` y carga estado y roles desde PostgreSQL mediante Drizzle. No se usa `user_metadata`, dominio de correo ni navegación como autorización.

El parámetro de retorno permite solo rutas relativas locales. El siguiente destino del OAuth se conserva en una cookie breve, `HttpOnly` y `SameSite=Lax`. Logout es `POST`, valida el origen y usa `signOut({ scope: "local" })`.

### Configuración local

- Site URL: `http://127.0.0.1:4321`.
- Redirect permitido exacto: `http://127.0.0.1:4321/auth/callback`.
- Callback que debe registrarse en Google para Supabase local: `http://127.0.0.1:54321/auth/v1/callback`.
- Client ID y secret de Google se leen desde variables ignoradas por Git declaradas en `.env.example`.

En el estado implementado actual, email/password no aparece en la aplicación. Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E con enlaces de un solo uso generados por esa misma API, sin automatizar la UI de Google ni habilitar login público por email. El cambio aprobado de Fase 4 está planificado abajo y todavía no está implementado.

El signup público por email/password está deshabilitado tanto en Supabase local como en el proyecto cloud; esto no impide que la Admin API local cree fixtures. Google es el único proveedor visible habilitado actualmente.

Las rutas privadas tienen políticas exactas: `/app` permite cualquier usuario interno activo con al menos un rol, `/app/cursos` exige `ADMIN` y `/app/asistencia` exige `INSTRUCTOR`. Cualquier ruta futura bajo `/app` se rechaza hasta declarar su política.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`.

## CONTRATO DE FASE 4 (pendiente de implementación)

- Conservar login Google y añadir login por email/password únicamente para identidades internas provisionadas por ADMIN server-side. No abrir signup público ni gestión de altas ADMIN.
- El ADMIN establece la contraseña inicial al crear instructor/cuenta; no se trata como invitación y no se exige cambio en el primer acceso. El usuario podrá cambiarla desde su perfil, de forma opcional.
- Supabase Auth es la única fuente de credenciales. No persistir, registrar, devolver ni precargar contraseñas en almacenamiento de aplicación, DTOs, errores ni logs. El formulario debe quedar vacío al volver a mostrarse.
- Un usuario autenticado puede enlazar Google explícitamente a su misma cuenta. Requerir identidad Google con email verificado y coincidencia tras normalización; no hacer auto-merge ni vincular por similitud sin consentimiento/autenticación.
- Mantener los guards y roles internos como autoridad. Instructor tendrá rol `INSTRUCTOR`; autenticación válida no autoriza automáticamente y el acceso se acota a perfil propio/cursos asignados.
- No conceder acceso de instructor a asistencia/sesiones en Fase 4; ajustar la política exacta de `/app/asistencia` que hoy está registrada para `INSTRUCTOR` para que no anticipe el alcance de Fase 6.
- Mantener OAuth CSRF/state/PKCE y cookies seguras, redirect allowlist existente, validación de origen para mutaciones, `no-store`, limitación razonable de intentos y redacción de credenciales. No exponer Admin API/service role al browser.
- El cambio/recuperación de contraseña usa mecanismos de Supabase Auth. Verificar y documentar configuración SMTP cloud para recuperación; recuperación no bloquea el aprovisionamiento y login inicial con contraseña elegida por ADMIN.

La política de activación/desactivación cuando existen cursos futuros asignados está pendiente de aprobación; no implementar una regla de negocio inferida.
