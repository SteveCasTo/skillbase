# INTEREST REGISTRATION CONTRACT

## ESTADO Y ALCANCE

Contrato técnico de ejecución de Fase 3, basado en RF-PRE-001–004 y ADR-021/022. Describe la implementación prevista; **este documento no acredita código, tablas, migraciones ni pruebas implementadas**. Las propuestas operativas señaladas como pendientes no se convierten en políticas legales aprobadas.

- El único acceso público es el detalle `/cursos/[slug]`. No cambiar landing, catálogo, tarjetas ni sus DTO para este flujo.
- Nombre, apellidos y email obligatorios; teléfono y preferencia de grupo opcionales.
- Un registro independiente por curso/email normalizado, con estados `ACTIVE` y `CANCELLED`. Solo `ADMIN` cancela/reactiva; no existe borrado funcional.
- No crea `Participant`, cuenta, pago, inscripción, asignación ni reserva. Email no verificado es contacto declarado, no identidad global.
- Fase 5 podrá usar el snapshot como prellenado que administración puede corregir, con vínculo explícito y trazable al interesado. No fusionar personas por email ni automatizar esa conversión en Fase 3.
- El cierre público detiene nuevas solicitudes, no cancela ni elimina las existentes. Retención, anonimización, plazo y textos legales requieren definición posterior; no se promete conservación perpetua, verificación de email ni envío de confirmaciones.

## DISPONIBILIDAD Y PREFERENCIA

La regla del servidor es:

```text
deadline = registrationEndAt si existe ventana; en otro caso startsAt
available = course.status == PUBLISHED && databaseNow < deadline
```

El extremo de cierre es **exclusivo**. La ventana ya requiere apertura/cierre conjuntamente; no introducir otra fecha ni `publishedAt` de curso. El estado actual `PUBLISHED` habilita desde la publicación, incluso antes de `registrationStartAt`. Retirar/archivar impide recibir solicitudes; volver a publicar habilita únicamente si todavía no venció el límite.

No reutilizar `registrationAvailability` como condición del formulario: esa política existente describe la ventana presencial (`UPCOMING`, `OPEN`, etc.), no la captación de interés. El backend entrega disponibilidad propia para el detalle y vuelve a comprobarla en cada POST. La lectura SSR puede quedar obsoleta; nunca autoriza la escritura.

Una preferencia nueva solo acepta un UUID de un grupo del mismo curso que actualmente sea `PLANNED`, haya sido expuesto (`publishedAt != null`) y pertenezca al curso publicado. No comprobar capacidad ni calcular plazas. Cursos sin grupos admiten registro con preferencia nula. Si el grupo se cancela después, conservar la referencia histórica y el interesado activo; no reasignar ni cancelar automáticamente a sus interesados.

La exposición ya usa `groups.publishedAt`, el trigger de protección de `drizzle/0009_stiff_la_nuit.sql` y las transacciones de publicación. Conservar ese mecanismo: ningún grupo ofrecido públicamente vuelve a ser eliminable, aunque deje de estar disponible o no tenga interesados.

## INPUT Y NORMALIZACIÓN

Nombre propuesto de contrato compartible: `RegisterInterestInput`. Los campos HTML y JSON usan exactamente estos nombres camelCase:

```ts
type RegisterInterestInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  preferredGroupId?: string | null;
};
```

`firstName` admite varios nombres y `lastName` varios apellidos; no separarlos por espacios ni imponer solo letras ASCII. Estos nombres pertenecen al nuevo agregado, no renombrarán `Participant`.

| Campo              | Regla del servidor                                                                  |
| ------------------ | ----------------------------------------------------------------------------------- |
| `firstName`        | Trim, requerido, 1–100 caracteres Unicode; rechazar caracteres de control.          |
| `lastName`         | Trim, requerido, 1–150 caracteres Unicode; rechazar caracteres de control.          |
| `email`            | Trim y lowercase, requerido, máximo 254 caracteres y formato válido.                |
| `phone`            | Trim, máximo 32 caracteres, sin controles; vacío/ausente pasa a `null`.             |
| `preferredGroupId` | UUID válido; vacío/ausente pasa a `null`; comprobar pertenencia/elegibilidad en DB. |

