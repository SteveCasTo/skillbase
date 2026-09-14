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
