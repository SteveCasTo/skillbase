# SECURITY

## OBJETIVO

Definir requisitos mínimos de seguridad para autenticación, autorización, rutas, archivos, datos y certificados.

## PRINCIPIO

No confiar en el cliente.

Toda operación sensible debe validarse en servidor.

## AUTHENTICATION

- Supabase Auth.
- Google OAuth.
- sesiones seguras.
- expiración manejada correctamente.
- no almacenar tokens innecesariamente.
- no exponer service-role key al navegador.

## AUTHORIZATION

Roles iniciales:

- ADMIN.
- INSTRUCTOR.

Participantes públicos no obtienen automáticamente acceso autenticado.

Cada operación debe validar permisos.

Ejemplos:

Administrador:

- puede gestionar cursos y grupos;
- puede confirmar inscripciones;
- puede gestionar certificados.

Instructor:

- el objetivo posterior es operar únicamente sobre cursos/grupos asignados;
- asistencia y evaluaciones requieren su módulo y autorización explícitos en fases posteriores; no se conceden por el mero rol `INSTRUCTOR` en el alcance actual.

No confiar únicamente en ocultar botones.

### Autenticación dual (implementada en la rama de feature; no habilitada en cloud)

- Email/password no habilita signup público. `createInstructorAccount` es una operación server-side, autorizada a ADMIN activo; crea identidad confirmada con Supabase Admin API, verifica de nuevo al actor, transacciona usuario interno y rol `INSTRUCTOR`, y compensa borrando la identidad nueva si la escritura interna falla. La contraseña no se persiste ni se registra.
- La validación del método actual de autenticación combina `getUser()` (identidad/sesión vigente) con `getClaims()` (claims firmados y `amr` para PASSWORD/OAUTH/confirmación). No confiar en lista de identidades del usuario para inferir por cuál método se autenticó.
- Supabase puede asociar automáticamente una identidad Google cuando verifica que su email coincide; la aplicación no afirma ni depende de que esa asociación de proveedor se pueda desactivar. Para usuarios cuyo proveedor primario legado es `GOOGLE`, se conserva su acceso Google verificado. Para cuentas `EMAIL`, la asociación nueva aprobada por la aplicación se registra en `approved_google_identity_id`; OAuth Google sin esa aprobación se deniega, mientras una sesión PASSWORD sigue siendo válida. Esto separa asociación Auth a nivel proveedor de aprobación de acceso de aplicación.
- El flujo de asociación inicia desde cuenta autenticada, valida origen y aplica rate limit. La prueba está firmada con `AUTH_RATE_LIMIT_SECRET`, cookie `HttpOnly`/`SameSite=Lax`/`Secure` según HTTPS, nonce con hash almacenado en DB, un solo uso y cinco minutos, ligada a usuario interno y sesión original; callback valida PKCE `flowId`, sesión OAuth, proveedor Google, email verificado normalizado y la misma identidad Auth. Ante un resultado no aceptado, intenta eliminar solo la identidad Google recién agregada (sin afectar las preexistentes) y restaurar la sesión inicial. La identidad de Auth sola nunca concede aprobación interna.
- Los intentos de login/recovery/callback/enlace usan bucket persistente atómico por acción y red, y por cuenta cuando hay email; claves HMAC con dirección y email no crudos. El secreto server-only debe tener al menos 32 caracteres. No se han aplicado aún migraciones 0012/0013 ni verificado la habilitación de hook/configuración cloud.
- Los endpoints mantienen validación de origen, body form-urlencoded con límite/tamaño y campos únicos, `private, no-store`, redirects explícitos, errores neutros y sin credenciales. No exponer service-role secret/cliente privilegiado al browser.
- Esta implementación no añade interfaz de administración de instructores ni asignación a cursos; por tanto, las reglas de ownership de curso e instructor siguen pendientes de su módulo posterior.

## RUTAS