No eliminar puntos ni sufijos `+` del email, ni aplicar reglas específicas de proveedores. El email persistido es el normalizado; los demás datos son el snapshot de la primera solicitud. No inferir país del teléfono ni prometer que existe o fue verificado.

El slug de la URL resuelve el curso en servidor; no aceptar `courseId`, estado, fechas, actor ni identificadores de participante en el input público. Rechazar campos desconocidos, valores no textuales, archivos y campos repetidos en formularios; JSON debe ser un objeto, no array. Si se aprueba honeypot, su campo técnico se procesa fuera de este input de dominio.

La validación de límites/sintaxis es pura y compartible; la comprobación relacional y temporal corresponde al repositorio. No usar `any` ni importar el schema Drizzle en componentes.

## DTO JSON SERIALIZABLES

Todos los instantes transportados son strings ISO 8601 UTC con milisegundos, nunca `Date`; UUID y enums son strings, conteos son números enteros seguros y ausencia es `null`. Las entidades internas pueden conservar `Date`.

### Solo para el detalle público

Extensión separada, por ejemplo `PublicInterestFormDto`, sin modificar las proyecciones de landing/catálogo:

```ts
type PublicInterestFormDto = {
  available: boolean;
  closesAt: string;
  groups: Array<{ id: string; startTime: string; endTime: string }>;
};
```

`startTime`/`endTime` son `HH:mm` civil de Bolivia, derivados de los instantes del grupo. La UI deriva una etiqueta como «Lunes a viernes, 18:00–19:30» usando el calendario vigente. La proyección consulta exclusivamente ID y tiempos de los grupos elegibles; no expone capacidad, plazas restantes, estado interno, revisión del formato, timestamps administrativos ni interesados. UUID de grupo es una excepción acotada al selector del detalle, no permiso de acceso administrativo. Cuando no hay disponibilidad, `groups` es vacío y se presenta el cierre sin formulario habilitado.

### Administración

```ts
type AdminInterestRegistrationDto = {
  id: string;
  courseId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  preferredGroupId: string | null;
  status: "ACTIVE" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
};

type AdminInterestMetricsDto = {
  courseId: string;
  activeTotal: number;
  byPreference: Array<{
    preferredGroupId: string | null;
    activeCount: number;
  }>;
};

type AdminInterestMutationInput = {
  intent: "cancel" | "reactivate";
  interestRegistrationId: string;
  revision: string;
};
```

`revision` es el `updatedAt` observado, ISO estricto; no es una fecha civil del formulario. `byPreference` incluye siempre el bucket `null` («Sin preferencia»), aun con cero. Incluir los grupos históricos del curso, también cancelados, con cero donde corresponda; no perder preferencias por filtrar solo grupos elegibles públicamente. La suma de buckets debe coincidir con `activeTotal` en la misma lectura consistente. Estado de grupo no cambia este conteo.

Los DTO administrativos se entregan únicamente tras autorización. Un catálogo administrativo separado puede mostrar nombre del curso y etiqueta/estado histórico del grupo; esos datos no se agregan al DTO público. Las métricas se calculan sobre todos los `ACTIVE` del curso, independientemente del filtro de filas por estado, y se rotulan «Interesados activos», nunca «Inscritos», «Ocupación» o «Plazas».

## HTTP: UN SERVIDOR Y DOS PRESENTACIONES

### Público: GET y POST `/cursos/[slug]`

SSR y POST HTML como base; mejora progresiva con `fetch` y `Accept: application/json`. Admitir `application/x-www-form-urlencoded` y `application/json` tras lectura limitada; no son necesarios multipart ni endpoints API adicionales. Ambos formatos invocan el mismo caso de uso, reglas y repositorio. `Accept` decide la respuesta, no la autorización.

