# Contrato de cuentas ADMIN (Fase 8)

Este contrato reúne el backend de aprovisionamiento/lifecycle y la interfaz
implementada en `feat/admin-account-interface` (base `4bed53b`). Son cambios en
feature, aún no integrados a `development` ni liberados. El plan y evidencia
focal están en [`PLAN.md`](PLAN.md) y [`TESTING.md`](TESTING.md).

## Reglas de cuenta

- Todas las cuentas ADMIN tienen permisos iguales; no existe `ROOT` ni
  privilegio especial de la primera cuenta.
- ADMIN activo crea una cuenta con nombre, correo y contraseña inicial vía
  Supabase Auth Admin API server-side. Se crea identidad confirmada y usuario
  interno ACTIVE con rol exclusivo ADMIN. El secreto no se almacena ni aparece
  en DTO, respuesta o auditoría; no se exige cambiar la contraseña en el primer
  login. El flujo normal de cambio de contraseña sigue disponible.
- El nombre se puede editar en cuentas ADMIN exclusivas con revisión optimista;
  el correo se muestra como texto readonly. No se agregan campos profesionales
  ni rol/perfil INSTRUCTOR.
- Las acciones visibles provienen del DTO calculado por backend: eliminar
  cuenta sin actividad de actor ni dependencia; desactivar/reactivar cuando sí
  existe actividad; o reintentar una eliminación pendiente. No hay regla
  especial de primer administrador. El backend serializa cambios y conserva al
  menos un ADMIN activo, incluyendo auto-desactivación/baja solo cuando otro
  ADMIN permanece activo.
- La eliminación de una cuenta no usada deshabilita primero el acceso, usa una
  intención durable para Auth fuera de la transacción y conserva UUID, actor,
  historial/auditoría y tombstone. Si Auth falla, la cuenta queda bloqueada y
  pending; el reintento apunta a la misma identidad. La actividad incluye uso
  como actor o dependencia histórica; ser target de una acción de otro actor o
  un login aislado no basta.
- Renombrar un actor no reescribe evidencia histórica: el cierre conserva el
  UUID y el nombre capturado al emitir cada snapshot, de acuerdo con el contrato
  de cierre académico.

La implementación del backend, DTO, catálogo de actividad, límites de
compensación y migration 0022 se detallan en el código de `src/domain/admin-accounts`,
`src/application/admin-accounts` y `src/server/admin-accounts`.

## Páginas y autorización

La UI incluye tres páginas SSR:

- `/app/administradores`: lista tarjetas ADMIN y permite buscar nombre/correo;
- `/app/administradores/nuevo`: alta de nombre, email y contraseña inicial;
- `/app/administradores/:id`: detalle con edición del nombre y acción de
  lifecycle aplicable.

Las tres rutas son privadas y están registradas explícitamente para `ADMIN`;
los detalles aceptan UUID estructural específico. La navegación muestra
«Administradores» a todo usuario con rol ADMIN. No existe excepción ROOT ni
ocultamiento de las cuentas creadas por otro ADMIN. El servidor vuelve a validar
actor activo/rol, revision y acción actual; target y actor nunca se autorizan
desde datos enviados por el navegador.

## Comportamiento de interfaz

- Formularios SSR conservan fallback HTML. La mejora progresiva valida
  campos/dirty, mantiene errores inline y no devuelve el password al navegador.
- El detalle usa la acción/estado del DTO. El ciclo de confirmación es accesible
  por teclado, devuelve foco al control y ofrece error/pending/reload. Si la
  acción propia desactiva o elimina al actor, la respuesta dirige a login; no
  se afirma una prohibición general de auto-baja si existe otro ADMIN activo.
- Las tarjetas fluyen en grid responsive, permiten nombres/emails largos y
  búsqueda cliente accesible; las acciones de lifecycle son discretas y
  confirmadas, no una edición de roles.
- Error de concurrencia, 403, 409/422 o Auth pendiente no simula éxito ni borra
  el draft no secreto. Se revalida/relee estado desde el servidor.

## Estado y verificación

Este feature tiene 32 unit tests y dos E2E de cuentas (2/2 first-pass sin
retries), además de lint/format/typecheck/build PASS reportados. Los checks y la
prueba real de E2E usan stack temporal aislado, no acreditan release ni el gate
integrado de Fase 8. Hubo intentos QA previos focales con errores de expectativas
o locators; se conservan como historial, no como suites exitosas. La navegación,
policy y páginas ADMIN están implementadas en esta rama, pero no integradas en
`development`.