Las rutas privadas deben validar sesión server-side.

No basta con redirect en React.

Las rutas públicas de certificados deben mostrar únicamente información permitida.

## RLS

Si se utilizan accesos directos mediante cliente Supabase, las políticas RLS deben considerarse obligatorias.

El uso server-side con Drizzle no elimina la necesidad de revisar qué credenciales se usan y qué acceso posee cada servicio.

## ARCHIVOS

Todo upload debe validar:

- autenticación;
- autorización;
- finalidad;
- tamaño;
- extensión;
- MIME;
- nombre generado por servidor;
- bucket;
- path;
- estado relacionado.

No confiar únicamente en `accept` del input.

No conservar nombre original como identificador interno.

## MIME

Mantener allowlists por caso de uso.

Ejemplo:

Certificado final:

- `application/pdf`.

No aceptar formatos arbitrarios.

El flujo actual acepta fotografía de curso mediante un editor que exporta WebP; ver las restricciones de upload y el bucket público específico en «Artwork de cursos» más abajo. Esto no habilita otros tipos de archivo.

## STORAGE

Separar buckets o políticas según sensibilidad.

No exponer buckets privados mediante URL pública permanente.

Utilizar URLs firmadas cuando corresponda.

### Artwork de cursos

- El bucket `course-artwork` es público solo para lectura porque sus objetos se destinan a cursos publicados; no contiene documentos personales.
- El endpoint de aplicación realiza la carga usando `SUPABASE_SERVICE_ROLE_KEY` exclusivamente server-side. Storage no concede upload directo al navegador y no se entrega esa credencial en props, respuestas ni bundle.
- Se exige origen esperado, usuario interno activo y rol `ADMIN`. El curso debe existir y no estar archivado.
- El request multipart está limitado; se valida `image/webp`, extensión `.webp`, bytes reales, dimensiones y contenedor WebP estático simple. Se rechazan formatos animados/extendidos. El editor convierte PNG/JPEG/WebP al WebP canónico recortado.
- Las keys son generadas por servidor bajo `courses/{courseId}/{uuid}.webp`; al guardar se comprueba que la key pertenezca al curso y que el objeto exista en el bucket. Solo keys canónicas generan URLs públicas, desde el origen Supabase configurado.
- La configuración del bucket (público, solo `image/webp`, 4 MiB) se comprueba/crea al usar el servicio; esto no equivale a despliegue cloud verificado.

## DATOS PERSONALES

Recolectar únicamente lo necesario.

No mostrar públicamente:

- CI;
- correo;
- teléfono;
- información administrativa;
- calificaciones parciales;
- asistencia.

La verificación pública de certificado debe limitarse a información necesaria para validar la credencial.

## CERTIFICADOS

Cada certificado debe tener:

- ID interno;
- credential ID público impredecible;
- estado;
- fecha de emisión;
- hash del archivo final;
- trazabilidad.

El QR debe apuntar a una URL de verificación controlada por la aplicación.

El QR no constituye por sí mismo prueba de autenticidad.

## HASH

Calcular SHA-256 del certificado final firmado.

Un cambio en el archivo debe invalidar la comparación de hash.

## REVOCACIÓN

Un certificado revocado no debe eliminarse.

Debe conservar:

- estado;
- fecha;
- motivo;
- actor responsable.

La página pública debe mostrar claramente que ya no es válido.

## AUDITORÍA

Registrar eventos sensibles.

No guardar secretos ni tokens completos en logs.

Eventos sugeridos:

- login administrativo relevante;
- cambio de rol;
- modificación de nota después de publicación;
- cambio de asistencia;
- descuento;
- devolución;
- emisión;
- revocación;
- reemplazo de certificado.

## INPUT VALIDATION

Validar entradas server-side.

No confiar solo en validación React.

Usar schemas compartibles cuando tenga sentido.

Normalizar datos antes de persistir.

### Cursos y formatos de Fase 2