Un POST válido devuelve **200**, tanto al crear como ante cualquier duplicado, incluso `CANCELLED`, con exactamente el mismo cuerpo JSON:

```json
{
  "ok": true,
  "message": "Gracias por tu interés. Esta solicitud no reserva una plaza ni confirma una inscripción."
}
```

No devolver ID, estado, email, `created`, `duplicate`, revisión, datos previos ni enlace público de recuperación. No usar 201 para la primera solicitud. HTML devuelve el mismo estado 200 y mensaje neutro sin reenviar datos personales; no introduce un redirect diferente para duplicados. Una recarga puede repetir el POST, pero la unicidad lo hace seguro. No persistir datos del formulario en query string, cookies ni almacenamiento del navegador.

| Estado | Código seguro              | Mensaje/uso                                                     |
| ------ | -------------------------- | --------------------------------------------------------------- |
| 400    | `INVALID_REQUEST`          | «La solicitud no es válida.»; JSON malformado/campos repetidos. |
| 403    | `INVALID_ORIGIN`           | «No se pudo validar el origen de la solicitud.»                 |
| 404    | `COURSE_NOT_FOUND`         | «Curso no encontrado.»; idéntico para inexistente/no público.   |
| 409    | `INTEREST_UNAVAILABLE`     | «Este curso ya no recibe registros de interés.»                 |
| 413    | `BODY_TOO_LARGE`           | «La solicitud supera el tamaño permitido.»                      |
| 415    | `UNSUPPORTED_CONTENT_TYPE` | «El formato de la solicitud no está admitido.»                  |
| 422    | `VALIDATION_FAILED`        | «Revisa los campos indicados.»; issues seguros por campo.       |
| 429    | `RATE_LIMITED`             | «Demasiadas solicitudes. Intenta nuevamente más tarde.»         |
| 503    | `SERVICE_UNAVAILABLE`      | «No se pudo completar la solicitud. Intenta nuevamente.»        |

Errores JSON: `{ ok: false, code, message, issues }`, con `issues: Partial<Record<keyof RegisterInterestInput, string>>` (vacío si no hay errores de campo). Por ejemplo, grupo ajeno/cancelado/no existente produce el mismo issue `preferredGroupId`: «Selecciona una preferencia disponible o continúa sin preferencia.» No reflejar valores enviados ni causas SQL.

Origen, límites y formato se comprueban antes del caso de uso. Para un payload sintácticamente válido, el repositorio comprueba visibilidad, cierre y grupo **antes de resolver el conflicto de unicidad**, también para duplicados. Así no se puede distinguir existencia por saltarse validaciones. Fuera de disponibilidad no existe aceptación de duplicados: se responde 404/409 como a una solicitud nueva. El requisito de respuesta neutra se aplica a solicitudes elegibles y válidas; límites de abuso tampoco distinguen duplicados.

Los POST y los HTML que preserven valores ante errores usan `Cache-Control: no-store`; escapar los valores propios de la solicitud al renderizarlos. Ninguna consulta pública lee datos personales persistidos: la escritura usa `ON CONFLICT DO NOTHING`, no una búsqueda pública de interesado.

### Administración: rutas sugeridas

- `GET /app/interesados`: resumen de cursos con conteos activos y filtro simple por curso; no crear un sistema de búsqueda avanzado.
- `GET /app/interesados/[courseId]`: detalle de interesados del curso y métricas por preferencia, con filtro opcional `status=ACTIVE|CANCELLED` (sin filtro: ambos).
- `POST /app/interesados/[courseId]`: cancelar/reactivar con el input administrativo anterior. Sin endpoint de borrado, edición pública ni API REST separada por operación.

