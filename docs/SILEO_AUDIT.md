# Auditoría de feedback asíncrono — 2026-10-16

Base: `origin/development` `7a19a468747b913913526b8b817720ad22d474bf`.
Esta revisión no es un release ni acredita operaciones en producción.

## Contrato y alcance

- La dependencia real es `sileo@0.1.5`, no Sonner ni otra librería de toast.
  `package.json`, `bun.lock`, `patches/sileo@0.1.5.patch` y los exports instalados
  `dist/index.mjs`/`index.d.mts` son la referencia de esta revisión.
- `src/lib/notifications.ts` conserva UUID por operación, identidad de la promesa,
  valor y rechazo originales, posición inferior derecha y presentación del tema.
  `src/lib/inline-operation-feedback.ts` espera la operación completa y descarta
  loading cuando los errores pertenecen a campos inline. Sus consumidores que
  usan `void` tienen cadenas `catch`/`finally`: no son escrituras sin seguimiento.
- No se instalaron skills. No hay skill local Sileo en las ubicaciones examinadas
  del repositorio (`.agents/skills`, `.opencode/skills`) ni en `~/.agents/skills`.
  Se emplearon las skills locales Astro, Impeccable y Playwright disponibles.
- No se cambian endpoints, autorización, idempotencia, persistencia, bytes
  exportados, hashes, dependencias ni configuración global. No hay sleeps para
  simular progreso: los timers de descarga liberan los Blob URL después del
  traspaso al navegador; los debounces de búsqueda no representan mutaciones.

## Inventario de productores y consumidores

Las rutas de componentes de esta tabla son relativas a `src/components/`.
Se inspeccionaron imports directos de Sileo, `notifications`,
`notifyInlineOperation`, fetch de cliente, submit/download y feedback nativo.

| Superficie                   | Archivos / consumidor                                                                                                                                                                                                                                    | Confirmación y fallo observados en código                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host y fachada               | `SileoHost.tsx`, `src/lib/notifications.ts`, `src/lib/inline-operation-feedback.ts`, `src/styles/notifications.css`, `src/layouts/BaseLayout.astro`                                                                                                      | Un host persistente, tema activo, mismo ID en loading/resultado, sin secuestro de foco. Se conserva el patch accesible existente.                                                                                                                                                             |
| Auth                         | `auth/AuthFormPending.astro`, `auth/OAuthLoginNotice.astro`, `src/pages/login.astro`                                                                                                                                                                     | POST/JSON y resultado autoritativo antes de éxito; errores de campos inline; redirect completo lleva solo feedback transitorio. OAuth notice consume confirmación server-side. No se altera Auth.                                                                                             |
| Formatos                     | `src/pages/app/formatos.astro`, `formatos/nuevo.astro`, `formatos/[id].astro`                                                                                                                                                                            | HTTP, JSON, IDs/revisiones/resultado de creación, edición y lifecycle antes de resolver. Los avisos de navegación consumen indicadores SSR.                                                                                                                                                   |
| Cursos y artwork             | `courses/CourseForm.astro`, `courses/createCourseWithArtwork.ts`, `courses/CourseImageEditor.tsx`, `src/pages/app/cursos.astro`, `cursos/[id]/editar.astro`                                                                                              | Crear → subir → asociar → grupos → navegación son awaited. Fallo parcial conserva borrador/reintento; crop usa versión local y error persistente, no toast de subida ficticia.                                                                                                                |
| Grupos                       | `courses/group-management-client.ts`                                                                                                                                                                                                                     | POST/JSON, revisión y grupo/eliminación confirmados antes del resultado. Locks por grupo, recuperación y versiones evitan sobrescribir ediciones independientes.                                                                                                                              |
| Informes de cursos           | `courses/report-download.ts`                                                                                                                                                                                                                             | Promise incluye HTTP/no redirect, MIME, nombre/extensión, CSV BOM o PDF header/EOF, Blob y traspaso al navegador. Abort antes del traspaso impide éxito tardío.                                                                                                                               |
| Interés público              | `public-courses/PublicInterestForm.tsx`                                                                                                                                                                                                                  | Espera POST/JSON y concordancia HTTP/resultado de negocio. Validación inline; cierre descarta loading; fallo recuperable conserva contacto; éxito persistente sigue visible.                                                                                                                  |
| Interesados ADMIN            | `interests/admin-client.ts` y helpers de filtrado/listado                                                                                                                                                                                                | Cola awaited, respuesta validada por registro/curso y métricas antes de eliminar; conserva recuperación de sesión/errores de fila. Filtros estructurales usan skeleton, no toast de éxito por tecla.                                                                                          |
| Preinscripciones y finanzas  | `pre-registrations/registration-client.ts`, `http-client.ts`                                                                                                                                                                                             | Await submit discriminado y onSuccess/refresco antes de éxito. Clave idempotente se conserva ante resultado incierto; errores de campos no duplican toast. Exportación corregida abajo.                                                                                                       |
| Ajustes de registro          | `pre-registrations/registration-settings-form-client.ts`                                                                                                                                                                                                 | Espera HTTP/JSON/settings; revisión de peers y drafts se mantienen. Conflicto permite recuperar; errores de campo descartan loading.                                                                                                                                                          |
| Lookup y filtros de registro | `pre-registrations/search-client.ts`, `http-client.ts`                                                                                                                                                                                                   | Abort/generación last-request-wins, resultados acotados y error recuperable. No hay éxito artificial de búsqueda.                                                                                                                                                                             |
| Instructores                 | `instructors/InstructorForm.astro`, `InstructorLifecyclePanel.astro`, `inline-profile-client.ts`                                                                                                                                                         | HTTP/JSON/destino o revisión/valores confirmados antes de éxito. Password se limpia al fallar; revisiones y valores de otros editores se conservan.                                                                                                                                           |
| Cuentas ADMIN                | `admin-accounts/request.ts`, `create-client.ts`, `name-client.ts`, `AdminAccountLifecycle.tsx`                                                                                                                                                           | Submit awaited, payload discriminado, cuenta y actor activo deciden éxito/navegación. Cierre de acceso propio usa redirect autorizado, no éxito inventado desde un botón.                                                                                                                     |
| Asistencia                   | `attendance/client.ts`, `GroupParticipantsPage.astro`                                                                                                                                                                                                    | POST/resultado y refresh awaited, draft y requestKey conservados. Búsqueda de roster cancela solicitudes obsoletas. Fallo de refresco tras escritura confirmada corregido abajo.                                                                                                              |
| Evaluaciones                 | `evaluations/client.ts`, `SchemeEditor.tsx`, `GradeRow.tsx` y workspace consumidor                                                                                                                                                                       | Await save y refresh; fila confirmada puede reconciliarse con su acknowledgement aunque falle lectura auxiliar. Fallos/validaciones no resuelven como éxito.                                                                                                                                  |
| Cierre académico             | `academic-closure/ClosureActions.tsx`, `ClosurePage.astro`, `DownloadFeedback.astro`                                                                                                                                                                     | Navegación POST awaited e indicador SSR de resultado; motivo inválido conserva foco/error inline. Descarga promise corregida abajo.                                                                                                                                                           |
| Certificados (otro owner)    | `certificates/FormFeedback.astro`, `CertificateDetailPage.astro`, `SignedPdfUpload.astro`, `LocalFileVerification.astro`, `RevokeCertificate.tsx`, `CertificatePreview.tsx`, `settings-field-client.ts`, `download-pdf.ts`, página pública de credencial | Inventariados, sin modificar sus archivos: guardado/sustitución PDF y verificación local pertenecen al worker de certificados. Preview cancela y libera Blob; downloads usan el helper existente con HTTP/MIME/header/EOF. La rama certificada del consumidor compartido conserva ese helper. |