- Las rutas administrativas de cursos están enumeradas por política; la edición dinámica solo acepta el patrón con UUID y cualquier ruta privada desconocida falla cerrada.
- Cada POST de creación, edición, publicación, retiro o archivo exige origen exacto, usuario interno `ACTIVE` y rol `ADMIN`, incluso después del guard del middleware.
- Los POST de edición con `Accept: application/json` pasan por la misma autorización, validación y revisión optimista que los formularios HTML. Las respuestas de error JSON contienen solo mensajes de dominio y campos, sin detalles de infraestructura ni credenciales.
- `/app/cursos/[id]/grupos` solo admite UUID y `ADMIN`; cada POST comprueba origen y pertenece al curso indicado, no confía en un ID de grupo enviado por el cliente. La persistencia serializa escrituras por curso y rechaza solapamientos incluso bajo concurrencia. La tabla `groups` tiene RLS y no otorga privilegios de Data API a `anon`, `authenticated` ni `service_role`; el servidor usa el repositorio autorizado.
- El cliente no puede enviar un estado editorial arbitrario: cada intención invoca un caso de uso y una transición cerrada.
- El slug se normaliza y asigna en servidor bajo bloqueo transaccional; nunca se acepta durante edición.
- La asignación usa un namespace global estable de advisory lock para que nombres concurrentes con bases solapadas no compitan por el mismo slug.
- Curso y evento de auditoría se escriben transaccionalmente; el formato/revisión se referencia desde el curso. Las revisiones son inmutables y su modificación/eliminación se bloquea en DB mediante un trigger con `search_path` fijado. No existe endpoint `DELETE` de cursos.
- Las ediciones usan `updatedAt` como revisión optimista y fallan con conflicto antes de sobrescribir cambios más recientes.
- Los fallos de infraestructura responden `500` con texto público genérico y emiten únicamente contexto estructurado sanitizado en servidor; no se registran SQL, causas, secretos ni payloads de formulario.
- Los DTO públicos se proyectan de forma explícita y solo consultan `PUBLISHED`; no reutilizan el DTO administrativo. Landing, catálogo y detalle son SSR.
- El destacado singleton se limita a cursos publicados mediante constraint/index DB y lógica de aplicación.
- El contenido Markdown no se inserta como HTML; el parser crea únicamente nodos soportados y filtra esquemas/destinos de enlaces.
- `courses`, `course_types`, `course_type_revisions` y `audit_events` mantienen RLS sin políticas Data API y revocación de privilegios a roles de cliente. El browser no recibe credenciales de base ni service role.
- Las respuestas bajo `/app` siguen usando `Cache-Control: private, no-store`.

## CSRF / XSS / HTML

- No renderizar HTML no confiable.
- Evitar `dangerouslySetInnerHTML`.
- Si se requiere, sanitizar.
- revisar cookies/sesiones según configuración de Auth.
- mantener dependencias actualizadas.

## RATE LIMITING

Evaluar límites para endpoints públicos susceptibles a abuso:

- preinscripción;
- verificación;
- auth callbacks.

No añadir mecanismos complejos hasta que exista una necesidad, pero dejar el punto documentado.

## SECRETS

Prohibido en Git:

- service role keys;
- Google client secret;
- access tokens;
- Vercel token;
- Supabase access token.
- `AUTH_RATE_LIMIT_SECRET`.

Usar GitHub Secrets y variables de entorno.
`AUTH_RATE_LIMIT_SECRET` es server-only, requiere al menos 32 caracteres y no debe comenzar por `PUBLIC_` ni aparecer en logs.

## CI/CD

Los secretos de producción deben estar disponibles únicamente en jobs que realmente los necesitan.

PRs de forks o código no confiable no deben obtener secretos.

## DEPENDENCIAS

Antes de añadir una dependencia:

- comprobar mantenimiento;
- revisar licencia;
- revisar necesidad;
- evitar paquetes redundantes;
- fijar versión cuando sea crítico.