Registrar la ruta exacta y el patrón UUID dinámico en `src/server/auth/route-policy.ts`, ambos solo `ADMIN`. Mantener fail-closed para cualquier otra ruta `/app`. Middleware valida sesión; cada caso de uso vuelve a exigir usuario interno `ACTIVE`/rol `ADMIN` y cada POST origen exacto. Verificar en el repositorio que el interesado pertenece al curso de la URL, no solo en la lista previamente cargada. Instructor, usuario deshabilitado y usuario sin roles no acceden a PII ni métricas.

Éxito JSON: `{ ok: true, registration: AdminInterestRegistrationDto, metrics: AdminInterestMetricsDto }`. Conflicto obsoleto: 409 `{ ok: false, code: "STALE_INTEREST_REGISTRATION", message: "El registro cambió. Revisa su estado antes de reintentar.", registration, metrics }`, solo tras comprobar autorización/ownership. No aplicar automáticamente la intención antigua a la nueva revisión. Intento de cancelar un `CANCELLED` o reactivar un `ACTIVE` con revisión vigente devuelve el DTO actual sin nueva auditoría; una revisión obsoleta sigue siendo conflicto.

Con JavaScript actualizar fila, revisión, controles y métricas desde el DTO recibido, conservando filtros y página; no `location.reload`, recarga completa ni GET posterior obligatorio para reconciliar. Un fetch que termine en redirect de sesión no cuenta como éxito: mostrar sesión caducada y ofrecer login. Sin JavaScript, POST autorizado/redirect 303 de éxito y render SSR de errores preservan el fallback. Toda respuesta administrativa mantiene `private, no-store`.

## PERSISTENCIA Y CONCURRENCIA

### Modelo previsto, no migración implementada

En `src/server/db/schema/index.ts` definir `interestRegistrationStatus` (`ACTIVE`, `CANCELLED`) e `interestRegistrations`, tabla `interest_registrations`, con UUID `id`, FK `courseId`, `firstName`, `lastName`, `email`, `phone` nullable, `preferredGroupId` nullable, estado por defecto `ACTIVE` y `createdAt`/`updatedAt` `timestamptz(3)`. No FK a `users`/`participants` ni snapshot mutable compartido entre cursos.

- Unique **no parcial** `(course_id, email)` para todos los estados: cancelar nunca libera el email. Normalización y checks DB de email trim/lowercase, longitudes y no-blancos respaldan validación de aplicación.
- FK simple `course_id -> courses.id`, `ON DELETE RESTRICT`.
- Unique adicional `groups(course_id, id)` y FK compuesta `(course_id, preferred_group_id) -> groups(course_id, id)`, `ON DELETE RESTRICT`, `MATCH SIMPLE`. Con preferencia nula la FK compuesta no exige grupo; la FK simple sigue exigiendo curso. Evita referencias cruzadas incluso ante escritura directa; no usar `SET NULL` ni cascade que borre historia.
- Índice `(course_id, status, created_at, id)` para filtro/listado determinista; `(course_id, preferred_group_id)` cubre FK/agrupación. Evitar índices redundantes: el unique ya cubre búsqueda curso/email; medir antes de agregar otro índice parcial para métricas.
- Un solo origen: schema central + migraciones versionadas en `drizzle/`/metadata según `drizzle.config.ts`. Incluir constraints, índices, enum, RLS y revokes en la misma entrega; no crear otra fuente de schema en Supabase ni aplicar SQL manual sin versionar.
- Activar RLS sin políticas de Data API y revocar todos los privilegios de tablas a `PUBLIC`, `anon`, `authenticated`, `service_role`. Hacer equivalente para tabla del limiter y revocar acceso directo a tipos/funciones nuevos cuando corresponda. Drizzle server-side sigue siendo responsable de autorización si su conexión bypassa RLS; no confiar en RLS como guard de aplicación.

### Transacción pública

