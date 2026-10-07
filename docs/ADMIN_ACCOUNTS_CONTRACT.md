# Contrato de cuentas ADMIN (Fase 8)

Este contrato describe el backend de gestión multi-ADMIN implementado en
`feat/admin-account-management` (commit `4bed53b`, base `356ec1b`). Es código de
feature aún no integrado; no existen páginas Astro ni rutas montadas para este
flujo. El avance de Fase 8 y su evidencia están en [`PLAN.md`](PLAN.md) y
[`TESTING.md`](TESTING.md).

## Reglas de cuenta

- Todas las cuentas ADMIN tienen permisos iguales. No hay `ROOT` ni privilegio
  especial para la primera cuenta.
- ADMIN activo puede aprovisionar otra cuenta con nombre, correo y contraseña
  inicial. El correo se normaliza y la contraseña cumple la regla Auth existente
  (12–128 caracteres). Supabase Auth crea una identidad confirmada usando el
  gateway privilegiado server-side; luego se guarda el usuario interno ACTIVE,
  proveedor primario EMAIL, rol único ADMIN y evento de auditoría con UUID real
  del actor. No se crea perfil profesional de instructor.
- El actor ADMIN se revalida antes y después de la llamada Auth y dentro de la
  escritura PostgreSQL. Si falla la persistencia interna, la compensación solo
  puede eliminar el UUID Auth recién creado por esa operación; nunca una
  identidad preexistente. Auth y PostgreSQL no comparten transacción. Si también
  falla la compensación, puede quedar una identidad Auth huérfana; no hay
  reconciliador automático documentado en este feature.
- La contraseña no se persiste ni se incluye en DTO, evento o respuesta. No se
  registra en logs. La cuenta usa el flujo existente de cambio de contraseña;
  este backend no impone un cambio obligatorio al primer login.
- El correo es de solo lectura después del aprovisionamiento. Para ADMIN
  exclusivo se permite editar el nombre con revisión optimista y evento
  `USER_PROFILE_UPDATED`. No se agrega edición de correo, campos profesionales
  ni perfil/rol INSTRUCTOR.

## Acciones y retención

El DTO de cuenta incluye UUID, nombre, correo, estado, revisión,
`exclusiveAdmin`, `hasActivity`, `deletionPending` y una única acción aplicable.
Una cuenta ADMIN multirol o en estado INVITED no recibe acción de lifecycle en
este módulo.

- Sin actividad propia de actor ni dependencias históricas: `delete`. La baja
  elimina la identidad Auth fuera de la transacción y después retira roles,
  sustituye nombre/correo por valores tombstone y limpia la identidad Google
  aprobada. Conserva `users.id`, `users.auth_user_id`, la fila de intención y la
  auditoría para preservar referencias restrictivas.
- Con actividad/dependencias: solo `deactivate` si ACTIVE o `activate` si
  DISABLED. Se conservan UUID, credenciales y registros históricos.
- Si Auth falla durante una eliminación, la cuenta permanece DISABLED y con
  eliminación pendiente; `retry-delete` reintenta el mismo UUID. Solo el error
  explícito `user_not_found` se interpreta como identidad ya ausente; otros 404
  o errores de proveedor no se tratan como éxito.
- La señal de uso consulta eventos donde el usuario fue actor y referencias
  actor/dependencia en cursos/asignaciones, settings, preinscripciones, ledger y
  receipts, asistencia, evaluaciones, lifecycles y cierres. Ser el target de la
  creación hecha por otro actor no basta. Login aislado no se cuenta como uso;
  solicitudes persistidas de asociación Google sí cuentan como dependencia.
- Se permite baja propia únicamente si aplica la regla de cuenta sin uso y hay
  otro ADMIN activo. Un guard global serializa operaciones y mantiene al menos
  un ADMIN activo; se revalidan actor, estado y revisión bajo locks. Las
  dependencias de negocio que registran actividad se coordinan con la barrera de
  actor para evitar que una cuenta se elimine mientras se registra uso.

## Adaptadores actuales

`loadAdminAccounts` y `loadAdminAccount` son loaders server-side protegidos por
rol ADMIN; el repositorio vuelve a comprobar actor activo y rol. `handleAdminAccountPost`
acepta actor interno autenticado por servidor, operación y target de la ruta; no
lee actor/rol/target del body. Valida Origin, allowlist exacta de campos y body
de hasta 8192 bytes, y devuelve `private, no-store`/`nosniff`. Las operaciones
son `create`, `name`, `delete`, `deactivate`, `activate` y `retry-delete`.
Los errores de concurrencia/último ADMIN/uso/rol exponen estados de conflicto;
fallas Auth o eliminación pendiente no se confirman como éxito.

Estos helpers no implican que exista una URL HTTP pública, UI o policy registrada.
La integración de presentación y pruebas de rutas queda pendiente.
