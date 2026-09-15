# AUTHENTICATION

## OBJETIVO

Definir autenticación, identidad y autorización inicial.

## PROVEEDOR

Supabase Auth.

## GOOGLE

Google OAuth será el mecanismo inicial de inicio de sesión.

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

Email/password no aparece en la aplicación. Los fixtures locales crean usuarios de Auth confirmados mediante Admin API y obtienen sesiones E2E con enlaces de un solo uso generados por esa misma API, sin automatizar la UI de Google ni habilitar login público por email.

El signup público por email/password está deshabilitado tanto en Supabase local como en el proyecto cloud; esto no impide que la Admin API local cree fixtures. Google es el único proveedor habilitado para el flujo visible de la aplicación.

Las rutas privadas tienen políticas exactas: `/app` permite cualquier usuario interno activo con al menos un rol, `/app/cursos` exige `ADMIN` y `/app/asistencia` exige `INSTRUCTOR`. Cualquier ruta futura bajo `/app` se rechaza hasta declarar su política.

### Configuración cloud

El proyecto `SkillBase` está enlazado con referencia `fvzxqlezdrlzykyoevub`. Google OAuth, Site URL y el callback `https://skillbase-alpha.vercel.app/auth/callback` están configurados. El primer administrador permanece como invitación `INVITED` hasta completar su primer acceso Google, momento en que se vinculará su UUID Auth y pasará a `ACTIVE`.

El flujo cloud fue verificado manualmente desde Vercel hasta Google y de regreso a `/app`. El primer administrador quedó vinculado a su identidad Auth, en estado `ACTIVE` y con rol `ADMIN`.