1. Validar y normalizar input fuera de la transacción; consumir el límite de abuso antes del bloqueo de curso.
2. Resolver por slug y bloquear la fila de curso `FOR UPDATE`, como las mutaciones existentes de cursos/grupos. Releer su estado/fechas dentro de la transacción. Inexistente/no público devuelve el mismo 404.
3. **Después de adquirir el bloqueo**, obtener tiempo real de DB con `clock_timestamp()` y evaluar el límite exclusivo cerca del INSERT. `CURRENT_TIMESTAMP`/`now()` congelan el inicio de transacción y pueden quedar obsoletos tras esperar el lock; no usar el timestamp del request ni `Date.now()` para esta decisión.
4. Validar la preferencia en DB bajo ese bloqueo. Mutaciones de grupo también toman primero el padre; una cancelación, retiro o edición concurrente se serializa antes/después del registro. Mantener orden padre → hijo para evitar deadlocks.
5. Insertar snapshot `ACTIVE` con `ON CONFLICT (course_id, email) DO NOTHING`; repetir la condición temporal con reloj DB en la operación de escritura para no aceptar tras el cierre. Si ya venció, devolver 409, no confundirlo con duplicado. El repositorio puede distinguir internamente cierre/conflicto mediante la condición bajo lock, nunca transportarlo como indicador público.
6. Ante conflicto no actualizar nombres, teléfono, preferencia, timestamps ni estado; no reactivar `CANCELLED`. Commit y respuesta neutra idéntica. No devolver la fila existente ni ejecutar upsert con `DO UPDATE`.

Definir el instante de aceptación como la comprobación DB de la escritura: un commit posterior al límite no invalida una solicitud comprobada antes. Transacciones breves, sin HTTP externo, correo ni procesamiento del body bajo lock. Unique garantiza deduplicación además del bloqueo; no confiar en «consultar y luego insertar». Si la respuesta se pierde tras commit, un reintento conserva snapshot/estado y respuesta, sin repetir efectos.

### Mutaciones administrativas y auditoría

Tomar el curso padre y luego releer/bloquear interesado, comprobar ownership y `updatedAt`, actualizar estado y escribir auditoría en la misma transacción. Cancelación/reactivación administrativa no depende de que el curso siga publicado ni de su ventana pública: es gestión del histórico, no nueva solicitud. No alterar datos de contacto ni preferencia en estas acciones.

Usar eventos `INTEREST_REGISTRATION_CANCELLED` y `INTEREST_REGISTRATION_REACTIVATED`, `entityType: "INTEREST_REGISTRATION"`, ID de entidad y actor interno existente. Metadata mínima: `courseId`, `fromStatus`, `toStatus`; no nombres, email, teléfono ni payload. La tabla actual exige actor; no inventar un usuario para creación anónima ni ampliar el schema de auditoría por ese motivo. `createdAt` registra el alta pública; transiciones administrativas tienen auditoría obligatoria. Si falla auditoría, rollback de estado.

Generar revisiones con reloj DB, precisión 3 y avance monotónico mínimo de 1 ms respecto al anterior, para evitar revisiones iguales en mutaciones rápidas. La fila nueva y las métricas retornadas se leen en una misma vista consistente: agregación única o snapshot transaccional coherente, evitando lecturas independientes cuyos buckets no sumen el total.

## PROTECCIÓN RAZONABLE CONTRA ABUSO

Origen exacto mediante `requestHasExpectedOrigin` y `PUBLIC_SITE_URL` (también sin sesión pública), límites por campo, body limitado y deduplicación son obligatorios. Origin no es autenticación: un bot puede falsificarlo. **Honeypot y body limit solos no bastan** para prevenir spam razonablemente en un POST anónimo; tampoco un contador en memoria persiste entre instancias serverless. No se promete eliminar ataques distribuidos ni verificar la identidad del remitente.

Baseline técnico propuesto para implementación, configurable y revisable con evidencia (no cuota comercial ni política legal):

