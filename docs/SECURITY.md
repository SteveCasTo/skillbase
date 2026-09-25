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

- solo puede consultar grupos asignados;
- solo puede registrar asistencia en grupos autorizados;
- solo puede gestionar evaluaciones de grupos autorizados.

No confiar únicamente en ocultar botones.

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

Usar GitHub Secrets y variables de entorno.

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
- El callback exige proveedor Google y correo verificado antes de vincular una invitación; los fixtures email/password ya se pre-vinculan y existen solo en tests.
- Los endpoints mutables de inicio y cierre de sesión son `POST` y verifican el origen esperado.
- Los redirects de retorno se restringen a paths relativos y la allowlist local contiene una URL exacta.
- No existe service-role key en código de aplicación o browser. El setup E2E obtiene la key efímera local desde Supabase CLI, la conserva únicamente en el entorno del proceso de prueba y no la imprime.
- `users`, `roles` y `user_roles` tienen RLS sin políticas para Data API y privilegios revocados a `anon`, `authenticated` y `service_role`. Los guards Astro/Drizzle siguen siendo autoritativos porque las conexiones owner/bypass RLS no quedan restringidas por esas políticas.
- Supabase local deshabilita el signup público por email/password. La Admin API continúa disponible exclusivamente para crear fixtures controlados. La configuración cloud debe deshabilitar también signup público por email y cualquier proveedor no previsto antes de habilitar producción.
- Las cookies SSR declaran `HttpOnly`, `SameSite=Lax`, path `/` y `Secure` cuando `PUBLIC_SITE_URL` usa HTTPS.
- Las respuestas de `/app`, `/app/**`, `/login`, `/unauthorized` y `/auth/**` usan `Cache-Control: private, no-store`.
- Toda ruta bajo `/app` requiere una política exacta registrada. Las rutas futuras no declaradas fallan cerradas; los endpoints de operaciones sensibles deben seguir invocando guards propios aunque una página ya esté protegida.
