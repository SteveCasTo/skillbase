# Contrato de cuentas ADMIN (Fase 8)

Este contrato describe el backend de aprovisionamiento/lifecycle (PR 283) y la
interfaz (PR 285) integrados en `development`. La funcionalidad no se ha
promovido a producción. Migration 0022 se probó solo en QA. Plan/evidencia en
[`PLAN.md`](PLAN.md) y [`TESTING.md`](TESTING.md).

## Reglas de cuenta

- Todas las cuentas ADMIN tienen permisos iguales; no existe `ROOT` ni
  privilegio especial de la primera cuenta.
- ADMIN activo crea una cuenta con nombre, correo y contraseña inicial vía
  Supabase Auth Admin API server-side. El correo se normaliza y la contraseña
  sigue la política Auth existente (12–128 caracteres). Se crea identidad
  confirmada y usuario interno ACTIVE, proveedor EMAIL y rol exclusivo ADMIN;
  se audita con UUID real del actor. El actor se revalida antes/después de Auth
  y dentro de la escritura DB. El secreto no se almacena ni aparece
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
- Si Auth falla al completar una baja, la cuenta queda DISABLED/pending; el
  reintento solo acepta `user_not_found` explícito como identidad ya ausente.
  Otros 404/errores de proveedor no se consideran éxito ni se recrea la identidad.
- Renombrar un actor no reescribe evidencia histórica: el cierre conserva el
  UUID y el nombre capturado al emitir cada snapshot, de acuerdo con el contrato
  de cierre académico.

El DTO expone UUID, nombre, email, estado, revision, exclusividad ADMIN,
actividad, eliminación pendiente y la única acción válida. No cuenta como uso
ser actor solo el hecho de figurar como target de una creación ajena; login
aislado tampoco cuenta, aunque dependencias persistidas de actor sí retienen.
Autorización fresca del actor/ownership y el guard global de lifecycle viven en
el repositorio. Auth ocurre fuera de la transacción DB. La compensación de
creación se limita al UUID recién creado; si falla también la compensación puede
quedar identidad Auth huérfana sin reconciliador automático documentado.

La migration candidata `0022_phase8_admin_accounts` crea
`admin_account_deletions`, intención durable con FK restrictivas, RLS, grants
Data API revocados y trigger de evidencia inmutable. Se probó en QA aislado,
ledger 22→23; no se aplicó a canónico/cloud (ledger 21). El código vive en
`src/domain/admin-accounts`, `src/application/admin-accounts` y
`src/server/admin-accounts`.

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

Los helpers `loadAdminAccounts`/`loadAdminAccount` y `handleAdminAccountPost`
delegan a repositorio/casos de uso. POST valida Origin, allowlist y body de 8192
bytes; respuestas son `private, no-store`/`nosniff`. Actor/target vienen del
contexto de sesión y ruta, nunca de body. Las acciones son `create`, `name`,
`delete`, `deactivate`, `activate`, `retry-delete`.

La UI tuvo 32 unit tests PASS y dos E2E dedicados a cuentas (2/2 first-pass sin retries),
además de checks lint/format/typecheck/build reportados PASS. QA E2E usó stack
temporal aislado. Se reportaron intentos focales previos con expectations/locators
fallidos; no se cuentan como suite exitosa. PR 285 integra la UI/policy ADMIN en
development, pero no equivale a release de producción ni al gate combinado
final de Fase 8. CI del PR y límites QA están detallados en [`TESTING.md`](TESTING.md).