## INCIDENTES

Si un secreto se expone:

1. revocar;
2. rotar;
3. revisar logs;
4. eliminarlo del repositorio e historial si corresponde;
5. documentar la causa;
6. introducir prevención.

## POSTURA DE AUTH PRIVADO IMPLEMENTADA

- Las cookies de sesión se leen y renuevan mediante un cliente Supabase nuevo por request; las cabeceras anti-cache entregadas por `@supabase/ssr` se copian a la respuesta.
- La identidad se valida contra Supabase Auth con `getUser()`. Estado y roles se consultan siempre en las tablas internas mediante una conexión server-side.
- El callback normal de OAuth exige Google y correo verificado; las rutas de autenticación dual también validan método con claims firmados y aprobación de identidad Google del usuario interno. La asociación de identidad Google que Supabase puede hacer automáticamente no equivale a aprobación de acceso.
- Los endpoints mutables de inicio y cierre de sesión son `POST` y verifican el origen esperado.
- Los redirects de retorno se restringen a paths relativos y la allowlist local contiene una URL exacta.
- Los valores de service-role key no se guardan en código/Git ni se entregan al browser. El aprovisionamiento del feature usa el valor configurado en `process.env` solo en un cliente Auth Admin server-side; setup E2E obtiene la key efímera local desde Supabase CLI, la conserva únicamente en el entorno del proceso de prueba y no la imprime.
- `users`, `roles` y `user_roles` tienen RLS sin políticas para Data API y privilegios revocados a `anon`, `authenticated` y `service_role`. Los guards Astro/Drizzle siguen siendo autoritativos porque las conexiones owner/bypass RLS no quedan restringidas por esas políticas.
- Supabase local conserva signup público deshabilitado y añade hook `before_user_created` para aceptar solo invitaciones Google permitidas. La migración 0012 crea la función segura del hook y restringe su ejecución. Las cuentas de email/password se provisionan con Admin API server-side; la configuración Auth cloud de esta feature no está aplicada/verificada.
- Las cookies SSR declaran `HttpOnly`, `SameSite=Lax`, path `/` y `Secure` cuando `PUBLIC_SITE_URL` usa HTTPS.
- Las respuestas de `/app`, `/app/**`, `/login`, `/unauthorized` y `/auth/**` usan `Cache-Control: private, no-store`.
- Toda ruta bajo `/app` requiere una política exacta registrada. Las rutas futuras no declaradas fallan cerradas; los endpoints de operaciones sensibles deben seguir invocando guards propios aunque una página ya esté protegida.

### Idempotencia y recuperación del alta

La clave de idempotencia del curso se vincula en servidor al actor autenticado y al fingerprint de la carga validada; no se acepta identidad de actor del cliente y reutilizar la clave con datos distintos falla. Los metadatos no salen en DTOs. El artwork se asocia después de crear el borrador; ante fallo se ofrece recuperar/reintentar sobre ese borrador. No se sustituye silenciosamente la asociación existente ni se asume una transacción distribuida entre PostgreSQL y Storage. La migración aditiva 0010 no automatiza borrado de historial.

### Contraseñas de cuentas internas (Fase 4 planificada)

Las credenciales pertenecen exclusivamente a Supabase Auth. Crear cuenta y asignar contraseña inicial requiere API privilegiada exclusivamente server-side; no versionar secretos ni retornar/registrar la contraseña después de la respuesta inicial necesaria para entregarla al ADMIN. Nunca persistirla en PostgreSQL, auditarla, incluirla en telemetría, devolverla en cargas de navegación ni repoblar el formulario. Mantener signup público deshabilitado, protección CSRF/origen, cookies seguras, `Cache-Control: private, no-store`, redirects permitidos y rate limiting del proveedor/endpoint. Configurar y comprobar SMTP antes de prometer recuperación por correo en cloud.