No se encontraron llamadas a `window.alert`, `window.confirm`, `window.prompt`
ni equivalentes globales en la UI; `confirm` en interesados es una función local
que abre la confirmación del sistema, no la API nativa.

## Defectos corregidos

1. **Loading huérfano si una fábrica lanza sin devolver promesa.** Sileo 0.1.5
   crea loading y después invoca la fábrica fuera de su cadena de rechazo.
   La fachada ahora actualiza ese mismo ID a error y vuelve a lanzar el mismo
   objeto sin convertir el throw síncrono en resolución o modificar promesas.
2. **Éxito falso en exportación de preinscripciones.** Antes bastaban HTTP 200 y
   un filename, incluso con cuerpo vacío/HTML/truncado. Ahora se esperan todos
   los bytes y se verifican MIME/extensión, BOM CSV o header/EOF PDF y tamaño.
   Navegar cancela la lectura y descarta su loading sin éxito/error tardío;
   los fallos no borran errores persistentes de otra operación de página.
3. **Éxito falso en documentos de cierre.** PDF reutiliza el helper existente
   `downloadCertificatePdf` (su validación es de documento, no de negocio);
   CSV exige MIME/extensión/BOM y cuerpo no vacío. Ambos esperan bytes y
   comprobación de abort antes de crear la descarga. Se conserva el mismo
   promise toast y el href HTML sin JavaScript.
4. **Dos toasts tras escritura de asistencia confirmada y refresh fallido.**
   La escritura mantiene su único éxito; la necesidad de recuperar la vista
   permanece en el error de página existente con su enlace de reintento.
   Un fallo de lectura ya no genera además un warning independiente que compita.

La confirmación de descarga significa bytes comprobados y entregados al
navegador, no que el usuario haya guardado el archivo en disco. La comprobación
de firma de contenedor PDF/BOM CSV no sustituye un parser completo ni una firma
digital institucional; no se cambia el contrato server-side de documentos.

## Evidencia y límites

Se actualizan únicamente casos existentes, sin añadir specs, suites ni casos:

- `tests/unit/notifications.test.ts`: throw síncrono preservado, loading/error
  con mismo ID; sigue verificando identidad, valor y rechazo de promesas.
- `tests/e2e/registrations.spec.ts`: respuestas retenidas verifican loading
  real, mismo ID al error, cero descargas para CSV vacío/HTML y PDF truncado,
  controles restaurados y descarga real de CSV/PDF después del fallo.
- `tests/e2e/academic-closure.spec.ts`: PDF truncado/CSV vacío no descargan ni
  anuncian éxito; los documentos reales mantienen hash browser/disco, contenido,
  privacidad, headers y fallback sin JavaScript del escenario existente.
- `tests/e2e/attendance.spec.ts`: POST real y GET de fragmento fallido muestran
  un éxito de la operación y recuperación persistente, sin warning duplicado;
  el reintento real recupera revisión/estado y limpia el mensaje de página.

Los resultados ejecutados, SHA y CI se registran en el PR correspondiente;
la existencia de estas assertions no equivale por sí sola a PASS. La auditoría
de código no acredita screen reader manual, OAuth Google real, SMTP, disco del
usuario, firma criptográfica ni operaciones canónicas/cloud. Accesibilidad y
metadatos compartidos permanecen con su owner independiente.