- Máximo **8 KiB** reales por body público, antes de parsear; rechazar `Content-Length` excedido y además contar bytes del stream, incluso sin header o con header falso. Aplicar también un límite explícito al pequeño POST administrativo. Abortar lectura excedida, no hacer primero `formData()`/`json()` ilimitados.
- Limiter persistente PostgreSQL de ventanas fijas: **20 intentos/10 minutos por origen de red y curso**, más **100 intentos/hora por origen de red**. Configuración server-side con enteros positivos y defaults documentados; no usar email como clave ni distinguir nuevos/duplicados. Contar solicitudes antes de deduplicar.
- Tabla técnica `interest_registration_rate_limits` con clave de scope/origen/curso/ventana, contador y expiración. Incremento atómico `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, ventanas calculadas con reloj DB. Si hay varios scopes, comprobarlos en una transacción corta y orden estable; no permitir carreras de «read then increment». La prueba concurrente debe demostrar que nunca pasan más de los límites configurados.
- Obtener IP solo de metadatos del adaptador/proxy confiable configurado en despliegue; no confiar en `X-Forwarded-For` arbitrario. Persistir HMAC con secreto exclusivamente servidor, no IP cruda; no registrar email/body. Si no hay origen fiable/configuración o falla el almacenamiento, responder 503 y no aceptar el registro (fail-closed).
- Exceso responde 429 con `Retry-After` calculado desde las ventanas limitantes. Expirar/limpiar buckets técnicos mediante tarea acotada o limpieza oportunista indexada; no acumular identificadores de red indefinidamente. Este TTL técnico no define retención de datos personales del interesado.

**Pendiente de confirmar durante implementación/despliegue:** valores definitivos según tráfico y NAT compartido, nombre de variables, fuente confiable de IP por plataforma y programación/TTL técnico de limpieza. La propuesta permite implementar y probar con defaults configurables sin paralizar todo el módulo; confirmar la fuente de red y secreto es gate para habilitar el POST en producción, no para comenzar dominio/repositorio/UI.

Honeypot accesible (excluido de foco/lectores de pantalla) es defensa opcional adicional pendiente; si se aprueba, responde el mismo éxito neutro sin persistir. CAPTCHA, Redis, correo de verificación, listas de bloqueo y fingerprinting no se incorporan por defecto. Si se evidencia abuso que el baseline no controla, evaluar protección en el edge sin introducirla como requisito de negocio de Fase 3.

## OWNERSHIP DE IMPLEMENTACIÓN

| Área                       | Responsabilidad                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dominio/aplicación backend | Input/DTO, normalización, regla de interés independiente, errores y casos de uso registrar/listar/cancelar/reactivar. Autorización administrativa sin dependencia HTTP.                     |
| Infraestructura backend    | Repositorio Drizzle, lock de curso, reloj DB, validación de grupo, unique/FK, métricas consistentes, auditoría, migración/RLS/revokes y limiter persistente.                                |
| Adaptador HTTP backend     | Lectura limitada, parsing HTML/JSON, Origin, guards, ownership, códigos/mensajes sanitizados y cache. No duplicar reglas entre formatos.                                                    |
| Frontend público           | Formulario solo en detalle, campos/selector opcional del design system, disponibilidad propia, feedback neutro y errores accesibles. Nunca decide elegibilidad definitiva ni deduplicación. |
| Frontend administrativo    | Navegación solo ADMIN, resumen/detalle/filtro simple, estados, confirmación corta y reconciliación local desde DTO sin recargar. No calcular demanda a partir de una página filtrada.       |

Usar las capas reales del árbol (`src/domain`, `src/application`, `src/server`, `src/components`, `src/pages`), sin generar packages o abstracciones adicionales. Reutilizar guards, conversión Bolivia, conexión DB y patrones HTML/JSON existentes. Los helpers existentes de formularios no proporcionan por sí mismos límite de bytes ni limiter; esas garantías requieren implementación explícita.

UI responsive con labels, foco/teclado, errores por campo y resumen, loading que evita dobles envíos y éxito persistente en el formulario (no solo toast). Texto visible: «Dejar mis datos de interés» y aclaración de que no reserva ni confirma inscripción. Mantener valores propios ante errores; limpiar al aceptar. Sin grupos, ofrecer «Sin preferencia» y no bloquear. No formularios extensos en modal ni PII en analytics/logs. La confirmación administrativa solo contiene la acción corta; mobile no depende de una tabla ancha.

## ACEPTACIÓN Y PRUEBAS DEL FUTURO CAMBIO

### Unit

- Campos obligatorios/opcionales, límites Unicode, controles, email trim/lowercase, `+` y puntos conservados, UUID y revisión ISO estricta.
- Disponibilidad en publicación anterior a apertura presencial, ventana ausente, instante previo/igual/posterior al límite, retiro/archivo y republicación; el formulario no depende de `registrationAvailability == OPEN`.
- DTO públicos sin PII/capacidad y etiqueta horaria Bolivia; serialización sin `Date`; códigos/field issues sanitizados y estados administrativos cerrados.
- Clasificación exacta de rutas ADMIN y fail-closed; parser/body limitado con/sin `Content-Length`, Origin ausente/ajeno, MIME y tipos inválidos.

### Integración en stack temporal aislado

- Unique en todos los estados: solicitudes concurrentes de email equivalente crean una fila; duplicado con datos distintos no cambia snapshot/revisión; duplicado `CANCELLED` no reactiva.
- Mismo email en cursos distintos sí crea registros independientes y no crea/actualiza participantes.
- FK compuesta rechaza grupo ajeno; null funciona; grupo cancelado/no expuesto no es seleccionable; grupo expuesto nunca se borra. Cancelar grupo preserva preferencia y conteos de activos.
- Registro concurrente con retiro/cancelación/edición respeta bloqueo del padre; caso que espera lock hasta después del cierre usa reloj DB fresco y rechaza. No aceptar por timestamp de aplicación o `now()` transaccional obsoleto.
- Cancelar/reactivar audita una vez, conserva snapshot, modifica conteos y revisión; conflicto obsoleto no sobrescribe y retorna DTO vigente autorizado; fallo de auditoría revierte todo.
- Métricas incluyen cero y bucket sin preferencia, excluyen `CANCELLED`, suman total y no expresan plazas. Lectura/retorno coherentes bajo concurrencia.
- Limiter atómico entre conexiones/instancias, límites configurables, ventanas/expiración, duplicados consumen cuota, fallo cerrado sin escritura. RLS y privilegios niegan Data API a los roles de cliente para todas las tablas nuevas.

### HTTP/E2E

- Primera solicitud/duplicado activo/duplicado cancelado tienen exactamente estado 200 y cuerpo neutro iguales; no PII/IDs ni diferencias de redirect. JSON y HTML aplican las mismas validaciones.
- Detalle no público/inexistente da 404 uniforme; detalle publicado cerrado informa cierre y POST 409. Preferencia inválida no permite descubrir interesados existentes.
- Formulario sin JS y con JS, valores preservados, feedback accesible, móvil/teclado y ausencia de promesas de cupo/pago/email; landing y catálogo quedan sin cambios.
- ADMIN consulta/cancela/reactiva; instructor, deshabilitado y desconocido no acceden por URL directa. Origin ajeno y ownership cruzado fallan en servidor.
- Guardado administrativo exitoso y obsoleto reconcilian fila/revisión/métricas manteniendo documento, filtros y foco con JavaScript; sin JavaScript funciona POST/redirect. Sesión caducada no se interpreta como éxito JSON.

Fixtures mínimos, sintéticos y por suite; usar `bun run test:integration` y `bun run test:e2e`, que crean Supabase temporal aislado. **No ejecutar `db:reset`, sembrar fixtures sobre desarrollo ni reutilizar servidores locales**. El cambio de implementación deberá superar formatter, lint, typecheck, pruebas relacionadas y build; este cambio exclusivamente documental verifica el formato de su propio archivo y no afirma que esa implementación ya pasó el gate.
