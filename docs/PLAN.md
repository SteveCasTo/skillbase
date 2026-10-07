# PLAN

## OBJETIVO

Definir un plan incremental de implementación que permita entregar avances demostrables al docente y reduzca el riesgo técnico.

Este documento debe actualizarse cuando cambie el alcance, el orden de prioridades o aparezcan dependencias nuevas.

## CRITERIOS DE PRIORIZACIÓN

El orden de implementación se determina combinando:

1. Dependencias técnicas.
2. Valor funcional demostrable.
3. Riesgo.
4. Importancia académica.
5. Capacidad de validar tempranamente reglas de negocio.
6. Capacidad de recibir retroalimentación del docente.

No priorizar únicamente por facilidad de programación.

## FASE 0 — FOUNDATION

### Objetivos

- [x] Crear y publicar repositorio.
- [x] Configurar ramas `master` y `development`.
- [x] Crear Astro + React.
- [x] Configurar Bun.
- [x] Configurar Tailwind.
- [x] Configurar shadcn/ui.
- [x] Incorporar design tokens.
- [x] Incorporar Sileo.
- [x] Configurar Supabase local.
- [x] Configurar Drizzle sin entidades de negocio anticipadas.
- [x] Configurar lint, format y typecheck.
- [x] Configurar Playwright con Chromium.
- [x] Configurar scripts de `package.json`.
- [x] Configurar GitHub Actions para `master`.
- [x] Configurar Vercel CLI y adapter.
- [x] Crear documentación base.

### Resultado demostrable

Aplicación ejecutable de forma reproducible en cualquier equipo del grupo.

### Estado

La implementación técnica se completa siguiendo este checklist, sin avanzar sobre Auth ni módulos funcionales:

1. Preparar exclusiones e inicializar Git en `master` sin eliminar archivos locales.
2. Inicializar Astro full-stack, React, Tailwind y TypeScript estricto en la raíz.
3. Configurar shadcn/ui, tokens, fuentes, temas y Sileo.
4. Configurar Supabase local con servicios mínimos y entorno reproducible.
5. Configurar Drizzle y una estrategia única de migraciones.
6. Incorporar lint, format, typecheck, unit, integration y E2E.
7. Exponer las operaciones habituales mediante scripts de `package.json`.
8. Ejecutar CI exclusivamente para pushes y pull requests de `master`.
9. Documentar setup, testing, migraciones y preparación de Vercel.
10. Verificar todo localmente, publicar `master` y crear `development` desde esa base.

Foundation queda completa cuando este checklist, CI y ambas ramas están publicados y verificados.

## FASE 1 — AUTH Y ESTRUCTURA PRIVADA

### Objetivos

- Implementar Supabase Auth.
- Implementar Google OAuth.
- Gestionar sesión.
- Modelar usuario interno.
- Implementar roles.
- Crear layout privado.
- Proteger rutas.
- Implementar navegación base.

### Resultado demostrable

Administrador e instructor pueden autenticarse y acceder únicamente a las zonas correspondientes.

### Checklist de implementación

- [x] Añadir los clientes oficiales de Supabase para Auth SSR con versiones fijadas.
- [x] Configurar variables públicas y privadas separadas para local, CI y cloud.
- [x] Modelar usuarios internos preaprovisionados con estados `INVITED`, `ACTIVE` y `DISABLED`.
- [x] Modelar roles `ADMIN` e `INSTRUCTOR` como una relación multirol.
- [x] Vincular una invitación interna con una identidad Google únicamente después de autenticar un correo verificado coincidente.
- [x] Crear y verificar la migración Drizzle, restricciones, índices, privilegios y RLS correspondientes.
- [x] Implementar clientes Supabase por request, renovación de cookies y contexto de autenticación en middleware.
- [x] Implementar inicio de sesión Google mediante OAuth PKCE y callback con redirects validados.
- [x] Implementar logout limitado a la sesión del navegador actual.
- [x] Rechazar explícitamente identidades sin invitación, usuarios deshabilitados y usuarios sin permisos.
- [x] Crear guards server-side reutilizables para sesión, estado y roles.
- [x] Crear login, layout privado y navegación responsive accesible según permisos.
- [x] Crear rutas privadas representativas para administración e instructores.
- [x] Crear fixtures locales deterministas que no dependan de la interfaz de Google.
- [x] Cubrir autenticación, sesión, logout, redirects y autorización con pruebas unitarias, de integración y E2E.
- [x] Enlazar y verificar el proyecto dedicado de Supabase Cloud.
- [x] Configurar Google OAuth local y cloud sin versionar secretos.
- [x] Preaprovisionar el primer administrador cloud mediante su correo autorizado.
- [x] Crear y configurar el proyecto Vercel con `master` como rama de producción.
- [x] Ejecutar migraciones y despliegue de producción únicamente después de superar los checks de CI.
- [x] Actualizar documentación de arquitectura, datos, Auth, seguridad, testing y despliegue.

### Decisiones de alcance

- Google OAuth es el mecanismo visible de acceso; email/password solo podría utilizarse en fixtures automatizados locales. Los fixtures actuales usan sesiones de un solo uso generadas por Admin API porque el proveedor público de email está deshabilitado.
- Una identidad autenticada no obtiene acceso por defecto. Debe existir una invitación interna previa y activa.
- Un usuario puede tener simultáneamente los roles `ADMIN` e `INSTRUCTOR`.
- El rol y el estado se consultan desde la base interna, no desde metadata editable ni desde el dominio del correo.
- Las rutas y operaciones privadas validan autorización en servidor; la navegación filtrada no constituye un control de acceso.
- Supabase Cloud y Vercel se configuran en esta fase, pero ningún secreto se almacena en Git.

### Estado

Fase 1 completada y verificada en local, CI y cloud. El primer administrador puede autenticarse con Google y acceder a `/app`; las identidades no preaprovisionadas, deshabilitadas o sin roles quedan rechazadas en servidor.

## FASE 2 — CURSOS Y EXPERIENCIA PÚBLICA

La fase se divide en dos entregas consecutivas. La capa visual de la landing se puede validar de forma aislada sobre el contrato público actual y previews sintéticos, pero el catálogo, el detalle y el cierre completo de Fase 2B siguen bloqueados hasta cerrar y verificar completamente el gate de Fase 2A.

### Decisiones de alcance

- Las fechas y el horario del curso son información pública provisional; los grupos definirán después su calendario operativo definitivo.
- La publicación editorial se modela por separado de la disponibilidad para preinscripción.
- La disponibilidad para preinscripción se deriva de su ventana de fechas y no constituye un estado editorial.
- Fase 2A configura únicamente la nota mínima de aprobación. El porcentaje de asistencia se pospone hasta confirmar la regla académica.
- Los cursos no se eliminan físicamente desde la interfaz: pueden retirarse o archivarse.
- El alcance original de Fase 2 no implementaba participantes, preinscripciones, grupos, inscripciones, descuentos aplicados, pagos, sesiones ni elegibilidad académica. La gestión de grupos se anticipó y quedó implementada parcialmente dentro del alcance que el plan ubicaba originalmente en Fase 4; no implica que Fase 3 esté implementada.

### FASE 2A — GESTIÓN DE CURSOS

#### Objetivo

Implementar un módulo administrativo de cursos sólido, seguro y capaz de alimentar posteriormente la experiencia pública.

#### Checklist de definición

- [x] Confirmar campos obligatorios y opcionales del curso.
- [x] Definir los estados editoriales `DRAFT`, `PUBLISHED` y `ARCHIVED`.
- [x] Definir las transiciones válidas de publicación, retiro y archivado.
- [x] Definir la política de generación, unicidad y estabilidad del slug.
- [x] Definir qué campos pueden modificarse después de publicar.
- [x] Definir precios por tipo de participante y mantener la moneda explícita.
- [x] Documentar casos válidos, inválidos y estados de borde antes de generar la migración.

#### Checklist de dominio y datos

- [x] Crear tipos de dominio para nivel básico, medio y avanzado.
- [x] Implementar reglas y transiciones del estado editorial.
- [x] Validar nombre, descripción, condiciones y horario informativo.
- [x] Validar duración positiva y fechas públicas coherentes.
- [x] Validar que la ventana de preinscripción sea coherente.
- [x] Validar la nota mínima en el rango permitido sin calcular todavía resultados académicos.
- [x] Normalizar y validar el slug.
- [x] Validar montos no negativos y precisión monetaria.
- [x] Diferenciar errores de dominio, aplicación e infraestructura.
- [x] Añadir `courses`, `course_prices` y las restricciones necesarias al schema Drizzle.
- [x] Añadir unicidad de slug y de precio por curso y tipo de participante.
- [x] Añadir checks para duración, nota, fechas y montos.
- [x] Usar timestamps con zona horaria e índices para las consultas administrativas y públicas.
- [x] Revisar RLS y revocar privilegios Data API que no sean necesarios.
- [x] Generar y verificar una migración Drizzle reproducible desde una base vacía.
- [x] No crear anticipadamente tablas pertenecientes a las fases 3 a 5.

#### Checklist de aplicación y persistencia

- [x] Implementar el repositorio de cursos sin acoplarlo a HTTP ni a componentes UI.
- [x] Implementar creación y edición transaccional de curso y precios.
- [x] Implementar consulta y listado administrativo.
- [x] Implementar publicación, retiro y archivado mediante transiciones válidas.
- [x] Implementar las lecturas de repositorio para listado y consulta pública de cursos publicados (sin rutas HTTP públicas en Fase 2A).
- [x] Separar los DTO administrativos de los DTO públicos.
- [x] Garantizar que borradores, retirados y archivados no aparezcan en consultas públicas.
- [x] Autorizar todas las escrituras exclusivamente para `ADMIN` en servidor.
- [x] Registrar trazabilidad para creación, edición sensible, cambios de precio, publicación, retiro y archivado.

#### Checklist de interfaz administrativa

- [x] Sustituir el placeholder de `/app/cursos` por un listado administrativo responsive.
- [x] Crear una página dedicada para registrar cursos.
- [x] Crear una página dedicada para editar cursos.
- [x] Incorporar formularios para información general, fechas, horario, precios y nota mínima.
- [x] Incorporar acciones de publicar, retirar y archivar con confirmaciones de alcance limitado.
- [x] Registrar cada ruta nueva en la política privada fail-closed.
- [x] Validar entradas y permisos nuevamente en cada acción server-side.
- [x] Mostrar labels, ayuda contextual y errores junto a los campos.
- [x] Conservar valores después de errores recuperables y prevenir envíos duplicados.
- [x] Diseñar estados loading, empty, success, error y disabled.
- [x] Reutilizar el design system y validar mobile, tablet, desktop y navegación por teclado.

#### Checklist de pruebas y documentación

- [x] Crear fixtures mínimos para borrador, publicado, archivado y distintas ventanas de preinscripción.
- [x] Cubrir niveles, estados, transiciones, slug, fechas, nota y precios con pruebas unitarias.
- [x] Cubrir migraciones, constraints, repositorio, transacciones y consultas públicas con pruebas de integración.
- [x] Cubrir creación, validación, edición, publicación, retiro, archivado y denegación a instructor con E2E.
- [x] Verificar que ninguna consulta pública exponga borradores o campos administrativos.
- [x] Actualizar arquitectura, modelo de datos, requisitos, seguridad y testing cuando las decisiones se implementen.

#### Gate obligatorio para Fase 2B

- [x] CRUD administrativo y transiciones editoriales completos.
- [x] Precios, fechas, horario y nota mínima persistidos y validados.
- [x] Migración reproducible y restricciones PostgreSQL verificadas.
- [x] Contrato de lectura pública estable y sin exposición de borradores o datos internos.
- [x] Autorización `ADMIN`, validación server-side y trazabilidad verificadas.
- [x] Pruebas unitarias, de integración y E2E completas.
- [x] Formatter y lint verificados.
- [x] Typecheck y build locales exitosos.
- [x] Advisors locales de Supabase ejecutados correctamente.
- [x] CI remoto ejecutado y exitoso.
- [x] Documentación sincronizada y revisión de cierre de Fase 2A completada.

#### Resultado demostrable 2A

Un administrador crea, edita, configura, publica, retira y archiva cursos. Los cursos publicados quedan disponibles mediante el contrato seguro de DTO/repositorio público, mientras los demás estados permanecen ocultos. Fase 2A todavía no expone rutas HTTP de catálogo o detalle.

#### Estado 2A

El estado previo del repositorio registraba el alcance original de gestión de cursos como completado. Esta revisión no revalida ese cierre histórico ni verifica un nuevo despliegue en Supabase/Vercel o un nuevo resultado de CI. El refactor de formatos y revisiones, que antes estaba pendiente, ya está implementado localmente; el cierre del gate ampliado de Fase 2B sigue pendiente de validación final.

#### Refactor implementado — gate previo al cierre de Fase 2B

La implementación original guardaba `totalHours` y precios directamente por curso. El refactor aprobado de ADR-016 ya está implementado mediante formatos y revisiones; el cierre del gate todavía requiere validación final.

- [x] Modelar Tipos de curso/formatos administrados, con activación y desactivación.
- [x] Modelar revisiones inmutables con duración y precios `STUDENT`/`EXTERNAL` en `BOB`.
- [x] Hacer obligatorio que cada curso seleccione una revisión y eliminar los overrides directos de horas y precios.
- [x] Aplicar la revisión vigente a cursos borrador y preservar la revisión exacta en cursos publicados y archivados.
- [x] Migrar el modelo directo preservando las tuplas históricas de duración y precios; adaptar contratos y trazabilidad.
- [x] Incorporar la fotografía opcional con upload/storage administrativo, conservando el fallback gráfico de Cota Activa.
- [ ] Ejecutar la revisión de cierre del gate y actualizar la documentación con el estado real.

#### Avance de experiencia privada (fix/private-app-feedback)

La implementación local cubre skeleton SSR vinculado a carga real y viewport visible, con conservación de foco, cancelación, errores y movimiento reducido. El selector de tema queda oculto en el rail colapsado; tema y preferencia toleran almacenamiento no disponible. La inicialización evita discrepancias de hidratación. Los productores administrativos usan `src/lib/notifications.ts`, con UUID independiente por operación y el mismo ID entre loading/success/error. JavaScript permanece habilitado como mejora progresiva; los tests sin JavaScript verifican fallbacks HTML, y las animaciones del sidebar se mantienen.

Grupos y formatos actualizan localmente con bloqueo contra acciones duplicadas y conservan foco/datos para recuperación. El alta admite `requestKey` UUID persistente por actor/fingerprint: repetir la solicitud devuelve el curso creado y cambiar los datos con la misma clave se rechaza. La carga de artwork permite recuperar el borrador sin sobrescritura silenciosa. El bloqueo de fila del repositorio protege las ediciones; fixtures históricos sin revisión opcional conservan compatibilidad. Migración 0010 añade metadatos a `courses`, sin limpieza automática de historial.

Validación local registrada para el bloque privado (histórica): unit 108 PASS; integration 54 PASS; lint/typecheck/build y checks de schema/formatter PASS. E2E: rerun 81/82 y revalidación dirigida `public-courses` 4/4; no se afirma una corrida completa 82/82. PR 104 se integró en `development` como `6fc81da`. La migración 0010 se aplicó a la base Supabase local estándar en `127.0.0.1:54322` mediante migración sin reset, preservando datos; no se aplicó a cloud. El gate remoto/cloud histórico de Fase 2 no cambia.

#### Alcance acordado para completar 2B (2026-09-24)

Estas decisiones precisan el alcance acordado. El estado actualizado distingue implementación disponible de cierre/verificación del gate.

- [x] Mantener la consulta SSR de cursos publicados en cada visita/recarga. No se requiere actualización en tiempo real ni SPA; `?preview=courses` sigue siendo contenido sintético.
- [x] Administrar **Formatos** reutilizables con revisiones inmutables y migrar cursos preservando las tuplas históricas. El seed local agrega formatos de 20 h (80/100 Bs) y 30 h (120/150 Bs), editables y solo como defaults de desarrollo.
- [x] Sustituir duración/precios individuales del formulario por selección de formato, mantener nivel separado, calendario shadcn para seleccionar fechas y validación inmediata de montos; preservar formularios Astro SSR/POST y validación server-side.
- [x] Añadir contenido Markdown, nombre de instructor y un constructor de horario por días/horas que conserva el campo histórico como texto; no se introdujo un calendario operativo estructurado.
- [x] Permitir designar un curso publicado destacado, con selección singleton y fallback determinista cuando no se designa uno.
- [x] Añadir picker/arrastre, vista previa y recorte de foto autorizada, validación server-side y almacenamiento; conservar fallback Cota Activa.
- [x] Completar catálogo `/cursos` y detalle `/cursos/[slug]` con información pública; tarjetas no exponen precios/horario detallados y cursos no públicos comparten 404 con slugs inexistentes.
- [x] Verificar el flujo completo en local con migraciones, tests unitarios, integración y E2E (42 escenarios), responsive, teclado, formatter de archivos propios, lint, typecheck, build y advisors de Supabase sin avisos; documentación afectada revisada. CI remoto y cloud permanecen pendientes.

El 50 % de descuento de auxiliares es una regla conocida, pero su elegibilidad y aplicación corresponden a inscripción/descuentos de fases posteriores; no se publica automáticamente un tercer precio ni se promete un beneficio sin validar condiciones.

### FASE 2B — LANDING, CATÁLOGO Y DETALLE PÚBLICO

#### Objetivo

Construir una experiencia pública distintiva que presente la propuesta del sistema y convierta los cursos publicados en información oficial, vigente y accesible.

#### Checklist de dirección visual

- [x] Confirmar que el gate de Fase 2A está completamente cerrado.
- [x] Cargar la skill `frontend-design` antes de proponer la interfaz.
- [x] Elaborar un brief con audiencia, objetivo, contenido real, tono y jerarquía.
- [x] Proponer una dirección visual con color, tipografía, layout y principios específicos del contexto educativo.
- [x] Preparar wireframes mobile y desktop y alinear la propuesta con los tokens existentes.
- [x] Mantener el branding provisional centralizado y fácil de sustituir.
- [x] Revisar la propuesta contra patrones genéricos antes de escribir código.
- [x] Presentar y validar la dirección visual antes de implementarla.

#### Checklist de landing

- [x] Evolucionar `/` desde Foundation hacia la fuente pública oficial de información vigente.
- [x] Comunicar formación continua, cursos vigentes y propósito del sistema sin prometer módulos inexistentes.
- [x] En la cartelera de landing, mostrar disponibilidad, título, descripción breve, inicio/fecha, nivel y duración; reservar horario exacto, condiciones y precios diferenciados para el futuro detalle público.
- [x] Incorporar acceso principal a la oferta y mantener visible el acceso del equipo.
- [x] Mostrar cursos publicados destacados sin inventar cifras, testimonios ni contenido institucional.
- [x] Diseñar estados de oferta vacía y error con un mensaje comprensible.

#### Checklist de catálogo y detalle

- [x] Crear `/cursos` consumiendo el contrato público y renderizando SSR.
- [x] Mostrar únicamente cursos publicados con el resumen público aprobado y sin exponer en las tarjetas los dos precios detallados ni el horario detallado.
- [x] Indicar si la ventana de preinscripción está próxima, abierta o cerrada.
- [x] Mantener URLs estables mediante slug y evitar filtros sin una necesidad demostrada.
- [x] Crear `/cursos/[slug]` con descripción, condiciones y disponibilidad completas.
- [x] Responder 404 de la misma forma ante slug inexistente y curso no público.
- [x] No implementar el formulario de preinscripción de Fase 3 ni presentar un CTA engañoso.
- [x] Renderizar Markdown mediante nodos permitidos y filtrar destinos de enlaces, sin insertar HTML crudo.

#### Checklist de revisión visual y calidad

- [x] Cargar la skill `playwright-cli` y revisar screenshots en mobile, tablet y desktop.
- [x] Revisar light, dark y system, incluido el flash inicial del tema.
- [x] Comparar la implementación con el brief y realizar una autocrítica visual.
- [x] Corregir jerarquía, densidad, ritmo y cualquier patrón visual genérico.
- [x] Verificar teclado, foco, contraste, zoom, objetivos táctiles y landmarks.
- [x] Verificar `prefers-reduced-motion` y ausencia de scroll horizontal.
- [x] Cargar `web-design-guidelines` para la auditoría final de UI.
- [x] Repetir screenshots y pruebas después de las correcciones.

La dirección **Cartelera editorial** fue seleccionada el 2026-09-18 mediante una comparación visual con Catálogo visual modular y Agenda de convocatorias. La landing conserva la composición responsive y sus previews sintéticos. El refactor de formatos y el upload/storage administrativo de artwork ya están implementados; el cierre del gate funcional y su verificación remota siguen pendientes.

#### Estado actual de la cartelera

- [x] Renderizar el curso destacado y los afiches secundarios desde el DTO público, con estado, fecha, nivel y duración.
- [x] Resolver artwork local para previews sintéticos y fallback gráfico Cota Activa cuando un curso no tiene artwork.
- [x] Admitir `?preview=courses&count=` con una muestra de 1 a 20 cursos sintéticos para revisar la composición.
- [x] Verificar enlaces de tarjeta completa, orden de filas, ausencia de overflow, foco, temas claro/oscuro y paleta warm en E2E.
- [x] Verificar la regresión de 20 cursos, incluyendo anchos de afiche mobile y tablet.
- [x] Respetar `prefers-reduced-motion` en la composición y sus transiciones decorativas.
- [x] Incorporar picker y flujo administrativo de imagen propia autorizada con almacenamiento real.
- [x] Completar el refactor de Tipos de curso y revisiones inmutables.

#### Checklist de pruebas y cierre

- [x] Implementar acceso público sin sesión, navegación a cursos publicados, ocultación de otros estados y 404 uniforme.
- [x] Añadir cobertura E2E de catálogo/detalle, estados públicos y regresiones responsive/teclado.
- [x] Implementar títulos, metadata y proyección de contenido público.
- [x] Ejecutar y verificar el conjunto local de lint, typecheck, unit (41), integration (15), E2E (42) y build; los archivos propios pasan Prettier. El comando global de formatter incluye `.tmp-phase2b/` ajena a este cambio y sigue avisando por sus archivos sin seguimiento.
- [ ] Verificar CI remoto, despliegue/migraciones de cloud y realizar la revisión final del gate de Fase 2B.
- [x] Sincronizar documentación de implementación; la revisión final del gate sigue pendiente.

#### Navegación privada

- [x] Rediseñar el sidebar con secciones con iconos y subsecciones para Cursos y Formatos, sin buscador.
- [x] Incorporar colapso a rail y expansión temporal superpuesta mediante hover/foco, con soporte de teclado/táctil y respeto de `prefers-reduced-motion`.
- [x] Separar scroll del sidebar y contenido y mantener navegación móvil/foco mediante menú; la preferencia de colapso se persiste en `localStorage`.

#### Resultado demostrable 2B

La landing presenta el sistema, el catálogo muestra automáticamente los cursos publicados y cada curso dispone de un detalle público vigente, responsive y accesible.

### Resultado demostrable de Fase 2

Administración crea y publica un curso; este aparece automáticamente en una experiencia pública completa sin exponer borradores ni información administrativa.

## GATE PREVIO A FASE 3 - EXPERIENCIA PRIVADA

La experiencia privada existente está implementada y validada localmente. PR 104 se integró en `development` como `6fc81da`; esta integración no altera los gates remotos/cloud históricos de Fase 2. En ese momento Fase 3 aún no se había iniciado; su implementación y release posteriores están registrados en su sección correspondiente.

- [x] Incorporar skeletons reales durante las cargas estructurales de `/app`, vinculados al estado de carga y no a una demora decorativa.
- [x] Usar Sileo para feedback transitorio de mutaciones, con estados pending, success y error, sin sustituir errores junto a campos.
- [x] Actualizar el contenido afectado sin recarga completa, conservando foco y valores.
- [x] Cerrar confirmaciones al aceptar; la request continúa con feedback independiente.
- [x] Prevenir acciones duplicadas y permitir recuperar errores/reintentar sin perder datos.
- [x] Ubicar el toggle de tema en el sidebar expandido y menú móvil, oculto al cerrar el rail.
- [x] Verificar responsive y teclado mediante cobertura E2E colectiva: full rerun 81/82 más prueba dirigida 4/4 de `public-courses`; no se afirma full 82/82.
- [x] Completar implementación, validación local e integración de PR 104 a `development`; no implica promoción a `master`, gates remotos/cloud ni cierre de Fase 3.

Los pendientes remotos de Fase 2 (CI, despliegue/migraciones cloud y revisión final del gate de Fase 2B) siguen pendientes según su registro anterior. Este avance no los revalida ni declara cerrado ese gate.

## FASE 3 — REGISTRO DE INTERESADOS (SIN PAGO)

### Objetivos

- Formulario público de registro de interesados en el detalle del curso.
- Validaciones.
- Prevención razonable de duplicados.
- Listado administrativo.
- Métricas de demanda.
- Estados `ACTIVE`/`CANCELLED`, con cancelación/reactivación administrativa y métricas de activos aprobados (ADR-021); implementados en esta fase.

### Checklist de definición y contratos

- [x] Confirmar el alcance de Fase 3 como registro de **interesados**, no preinscripción pagada ni inscripción definitiva. Las reglas aprobadas están en `docs/REQUIREMENTS.md`.
- [x] Confirmar campos y elegibilidad: nombre, apellidos y email obligatorios; teléfono y preferencia de grupo opcionales. Público limitado al detalle de curso existente; no añadir ni cambiar información de la landing.
- [x] Confirmar duplicados y disponibilidad: una solicitud por curso/email normalizado; validación autoritativa server-side y sin aceptar para cursos retirados/archivados. Se puede solicitar desde `PUBLISHED` hasta cierre presencial si existe ventana, o hasta el inicio oficial si no existe.
- [x] Confirmar estados `ACTIVE`/`CANCELLED`, cancelación/reactivación administrativa conservando historial y métricas de activos por curso/preferencia; la preferencia no es asignación de grupo ni dato de plazas (ADR-021).
- [x] Definir el contrato técnico de Fase 3 para entrada/salida, errores, DTO, operaciones, persistencia y pruebas en [`docs/INTEREST_REGISTRATION_CONTRACT.md`](INTEREST_REGISTRATION_CONTRACT.md). Contrato aprobado no significa implementación realizada.

### Checklist de datos, dominio y persistencia

- [x] Implementar el registro de interesado como entidad autónoma, separada de `Participant` y de la preinscripción presencial; no usar email público no verificado para modificar identidad global ni crear entidades pagadas en Fase 3.
- [ ] La relación explícita y trazable entre el interesado y una preinscripción presencial es dependencia de Fase 5; no bloquea el cierre de Fase 3. Allí se implementará junto al prellenado editable; el registro presencial directo seguirá disponible.
- [x] Especificar e implementar relaciones, restricciones e índices del agregado autónomo; el detalle permanece en el contrato técnico.
- [x] Implementar validaciones y reglas de dominio independientes de HTTP/UI; las pruebas unitarias específicas del backend pasan 9/9.
- [x] Implementar casos de uso y repositorio con escrituras transaccionales y prevención de duplicados; las pruebas de integración dirigidas pasan 11/11.
- [x] Versionar la migración reproducible, constraints e índices; la integración completa pasó y la migración 0011 se aplicó idempotentemente al Supabase local estándar. Cloud permanece pendiente.

### Checklist de interfaz pública

- [x] Implementar el formulario público únicamente en el detalle del curso y el acceso desde la oferta elegible.
- [x] Implementar estados del formulario, errores junto a los campos, conservación de valores y prevención de dobles envíos; la validación autoritativa permanece en servidor.
- [x] Implementar feedback persistente de éxito/error y feedback transitorio; no se presenta el interesado como inscripción ni reserva.
- [x] Completar verificación responsive, teclado y foco con E2E completo más revalidaciones dirigidas; no se afirma una única corrida full 95/95.

### Checklist de administración y métricas

- [x] Implementar listado/resumen administrativo y operaciones de estado bajo autorización `ADMIN`.
- [x] Implementar métricas persistidas de interesados activos por curso y preferencia, sin equiparar preferencia con asignación ni plazas/cupos.
- [x] Mostrar estados administrativos vacíos/error; los datos personales se mantienen en las vistas privadas autorizadas.
- [x] Aplicar el patrón de mutaciones del gate previo: confirmación, feedback independiente y recuperación de errores.

### Checklist de seguridad, pruebas y documentación

- [x] Implementar permisos server-side para operaciones administrativas y validación de entradas públicas.
- [x] Implementar minimización de datos, errores públicos sanitizados, límite de body y rate limiter persistente atómico; la suite backend dirigida está verde.
- [x] Configurar presencia de `INTEREST_RATE_LIMIT_SECRET` server-only en Vercel Production/Preview y verificar estáticamente `Astro.clientAddress` mediante la cadena oficial Astro/Vercel. El valor no se registra.
- [x] Verificar POST público en runtime y que valores falsificados de `X-Forwarded-For` no alteran los buckets de red/curso; el detalle de smoke y límites de la prueba se registra abajo. No se hizo stress para forzar 429 ni se verificó el HMAC de una IP real.
- [ ] Definir como seguimiento de gobierno de datos la política de conservación/anonimización y su plazo. La propuesta de 12 meses sigue sin aprobar; no hay borrado automático y este pendiente no bloquea el cierre técnico de Fase 3 ni la planificación de desarrollo de Fase 4.
- [x] Crear fixtures sintéticos y deterministas; unit e integración locales completos PASS.
- [x] Añadir E2E público/administrativo para disponibilidad, duplicados, recuperación, permisos y accesibilidad; cobertura validada por corrida full y revalidaciones dirigidas descritas en `docs/TESTING.md`.
- [x] Actualizar los documentos afectados al estado real; la política de retención/anónimización permanece pendiente.

### Checklist de PR y gate de cierre

- [x] Resolver los hallazgos encontrados durante la validación del bloque; la corrección del cleanup de fixtures de cursos se hizo explícita y sin `CASCADE`.
- [x] Integrar PR 105 a `development` (merge `0bf0979`, 2026-10-01). No implica promoción a `master`.
- [x] Ejecutar formatter, lint, typecheck, unitarias, integración, E2E y build locales correspondientes; la cobertura E2E se compone de la corrida full 81/95 y las suites dirigidas, no de una corrida full 95/95.
- [x] Registrar el estado real local/cloud y evidencia de release en `docs/TESTING.md`/`docs/DEPLOYMENT.md`.
- [x] Completar implementación, validación local y release de Fase 3 en producción. No implica una revisión manual ADMIN en producción ni cierra la política de retención propuesta, que sigue pendiente.

### Cierre de Fase 3: validación local y producción

La implementación de Fase 3 y su validación local están completas. Full unit 129 PASS (793 assertions); full integration 65 PASS/0 FAIL (478 assertions, 9 archivos), después de corregir el cleanup de fixtures para incluir la tabla de interesados explícitamente, sin `CASCADE`; lint global PASS; typecheck PASS con 0 errores/0 warnings/70 hints; build y Drizzle checks PASS. E2E: corrida full 81/95 PASS, 14 fallos por fixtures de calendarios de cursos (12 respuestas 422) y carga de formatos (2). Después, sin cambios de código de producción, `courses` dirigido 2/2 PASS (47.9 s) y `interests` dirigido 13/13 PASS (1.1 min); las suites se solapan en un escenario de Auth. La evidencia combinada cubre los 95 escenarios mediante la corrida full y revalidaciones dirigidas; no se afirma un full run 95/95. Fallback sin JavaScript y navegación/animación mobile comprobados PASS.

La migración 0011 se aplicó de forma idempotente al Supabase local estándar `127.0.0.1:54322` sin reset; el rerun verificó el checksum `377bb93ab34a1e9745ff69823ee065f11183b7db7f5881337dedd99e9dfa72b6` y el ledger avanzó de 11 a 12. Ambas tablas nuevas tienen RLS. Antes/después se conservaron 7 cursos, 9 grupos, 1 usuario y 34 eventos de auditoría. Los datos sintéticos de intereses se eliminaron al terminar el smoke (0 filas de interesados; 2 buckets técnicos con TTL). El secreto local se guardó en `.env` ignorado y no se registra su valor; no se requirieron cambios tracked al arranque (`bun run dev` sin cambios) y el servidor quedó activo en `http://127.0.0.1:4321`. Smoke local: GET `/`, `/cursos` y curso demo devolvieron 200; dos POST sintéticos devolvieron 200 con mensaje neutro y `no-store`; el rate limit usó loopback y no aceptó un header forwarded falsificado.

Cloud quedó migrado y desplegado en el release descrito abajo. El secreto permanece server-only y el flujo público se probó en producción. La configuración de backup/retención de datos personales sigue pendiente por separado; el plazo de 12 meses continúa siendo solo propuesta no aprobada.

PR 105 (`https://github.com/SteveCasTo/skillbase/pull/105`) se integró en `development` como `0bf0979` el 2026-10-01. La rama de feature incluyó los commits backend `3fea0df`, público `d8f714f`, administrativo `e903084` y ajuste de rutas Auth `6112080`.

### Cierre de release en producción (2026-10-02)

La preparación documental de release se aceptó mediante PR 106. PR 112 corrigió en `development` una expectativa no determinista que asumía orden de eventos de auditoría; PR 113 integró el release a `master` como `8f5bb2dc45ad373ff12aefd6325456885b20d5c6`. El merge previo de PR 107 (`640d03`) tuvo el deploy bloqueado por esa prueba; el fallo quedó resuelto sin reducir las aserciones de auditoría.

CI del PR 112: `36827391089`, jobs `quality` e `integration-e2e` PASS. CI del push a `master`: `36828194127`, `quality`, `integration-e2e` y `deploy` PASS. Full integration 65/65 y E2E 96/96, sin flaky tests. Vercel deployment `dpl_2kB2xrbE6ppxF4KYPVuR6cpfty9k` quedó `READY` y asociado a `https://skillbase-alpha.vercel.app`.

El Supabase cloud canónico `SkillBase` (`fvzxqlezdrlzykyoevub`) quedó `ACTIVE_HEALTHY`; ledger Drizzle 0000–0011 con hashes y timestamps correspondientes al repositorio. Migraciones 0010/0011 se aplicaron por el pipeline de release; constraints/RLS/revocaciones de las tablas nuevas se verificaron. Smoke público en producción: landing, catálogo y detalle con formulario devolvieron 200; alta y duplicado devolvieron el mismo éxito neutro `200`/`no-store`, persistiendo una sola fila. Dos valores spoof de `X-Forwarded-For` produjeron el mismo resultado de bucket por red/curso (contador 2 en cada scope), confirmando que no sustituyen la dirección de cliente confiable. No fue un stress test 429 ni una verificación del HMAC de una IP real. Se eliminó el único registro sintético; quedaron 0 interesados y 2 buckets técnicos con TTL. La ruta privada sin sesión redirigió a login con 303; no se probó una interacción manual como ADMIN en producción.

La cadena de confianza documentada es Vercel (sobrescribe `X-Forwarded-For`) → Astro/Vercel (`Astro.clientAddress`) → validación `net.isIP`; el secreto HMAC permanece server-only y no se registra su valor. El checklist de release Fase 3 queda completo por los gates automáticos y smoke público descritos; no se afirma validación manual del flujo administrativo en producción.

#### Propuesta de conservación (no aprobada)

Como propuesta de trabajo, anonimizar los datos de contacto doce meses después del cierre del curso y conservar solo métricas agregadas anónimas. El plazo y el tratamiento exacto no están aprobados por el usuario, no son requisito vigente ni están automatizados; no hay borrado/anonimización automática. La definición de gobierno de datos sigue pendiente para operación con datos reales. Esta propuesta no bloquea el cierre de Fase 3 ni el desarrollo de Fase 4; aprobar una política será requisito antes de implementar ese comportamiento de retención.

### Baseline verificado de calidad

El siguiente baseline es histórico y precede al trabajo actual de Fase 3; no acredita las validaciones de esta implementación.

En el baseline verificado para esta actualización: lint exitoso; 93 pruebas unitarias y 50 de integración exitosas; 62 E2E ejecutadas; typecheck con 0 errores y 41 hints; build exitoso. Durante E2E se observó un hydration mismatch relacionado con Sileo; su corrección está activa en otra rama y este baseline no cierra el gate de Fase 3. El formatter global solo reportó un aviso sobre `opencode.json`, ajeno a estos cambios; no modificar ese archivo.

### Resultado demostrable

Una persona deja datos como interesada sin pagar ni ocupar cupo; administración puede consultar la demanda. No implica aceptación ni inscripción.

## FASE 4 — GRUPOS, INSTRUCTORES Y ACCESO

### Estado y dependencias

Parte del alcance de Fase 4 fue anticipada: la gestión de grupos indicada como implementada abajo ya figura en el plan. No implica el cierre completo de Fase 4 ni la implementación de Fase 3. En Fase 3 el interesado puede expresar una preferencia de grupo; cualquier asignación efectiva a un grupo corresponde a Fase 5. Las sesiones conservan sus dependencias posteriores.

### Objetivos

- [x] Crear y administrar grupos con cupo máximo propio, sin mínimo obligatorio.
- [x] Definir horario L–V independiente por grupo, sin solapamiento dentro del curso.
- [x] Gestionar cancelación conservando historial y permitir grupos adicionales.
- [x] Permitir grupos válidos también en cursos borrador; eliminar solo grupos nunca publicados y desactivar/reactivar los que ya tuvieron exposición pública, con historial protegido.
- [x] Añadir perfiles y cuentas internas de instructores y asignar exactamente un instructor por curso; todos los grupos del curso heredan esa asignación.
- [x] Restringir acceso de instructor a su perfil profesional y cursos propios, también en rutas y consultas server-side.
- [x] Implementar login email/password junto con Google para usuarios internos, cambios/recovery de password y asociación Google explícita desde perfil.
- [x] Implementar creación y edición administrativa de perfiles/cuentas INSTRUCTOR, con credencial solo en Supabase Auth y compensación ante fallo de persistencia interna.
- [x] Gestionar cambio de instructor sujeto a calendario, validación de fechas ya iniciadas y conflictos de horario entre cursos.
- PR 126 no incluía baja; lifecycle y política correctiva se implementaron y se integraron en `development` mediante PRs 134/136. No se atribuye esa corrección a `master`/producción.
- [ ] Gestionar reemplazo por feriados cuando existan sesiones y calendario operativo (Fase 6).
- [x] Permitir expresar preferencia de grupo en Fase 3; asignar inscritos a grupos en Fase 5, sin tratar la preferencia como asignación.

#### Contrato funcional del módulo de instructores

- El ADMIN crea perfiles con nombre, apellido y email normalizado obligatorios; teléfono es opcional. El perfil público contiene únicamente nombre completo, sin descripción.
- La cuenta se crea por acción server-side del ADMIN con contraseña inicial elegida por el administrador. No es una invitación ni incluye onboarding/cambio forzado de contraseña. El instructor puede cambiarla desde perfil; esta edición es opcional.
- Un instructor puede vincular Google a la misma cuenta solo desde una sesión autenticada, mediante enlace explícito y correo verificado coincidente tras normalización. No se fusionan cuentas automáticamente. Un ADMIN existente conserva Google y puede configurar contraseña; no se incorpora gestión de creación de ADMIN.
- Instructor posee únicamente acceso a su perfil y a cursos asignados en esta fase. No obtiene acceso a formatos, interesados, participantes, usuarios ni ajustes. Asistencia y sesiones permanecen en Fase 6.
- Un curso tiene un único instructor asignado; la asignación es global al curso y la heredan todos sus grupos. Se elimina el nombre libre como fuente de identidad al completar el flujo.
- Se puede cambiar el instructor de un curso publicado antes del inicio oficial del curso; desde el inicio, el cambio queda bloqueado. El servidor es autoritativo y se conservan reglas existentes de retiro/archivo e historial/auditoría.
- Conflictos se comprueban para el mismo instructor entre cursos con calendario L–V que coincida en fecha y hora civil `America/La_Paz`; intervalos semiabiertos permiten turnos contiguos. Las escrituras concurrentes de asignaciones, cambios de fechas, creación/cambio de horario de grupos, estado y publicación deben compartir una estrategia transaccional de serialización para evitar carreras.
- El perfil con historial mantiene identidad estable y no se borra físicamente. El bloqueo por asignaciones no archivadas y la desactivación solo cuando no queden tales cursos se implementaron mediante PRs 134/136; PR 126 histórico no lo incluía.

PR 120 implementó e integró a `development` perfiles profesionales con ID estable, alta/edición, asignación a curso, ownership de `/app/mis-cursos`, guardas ADMIN/INSTRUCTOR y verificación de conflictos. PR 121 añadió y aplicó en local el seed/reset de demo. PR 122 añadió `PASSWORD_CHANGED` sin credenciales a `audit_events`. PR 123 reparó el guard de borrado de formatos con migración 0015 forward-only. No hay campo de descripción; el email del perfil es de solo lectura al editar. La publicación exige instructor registrado y `ACTIVE`, mientras que un borrador puede quedar sin asignar. Se conserva `instructor_name` histórico sin backfill automático; en cursos asignados el nombre completo deriva del perfil.

#### Implementación, datos locales y producción

PRs 118 y 120 integraron Auth, perfiles, asignación y ownership; PR 121 renovó demo local; PR 122 añadió auditoría de cambios de password; PR 123 aplicó la reparación forward-only del guard. PR 126 publicó y verificó Fase 4 en producción. Los flujos aprobados de alta/edición, asignación, acceso por ownership, dual auth y seed sintético están implementados; las cuentas/perfiles conservan ID estable e historial.

La renovación local usa `bun run db:seed:renew-demo`: plan sin flags, `--apply` insert-only, `--apply --reset-application-data` para reset local autorizado. Solo acepta Supabase canónico loopback, requiere ADMIN activo y `SEED_INSTRUCTOR_PASSWORD`/`SEED_ADMIN_ID`; la CLI es local-only y bloquea CI/Vercel/production. El reset usa allowlist con `TRUNCATE ... RESTRICT` sin `CASCADE`; conserva Auth identities/sesiones, usuarios, roles, perfiles instructor, configuración Auth, Storage y migration ledger. Ownership sintético usa IDs estables, `DEMO_SEEDED` audit markers y `app_metadata.seed_owner` para cuentas; no es una validación por hash ni usa metadata de reset.

El resultado de la renovación local fue 2 formatos/revisiones, 3 cuentas/perfiles `INSTRUCTOR`, 6 cursos (5 publicados, 1 draft), 12 grupos, 6 historiales de asignación, 35 interesados (30 `ACTIVE`, 5 `CANCELLED`) y 6 marcadores `DEMO_SEEDED`. Las reinserciones insert-only dejaron filas existentes sin cambios. Login password de los tres instructores y ownership (dos cursos propios por cuenta, denegación a rutas ADMIN) se probaron con sesiones temporales; sesiones cerradas al terminar. Valores `.env` no se imprimieron.

Durante PR 126 se hizo una renovación manual de los demos de producción, separada del seed local; se verificaron conteos antes/después y se preservaron Auth identities/sesiones, ADMIN, usuarios/roles/perfiles, Storage, Auth config y ledger. La operación no queda automatizada ni se repite en cada deploy. El script local conserva su guard local-only; futuras renovaciones de producción requieren autorización separada, datos sintéticos identificables y preservación de filas/auditoría legítimas.

#### Validación local y gate de release

- PR 120: 151 unit PASS, 84 integration PASS y full E2E 107/107 PASS en `127.0.0.1:4321` (evidencia previa a los cambios posteriores).
- Validación final PR 126: 154 unit PASS (1123 assertions), 87 integration PASS (615 assertions), full E2E 107/107 PASS en el puerto canónico `127.0.0.1:4321`; lint/format/build/Drizzle y `git diff --check` PASS; typecheck 0 errores/0 warnings/98 hints.
- Cronología Sharp: la corrida previa al arreglo tuvo 87 PASS/20 FAIL por error real de imagen. Se resolvió restaurando la dependencia opcional Astro Sharp con `bun install --frozen-lockfile`; la ruta final de imagen devolvió HTTP 200 con tamaño natural 1280×720. No requirió cambio de código ni actualización de dependencias del proyecto. El E2E final 107/107 corresponde a la fuente ya corregida; no se presenta como retry/flaky-pass de la fuente defectuosa.
- La aplicación local estándar y los stacks CI están migrados hasta 0015 (ledger de 16 entradas). Las migraciones cloud 0012–0015 se aplicaron en el workflow gated de PR 126.
- Supabase local tiene email provider, linking manual de Google y hook `before_user_created`; cloud aplicó 0012–0015 en PR 126. Google OAuth real y entrega SMTP no se probaron.
- Smoke UI local final PASS en `http://127.0.0.1:4321` (servidor activo PID 23168): catálogo 5 tarjetas, detalles, formulario/preferencias 200; solo nombre completo del instructor es público. Perfiles INSTRUCTOR y sus dos cursos/detalles dieron 200; rutas ADMIN directas denegadas 303. Sesiones temporales cerradas.
- PR 126 a `master` pasó el CI remoto requerido y deployment. El smoke cloud descrito en `docs/DEPLOYMENT.md` pasó. El gate de producción para los flujos aprobados está cerrado, con límites de email recovery y Google real documentados; el workflow mantiene sus gates/migraciones en releases futuras.

El ajuste UX de interesados (copy del formulario, submit progresivo, tarjetas/barras de demanda y skeleton) se integró en PRs 116 y 117 a `development`; su verificación full previa al bloque de instructores cerró 98/98 E2E. La evidencia local comunicada incluye 133 unitarias y 65 de integración; este hito queda separado de los 107 E2E del PR 120.

#### Estado de Fase 4 y release boundary

El cierre de PR 126 en `master` permanece como registro histórico de los flujos que aprobó entonces. Las correcciones post-release y cambio de puertos se integraron mediante PRs 134 (`b1855b1`), 135 (`ddd0f3d`) y 136 (`8cdb38f`); la migración 0016 se aplicó al Supabase local sin reset y se validó preservando datos. La fuente final `8735d676fe0d96e7230b4636efa8cb51045d1eca` pasó full 178 unit, 98 integration y 120/120 E2E más los checks locales. Estas correcciones quedaron después en producción mediante PR 211; consultar la evidencia de release Fase 6 arriba. Esto no completa Fases 7–9 ni cambia los límites académicos descritos abajo.

La corrección agrega una baja controlada de instructor; PR 126 no la incluía. La evidencia local y sus límites se registran también en `docs/TESTING.md` y el modelo de persistencia en `docs/DATA_MODEL.md`.

- [x] Formularios de alta/edición de instructor y perfil ahora ocupan responsivamente el ancho del área útil. Submit de alta/login/recovery/cambio espera validez requerida; edición solo permite guardar diferencias válidas. Contraseñas no se repueblan.
- [x] Eliminado el texto de conservación del correo y ambos textos redundantes de login sobre acceso limitado/preaprovisionado e instrucciones Google/correo; botón Google muestra su icono.
- [x] Ciclo de baja implementado: solo rol único `INSTRUCTOR`, sin asignaciones ni dependencias para eliminar; eliminación Auth con estado bloqueado/reintentable si falla el paso externo, tombstone/auditoría final. Instructores con asignaciones históricas solo se activan/desactivan. Desactivación bloqueada con lista de cursos asignados no archivados (incluye `DRAFT`); autorizada si solo quedan referencias archivadas. Guards server-side niegan sesiones ya abiertas. No modifica historia del release.
- [x] Interesados filtra/actualiza lista y zona de demanda sin recarga completa, preserva foco; skeleton solo con carga real, error recuperable/reintento y resolución last-request-wins. Duplicado conserva respuesta pública neutra de éxito, sin enumeración.
- [x] Draft puede permanecer sin instructor. El placeholder «Sin asignar…» está deshabilitado incluso en draft; editar otros campos conserva `null` y no se puede quitar asignación de un curso que la requiere. Publicación valida instructor `ACTIVE` y al menos un grupo `PLANNED`; error de instructor ausente ahora es accionable inline y toast.
- [x] No se desactiva el último grupo `PLANNED` de curso `PUBLISHED`; retiro editorial del curso publicado sigue permitido. Cancelar (`X`) edición de grupo revierte ambos campos del editor inline y alinea las acciones como solicitado.
- [x] En mobile, al breakpoint implementado (hasta 1023 px), tema queda a la izquierda y logout a la derecha; el sidebar desktop no se reordenó. Datos personales enlaza al perfil en mobile y abre por hover/foco en desktop, sin enlace móvil extra «Mi perfil».
- [x] Perfil responsivo. Cambio de contraseña se inicia desde acción hacia página dedicada: cuentas password validan password actual/nueva/confirmación; Google-only establece password sin pedir password anterior ni enviar botón de confirmación por correo, con sesión Google OAuth aprobada, reciente y revalidación server-side de cuenta/actor. Errors son inline, incluidos same-password accionable; recuperación está en página propia y botón email condicionado a validez.
- [x] Se preserva SSR/POST, validación y autorización server-side; la UI no sustituye garantías de sesión/identidad ni confía en metadata para Google-only.
- [x] Mutaciones usan UUID por operación y mismo ID de notificación loading/resultado; mantienen foco, valores recuperables y estados pending/error/result.
- [ ] Verificar entrega real de recovery/perfil tras configurar SMTP propio autorizado; configuración y entrega siguen pendientes. La comprobación del callback/Google OAuth real es independiente y también queda pendiente.
- [x] Integrar lifecycle/correcciones en `development` mediante PR 134 (`b1855b1`) y el cambio de puertos mediante PR 135 (`ddd0f3d`). No se afirma CI remoto PASS a partir de los resultados locales.
- [x] Aplicar migración 0016 al Supabase local estándar sin reset; ledger avanzó 16→17 y se preservaron Auth identities/ADMIN/roles/perfiles/sesiones/Storage/cursos/intereses. Smoke local public/privado PASS; los únicos cambios no técnicos fueron el ledger y el timestamp de login del usuario sintético de comprobación.
- [x] Fuente final `8735d676fe0d96e7230b4636efa8cb51045d1eca` pasó 178 unit, 98 integration y full canonical E2E 120/120; lint, formatter, typecheck (0 errores/0 warnings), build, Drizzle y `git diff --check` PASS. No hay avisos/errores de hidratación `Astro.session`/React en el run final.
- [x] Aplicar corrección de middleware context spread que evitaba evaluar getters de Astro y la hidración SSR/React de password; mantener cobertura de `request-client-context` y E2E `password-hydration`. No se suprimieron warnings globalmente.
- [x] Integrar el commit fuente final en `development` mediante PR 136 (`8cdb38f`); correcciones Fase 4 y gate de test están cerrados en `development`. No implica release/deploy a `master` ni cambios cloud.

Las reglas de identidad, propiedad, validación server-side, SSR y recuperación descritas en `docs/AUTHENTICATION.md`, `docs/SECURITY.md` y `docs/DESIGN.md` siguen siendo límites; esta lista no autoriza debilitarlas.

#### Estado del bloque de autenticación dual

Los commits Auth de PR 118 y los bloques de instructores/seed/audit/guard de PRs 120–123 se integraron en `development` y se promovieron mediante PR 126. La release de Fase 4 está desplegada/verificada; no incluye los módulos futuros listados en fases posteriores.

- [x] Google y email/password en login, verificación del método de sesión y autorización por identidad interna activa.
- [x] Perfil `/app/perfil` con cambio opcional de contraseña, confirmación por contraseña actual o correo, recovery y asociación Google opcional.
- [x] Provisionamiento server-side mediante `createInstructorAccount(actorAuthUserId, { email, name, password, profile })`; crea cuenta confirmada y perfil interno ACTIVE con rol INSTRUCTOR en transacción y compensa si falla la persistencia.
- [x] Full E2E Auth aislado 104/104 PASS en puerto canónico 4321 (PR 118). La fase siguiente añadió y validó el módulo de instructores, full E2E 107/107 reportado en PR 120.
- [x] Integrar Auth mediante PR 118 y el módulo de instructores mediante PR 120 a `development`; promover mediante PR 126 a `master` tras CI y deploy PASS. Este PR documental cierra/sincroniza los documentos pendientes; no representa un nuevo release de código.
- [x] En Supabase local estándar: 0012–0015 aplicadas, hook activo y `AUTH_RATE_LIMIT_SECRET` configurado server-only; no registrar valor.
- [x] Producción: 0012–0015, hook y Auth rate-limit secret se aplicaron/configuraron en PR 126; redirects de recovery quedaron configurados. SMTP propio/entrega recovery y Google OAuth real no se verificaron, así que no declarar Forgot password ni OAuth real probados.

La suite Auth/Instructores PR 118/120 conserva su cronología (104/104 y luego 107/107 local); PR 126 validó fuente final con CI y producción. No se afirma Google real ni entrega SMTP probados. El Supabase local estándar quedó migrado/seeded; smoke local ejecutado en `127.0.0.1:4321` (PID 23168 al último reporte).

### Resultado demostrable

Administración transforma demanda en grupos operativos.

## FASE 5 — PREINSCRIPCIÓN PRESENCIAL Y GESTIÓN ADMINISTRATIVA

### Objetivos

- Registrar presencialmente a una persona como preinscrita, con pago parcial o total y ocupación de cupo; permitir registro directo o prellenar desde un interesado con datos editables.
- Diseñar el vínculo de origen con el interesado como explícito y trazable, sin inferir identidad global ni pago desde el registro público.
- Usar los estados operativos `PREINSCRITO`, `INSCRITO` y `SALDOVENCIDO` según reglas aprobadas; ninguno implica por sí mismo resultado o cierre académico de Fases 6+.
- Registrar CI como identificador principal de la ficha global, según normalización conservadora descrita en el alcance confirmado.
- Registrar tipo de participante.
- Registrar precio aplicado.
- Aplicar descuentos.
- Registrar condición de auxiliar.
- Registrar boleta/valorado si corresponde.
- Revertir inscripciones.
- Gestionar devolución por cancelación de grupo.
- Gestionar cambios de grupo y devoluciones en esta fase; no duplicar estas operaciones en Fase 3.
- Generar listados administrativos.

### Estado Fase 5 (2026-10-04; release en producción)

Las correcciones y el gate completo de Fase 4 se integraron mediante PR 136. PRs 173–180 integraron schema/dominio/persistencia transaccional, settings, exportes y rutas HTTP/de roster de Fase 5 en `development`. Fase 5 se promovió a producción como `2e0eecb`; cloud quedó migrado hasta 0017 (ledger 18). El full E2E canónico reportado pasó 125/125 y quality 303 unit / 125 integration; el detalle histórico está en el cierre de producción. La integración y validación local del alcance de fase 5 no incluían asistencia/sesiones ni habilitan módulos académicos.

Los cierres documentales históricos de producción (`46fa1c0`, `152f610`) son commits de documentación únicamente: no forman parte de esta rama ni deben integrarse por cherry-pick/merge. Esta nota reflejaba el límite del release de Fase 5: las correcciones existentes y Fase 6 se liberaron después mediante PR 211. Las correcciones posteriores de 219–223 están integradas en `development`; su gate completo y release siguen pendientes según el cierre actualizado abajo.

#### Implementación integrada en development

- [x] PR 173 (`512d5da`): dominio/base de participantes, preinscripciones presenciales, configuración, snapshots, recibos idempotentes y ledger; migración 0017 aplicada localmente y en cloud para el release Fase 5 (ledger cloud 18). El baseline antes del milestone tenía seis cursos/35 interesados y no tenía fixtures financieros.
- [x] PR 174 (`2978dd0`): formulario/componentes para administrar porcentajes globales (mínimo 25 %, auxiliar 50 % por defecto) y revisión optimista; integrado en conjunto con su backend/HTTP en PR 178.
- [x] PR 175 (`a21e466`): generadores server-side CSV/PDF; límite máximo 1000 registros, CSV con mitigación de fórmula, PDF con Noto Sans incrustado y licencia incluida. Las columnas implementadas son etiquetas curso/grupo, nombres/apellidos/CI, tipo, estado de membresía/estado financiero y montos snapshot (precio, pagado, saldo, devuelto y por devolver); no se agregan campos no aprobados.
- [x] PR 176 (`8681387`): casos de uso/repositorio transaccional para alta/actualización, abonos, devoluciones, cancelación, cambio de grupo, cancelar grupo y roster; ownership/cupo/actor/snapshot/idempotencia se comprueban en servidor/DB.
- [x] PR 177 (`2d4cf5d`): componentes UI reutilizables y corrección del formulario de ajustes. Reportó 291 unit, 125 integration y quality PASS; no representa validación E2E completa del flujo.
- [x] PR 178 (`5215a50`): settings ADMIN singleton, page/form y handler SSR/POST/JSON en `/app/configuracion`; su middleware route policy se agregó en PR 179.
- [x] PR 179 (`c78bb81`, merge `d13432d`): integra las rutas `/app/preinscripciones` (listado, `/nueva`, detalle y acciones), `/app/participantes`/detalle, búsqueda/prellenado, `/app/preinscripciones/exportar?format=CSV|PDF` y roster propio `/app/mis-cursos/[id]/grupos/[groupId]`; actualiza route policy ADMIN/INSTRUCTOR. Montos HTTP son texto decimal BOB, parseados a centavos en servidor; mutaciones responden con contratos discriminados de éxito/error. La UI reportó 34 pruebas dirigidas y 3 E2E focales PASS; la suite full canonical también pasó (registro abajo).
- [x] Gate local reportado tras PR 179: 303 unit, 125 integration, 125/125 E2E canónico; quality con 0 errores/0 warnings y 24 screenshots en 375/768/1440 px, ambos temas, sin overflow. Una corrida inicial pasó 119/125 por fallos reales SSR 500/settings browser-only e hidración; se corrigieron y el full final pasó sin retries.
- [x] Resultado final de `25890143` quedó integrado mediante PR 180 (`917a636`): 303 unit, 125 integration y full canonical E2E 125/125. La corrida inicial 119/125 expuso seis fallos SSR/settings/hidratación; el source se corrigió y la corrida final pasó sin retries. No quedan avisos de calidad en el resultado reportado.
- [x] Completar la promoción de Fase 5 a `master` y migrar cloud de forma autorizada. El release de producción es `2e0eecb`; no confundirlo con los cierres documentales históricos `46fa1c0`/`152f610`, que no se deben integrar.

#### Alcance confirmado para Fase 5 (implementado y liberado)

- Participante global sin cuenta, identificado por CI único normalizado conservadoramente: quitar espacios externos, normalizar case/espacios y preservar ceros iniciales, letras y sufijos; no convertir a número ni imponer formato nacional/checksum. Ficha: nombre/apellidos, email requerido, teléfono opcional. Una preinscripción vigente por participante/curso; admite varios cursos. Sin escaneo ni verificación/checksum de CI.
- Tipos `STUDENT`, `EXTERNAL`, `AUXILIARY` elegidos manualmente por ADMIN. `AUXILIARY` usa tarifa `STUDENT` menos 50 % inmediato; no se exige evidencia digital, categoría adicional ni certificado previo.
- Configuración ADMIN global mínima: porcentaje entero de mínimo de pago (1–100 %, default 25 %) y porcentaje entero de descuento AUXILIARY (0–100 % inclusive, default 50 %). Solo afecta nuevas preinscripciones. Se guarda snapshot inmutable de precio/revisión del curso, tipo/base, porcentajes y montos en `BOB`, centavos enteros/decimal exacto, no `float`. Si el total final es positivo, primer pago mínimo = ceil al centavo del total final × mínimo. Si AUXILIARY aplica 100 % y total queda exactamente 0, permitir preinscripción gratis y eximir mínimo; conservar snapshot cero sin inventar pago.
- Abonos positivos manuales en efectivo; no pasarela, comprobante subido, recibo ni boleta/valorado generados. No negativos ni sobrepago. Ledger auditable no destructivo con actor y timestamp de registro; fecha efectiva civil Bolivia puede ser pasada, nunca futura y por defecto hoy. No crear evento/abono de cero para la inscripción gratuita. Devolución registrada no significa transferencia ejecutada por la app y nunca supera lo realmente pagado; registro gratis sin pago no genera devolución monetaria.
- Alta ordinaria solo para curso `PUBLISHED`, grupo `PLANNED` con cupo e instructor `ACTIVE`, hasta cierre inclusivo de ventana o inicio oficial si no hay ventana. ADMIN puede registrar durante el primer día civil solo con el total cubierto (importe positivo: efectivo total; importe gratis: sin movimiento de pago), destino elegible/cupo y auditoría; no hay altas en días posteriores por esta excepción. Zona `America/La_Paz`.
- La preinscripción permanece `PREINSCRITO` hasta el inicio aunque esté pagada. Al inicio y con saldo completo pasa a `INSCRITO`; saldo pendiente permanece `PREINSCRITO` durante el primer día y al cierre de ese día se marca `SALDOVENCIDO`, sin borrar, cancelar, liberar cupo o reembolsar automáticamente. ADMIN resuelve manualmente; esto no constituye actividad académica.
- Cancelación voluntaria con devolución total de lo pagado solo hasta la fecha límite inclusiva. Cancelar grupo obliga a registrar devolución total de pagos de preinscritos afectados, sin límite por cutoff. Se preserva identidad/historial, con actor/monto/fecha/motivo; se libera cupo cuando corresponde. No se afirma ejecución bancaria, no hay refund por saldo vencido ni borrado físico.
- Cambios de grupo solo dentro del mismo curso y hasta fecha límite, con destino activo/cupo; no hay cambio entre cursos. No se recalcula snapshot: grupos del mismo curso comparten tarifa/revisión. Origen, destino y cupo cambian atómicamente.
- Mutaciones de participantes, preinscripciones, pagos, configuración/grupos/devoluciones son `ADMIN`-only. Instructor, desde inicio oficial, consulta readonly cursos/grupos propios y roster mínimo (nombre/apellidos), sin finanzas, CI/email ni exportación. CSV/PDF administrativos ADMIN-only, no recibos/boletas y protegidos contra formula injection. No incluir sesiones, asistencia, notas ni certificados de Fases 6+.
- Preservar vínculo explícito y trazable de origen desde `InterestRegistration` si aplica, pero no mostrar flujo/selector de vínculo dedicado ni fusionar personas por el email declarado públicamente. Mantener métricas de interesados intactas; el prellenado no convierte el interés en participación ni afecta métricas.

#### Decisiones confirmadas y límites para el contrato

La política de instructor queda confirmada: bloquear desactivación si tiene asignación a cursos no archivados (incluye draft), mostrar cursos bloqueantes y exigir desasignar/reasignar; permitirla si todo lo asignado está archivado. Con cualquier historia de asignación no hay borrado físico. Sin historia, eliminación solo con rol único `INSTRUCTOR`, sin dependencias y con borrado consistente de Auth. Desactivado deniega todas las rutas y acciones server-side incluso si la sesión sigue abierta.

Instructor puede consultar en modo lectura sus grupos y roster desde el inicio oficial; datos visibles limitados a nombre/apellidos y sin finanzas. El roster no se exporta.

El alcance funcional quedó cerrado por confirmación del usuario. Descuento auxiliar configurable 0–100 % (default 50) sobre tarifa `STUDENT`; 100 % y total final cero permiten registrar una preinscripción gratuita sin crear un pago ficticio, y el mínimo se exime solo para total cero. Para todo importe positivo aplica el mínimo configurable 1–100 % (default 25) sobre total final, redondeado hacia arriba al centavo. Los snapshots y exclusión de retroactividad siguen vigentes. No queda pendiente esta pregunta de precio cero.

El contrato aprobado se implementó por etapas y Fase 5 se liberó como `2e0eecb`. La comprobación manual pendiente del callback local de Google OAuth es independiente de SMTP; no implica que OAuth real se haya probado. La configuración/entrega SMTP debe documentarse y verificarse por entorno sin versionar credenciales.

El registro público de interesados de Fase 3 no cobra ni ocupa cupo. La preinscripción presencial/pagada pertenece a esta fase conforme al alcance financiero de `docs/REQUIREMENTS.md`; no incluye pasarela, comprobantes subidos ni emisión automática de boleta.

#### Validación de implementación y release

- [x] Cubrir normalización CI, unicidad/vigencia, elegibilidad/ventanas, snapshots/precio/descuento, AUXILIARY 100 %/gratis sin ledger de cero, mínimo/redondeo exacto, estados y cancelación/devolución en unit/integration.
- [x] Cubrir schema/constraints, migración, historial, settings no retroactivos, ledger, autorización/RLS, origen interesado y concurrencia cupos/transferencias en integration.
- [x] E2E admin de alta directa/prellenada, filtros/detalles, cupo, pagos, fecha límite/primer día, saldo vencido, transferencia y cancelación/devolución; revisar ADMIN-only, roster instructor mínimo y exportes.
- [x] En el full canónico reportado: 303 unit, 125 integration y 125/125 E2E; quality 0 errores/0 warnings y 24 screenshots responsive/temas sin overflow. Sin commits de cobertura retirados ni reducciones de assertions para lograr verde.
- [x] Terminar el milestone con el release a `master`, migración cloud y verificación de deployment; el release de producción es `2e0eecb`. Los checks locales no sustituyen los gates de release.

### Resultado demostrable

Administración puede gestionar preinscripciones presenciales con persona global, efectivo cuando corresponda, gratuidad aprobada, snapshots de tarifa/descuento, cupo y movimientos financieros/cancelación. Instructor consulta roster propio mínimo desde inicio. `INSCRITO` y `SALDOVENCIDO` no habilitan módulos académicos. Fase 5 se liberó en producción en `2e0eecb`; en ese momento asistencia/sesiones continuaban pendientes y se liberaron después en Fase 6/PR 211.

## CORRECCIONES POST-RELEASE DE ADMINISTRACIÓN (development; incluidas después en producción)

Las correcciones aprobadas se integraron en `development` mediante PRs 196–199 y quedaron incluidas en producción con PR 211. Los commits documentales históricos `46fa1c0` y `152f610` no se cherry-pickean ni mergean.

- [x] Simplificar Configuración y editar ajustes/campos de participantes en línea.
- [x] Corregir selección/búsqueda de interesados, ocultar candidatos consumidos preservando historial y no inferir identidad por email.
- [x] Ajustar cards/grillas/listados; el detalle conserva las finanzas y el listado de participantes las minimiza.
- [x] Usar calendario shadcn compartido, mostrar descuento solo para AUXILIARY, retirar copy/banner técnicos y presentar nombre humano del actor.
- [x] Completar diálogos financieros con importes exactos/validados, razón opcional, UUID/loading/resultado y fallback SSR sin JavaScript.
- [x] Integrar configuración SMTP protegida local/cloud. Recepción de prueba confirmada por el usuario en local; no se ha verificado clic de recovery/cambio de contraseña ni entrega cloud. Google OAuth real/callback continúa pendiente de forma independiente.
- [x] Integrar y aplicar localmente el runner demo append-only, con extensión opcional de asistencia, PLAN de solo lectura, destinos explícitos y provenance estable. APPLY confirmado sobre `6813a4c`; los fixtures preservaron historial, Auth/roles/perfiles/sesiones/Storage/settings y ledger. Tras el gate autorizado, se aplicó también en producción; los conteos antes/después constan en el cierre de Fase 6.

El detalle UX se mantiene en `docs/DESIGN.md`, las reglas de secretos/demo en `docs/SECURITY.md` y la configuración de Auth en `docs/AUTHENTICATION.md`.

## FASE 6 — SESIONES Y ASISTENCIA

### Estado (release Fase 6 en producción; correcciones posteriores integradas)

PRs 201–203 integraron dominio, migraciones, demo y UI; PRs 204–205 corrigieron hallazgos de validación/consistencia y PRs 207–209 ajustaron pruebas focales. El milestone se liberó en producción mediante PR 211; PRs 213/214 añadieron herramientas operativas y PRs 216–218 completaron cambios de calendario/filtros y su gate. Producción está en `3c6ae7e2cff74faeb2f0f7de05d63b753418df4a`; la evidencia de CI del release es `37405417986` y `37406246926`, con 334 unitarias, 137 de integración y 127/127 E2E PASS, sin flakes. Evidencia del gate de PR 218: comentario 6008610515.

La migración 0019 se aplicó en local y producción sin reset; ambos ledgers quedaron en 20 y se preservaron Auth, Storage, configuración y filas históricas. Producción registra 22 grupos propios, 282 sesiones (280 originales y 2 reemplazos), 3 canceladas, 16 marcas de participantes y 4 de instructor. La demo local registra 12 cursos, 23 grupos, 16 registros y 13 movimientos de caja; los conteos de producción para estos cuatro conjuntos son 11/22/15/12. El histórico 126/127 + revalidación focal 1/1 no es el gate final 127/127. SMTP local solo tiene recepción de prueba confirmada; clic de recovery/cambio de contraseña y entrega cloud no están verificados. OAuth real sigue pendiente; el callback local es `http://127.0.0.1:55321/auth/v1/callback`. La propuesta de retención de 12 meses no está aprobada.

El módulo incluye calendario de grupo/sesión, permisos ADMIN/INSTRUCTOR, asistencia del roster elegible, asistencia del instructor, revisiones administrativas de rosters históricos, reemplazos/cancelaciones y configuración del umbral. La implementación se describe en [`docs/ATTENDANCE_CONTRACT.md`](ATTENDANCE_CONTRACT.md); esto no incluye evaluaciones, porcentajes ni certificados.

- [x] Implementar migración 0019 con seis tablas protegidas/RLS, repositorios/casos de uso y auditoría/idempotencia; 0018 añade razón opcional para movimiento de efectivo.
- [x] Generar/materializar sesiones desde el planificador vigente, preservando cronología y duración de la revisión; cancelación conserva razón y el original, los reemplazos quedan ligados y no extienden horas configuradas.
- [x] Implementar configuración independiente de ausencia consecutiva (default 3), estados Present/Absent/Excused y `PENDING` derivado. No existe porcentaje ni retraso/tardanza.
- [x] Integrar páginas SSR/POST para ADMIN e INSTRUCTOR y edición autorizada; roster solo nombres, sin CI/email/finanzas para instructor.
- [x] Integrar y ejecutar el generador de demo optativo para asistencia; APPLY confirmado contra `6813a4c`. Se agregaron 5 cursos, 10 grupos, 15 registros, 12 movimientos financieros, 28 sesiones, 16 marcas de participante y 4 del instructor; totales locales 12 cursos, 23 grupos, 16 registros y 13 movimientos incluyen filas previas preservadas. La operación autorizada de producción y sus conteos están documentados arriba.
- [x] Añadir cobertura focal de backend, UI y runner. La cobertura combinada documentada no es un único full E2E verde: unit 332 e integration 137 PASS en `4b331ff9`; E2E 126/127 PASS en `b681a365`, con un fallo de strict locator en prueba sin JavaScript. Tras el cambio de test-only PR 209, el escenario afectado pasó en una corrida focal, sin retry; la evidencia combinada cubre los escenarios pero no se afirma full 127/127 en una sola ejecución.
- [x] Pasar build, Drizzle y quality en `b681a365`; typecheck: cero errores, cero warnings y 204 hints. El backend mantuvo sus 12 unit y 12 integration focales PASS.
- [x] Revalidar mediante PR 209 el locator del test sin JavaScript: un caso focal PASS, sin repetir la suite completa.
- [x] Completar revisión visual final responsive/accesible: seis vistas (375/1440 px, light/dark), sin overflow; foco visible, diálogo con Escape y retorno de foco; estado de asistencia N=3 y restricción desde N+1; instructor sin datos de contacto/finanzas; sesión no autorizada 404; cero errores/warnings de consola.
- [x] Cerrar el gate local mediante evidencia combinada: unit/integration, full E2E más revalidación focal del único locator test-only fallido, build/Drizzle/quality y revisión visual. No se afirma un único full E2E 127/127.
- [x] Promover Fase 6 a `master`, aplicar 0018/0019 a cloud y desplegar tras el gate requerido (PR 211; release `3c6ae7e2cff74faeb2f0f7de05d63b753418df4a`).
- [x] Completar el gate combinado de release y la verificación posterior de calendario/filtros (CI `37405417986`, `37406246926`; PR 218, evidencia 6008610515).

### Objetivos

- Crear calendario de sesiones.
- Registrar asistencia.
- Registrar asistencia del instructor.
- Manejar sesiones de reemplazo.
- Aplicar política configurable de conteo de ausencias consecutivas y advertir/bloquear reconocimiento según el umbral aprobado.
- No calcular ni mostrar porcentaje de asistencia ni aplicar un gate porcentual en esta fase.

### Resultado demostrable

Instructor gestiona asistencia diaria de un grupo.

### Alcance implementado y liberado en producción

Las reglas siguientes describen el comportamiento implementado para Fase 6 y actualmente disponible en producción tras PR 211. Los cambios correctivos aprobados que se detallan antes de Fase 7 son un alcance posterior y todavía no se consideran implementados:

- Generar sesiones según fechas/duración de la revisión del formato. Las sesiones existentes no se sobrescriben al regenerar; cambios se representan mediante cancelación/reemplazo conservando el original y la cronología. El calendario L–V incluye fechas pasadas sin inferir ausencias históricas: quedan pendientes de revisión explícita de ADMIN. La generación no produce ausencias retroactivas.
- ADMIN puede cancelar una sesión por feriado (o indicar otro motivo) y crear reemplazos conservando la sesión original cancelada y la cronología. No hay módulo/calendario global de feriados. Un reemplazo conserva duración, puede ser el mismo día a hora anterior o caer otro día (incluido fin de semana), y debe evitar conflictos del instructor/grupo.
- Instructor solo consulta y registra sesiones de sus propios grupos, para participantes `INSCRITO` del curso y su propia asistencia; ADMIN puede consultar/registrar ambas. No exponer finanzas/CI/email en roster.
- Estados de participante: `Presente`, `Ausente`, `Justificada`. La justificación cuenta para asistencia, pero interrumpe la racha de ausencias. No existe estado de tardanza. Para el instructor, la edición se limita al día civil de Bolivia de la clase; ADMIN puede corregir posteriormente con auditoría.
- Durante el día de la sesión, una asistencia aún no registrada se considera pendiente; al finalizar el día se deriva como ausente. Este resultado debe derivarse sin un job global que inserte ausencias irreversibles; sesiones canceladas se excluyen. Las sesiones históricas generadas siguen pendientes hasta revisión ADMIN.
- Configuración de asistencia se limita al umbral de ausencias consecutivas: valor inicial 3, configurable. Se advierte al alcanzarlo y se pierde elegibilidad al superarlo (N+1); una justificada interrumpe la racha. No hay subsistema independiente de alertas, expulsión, cancelación automática de cupo ni reembolso. La elegibilidad futura puede bloquear certificados (Fase 9); no se generan certificados en Fase 6.
- El runner demo append-only se aplicó en local y, tras el release autorizado, en producción sin reset, preservando Auth/Storage/settings y filas históricas. Producción contiene 22 grupos propios, 282 sesiones (280 originales y 2 reemplazos), 3 cancelaciones, 16 marcas de participantes y 4 del instructor; el demo local se registra en 12 cursos, 23 grupos, 16 registros y 13 movimientos de caja. Producción conserva 11/22/15/12 cursos/grupos/registros/movimientos. No confundir la carga de datos sintéticos con los gates de release ni con el historial legítimo preservado.
- La configuración SMTP cloud y local está aplicada sin exponer secretos; recepción de prueba local confirmada. Esto no verifica recovery end-to-end ni Google OAuth: el callback local actual `http://127.0.0.1:55321/auth/v1/callback` aún requiere autorización manual en Google Console.

Las pruebas focales y full citadas corresponden a sus heads, no a una única ejecución agregada. La corrida inicial 126/127 más la revalidación focal 1/1 documentan el gate local previo; el gate remoto de release posterior sí reportó 127/127 en una corrida, sin flakes. La revisión visual y el release cloud/master están cerrados para Fase 6.

## CIERRE DE CORRECCIONES DE EXPERIENCIA ADMINISTRATIVA (release PR 228)

El cierre de correcciones previo a Fase 7 se completó con PR 228. PRs 219, 221–223 integraron backend, ajustes/feedback, perfiles y UI C3; PR 220 sincronizó documentación y PRs 225/226 ajustaron solo expectativas E2E. El milestone se liberó a `master` como `3e6e3a45417e35d412dd8ece34dc90ecd7ccb8e0` el 2026-10-07 02:01:05Z. En el PR hubo aprobación explícita del usuario para omitir la aprobación administrativa de merge **después** de que los checks CI requeridos pasaran; no se omitieron checks fallidos ni se cambiaron las protecciones del repositorio.

El source de desarrollo validado antes de integrar fue `292c5d42e2babb51a96c558074ef0ac0e1c2b261`. Desde `eacf6feeb26d67da98e46195a07d8777dd180966` no cambiaron aplicación, schema ni dependencias; PRs 225/226 cambiaron pruebas E2E. Producción ahora corre el commit de release indicado arriba; el estado del deployment y límites de verificación de cloud están en [`DEPLOYMENT.md`](DEPLOYMENT.md). No se ejecutaron migraciones, operaciones de datos ni reseed para este release; ledger/conteos cloud no se revalidaron con PR 228. El último baseline histórico conocido era ledger 20.

- [x] Backend C1/C2 mediante PR 219: cancelación y reprogramación requieren `startsAt > now` y ausencia de marcas de participantes e instructor. El repositorio adquiere los locks de horario/sesión antes de volver a leer marcas y muestrear el reloj; el DTO indica explícitamente `canCancel`/`canReplace`. La familia conserva un solo encuentro activo, cronología/historial, duración y control de conflictos.
- [x] PR 221: configuración con campos independientes y grilla responsive; edición inline de participante, reintegración y transferencia/cancelación conservando draft/revision/idempotencia; feedback sin toast duplicado ante errores de campo.
- [x] PR 222: instructor y perfil profesional inline por campo, lifecycle con botones condicionados por cursos bloqueantes; edición del nombre propio para ADMIN puro. El alcance y límites de identidad se detallan en [`AUTHENTICATION.md`](AUTHENTICATION.md).
- [x] Integrar la UI nueva de asistencia/grupo C3 desde `fix/course-group-attendance-ui` mediante PR 223. Incluye página dedicada de participantes/calendario y mantiene privacidad de roster; PR 228 liberó las correcciones a producción.
- [x] Resolver durante PR 223 el conflicto con el componente compartido `RegistrationActionDialog`, conservando el resolver/ownership de PR 221.
- [x] Completar lint/format/typecheck/Drizzle/build local; unit 339 y integration 138 PASS; conservar evidencia por source en [`TESTING.md`](TESTING.md).
- [x] Integrar y promover las correcciones con PR 228 luego de CI requerido; Vercel deploy `dpl_4VKVLtA5rP5YbP5y1Nymnc5TKMep` quedó READY para el SHA exacto de release. Smoke público/Auth respondió 200 y cuatro rutas privadas sin sesión redirigieron 303 a login.
- [x] Completar full E2E master CI 130/130 PASS sin flakes reportados (run `37559942423`). La corrida previa de PR tuvo un test flaky `public-interest` con submit disabled que pasó por retry automático; el focused posterior 1/1 sin retry no cambió código ni identificó causa raíz. La intermitencia local observada en guardado de grupo tampoco tiene causa raíz identificada; no afirmar que estos antecedentes quedaron corregidos solo por el full run verde.
- [x] Registrar que el merge approval fue omitido explícitamente por el usuario después de CI green; no fue bypass de CI ni cambio de branch protection.

Las correcciones C1/C2/C3 quedaron liberadas mediante PR 228. Cancelación/reprogramación opera solo antes de `startsAt`, sin marcas de participantes/instructor; reemplazos futuros conservan duración e historial y no entran en conflicto. Las correcciones históricas ADMIN de evidencia siguen separadas de acciones operativas.

## FASE 7 — EVALUACIONES Y NOTAS (release en producción; Fase 7 cerrada)

CI de master PR 235 (`37573738321`) pasó 343 unit, 139 integration y full E2E 132/132, sin flakes reportados.

El contrato aprobado se mantiene en [`docs/EVALUATIONS_CONTRACT.md`](EVALUATIONS_CONTRACT.md). PR 230 integró dominio, aplicación, repositorio Drizzle, loader/HTTP helpers y migration 0020; PR 232 integró cuatro páginas Astro ADMIN/INSTRUCTOR de curso/grupo y los componentes de esquema/notas, historial y roster. PR 235 liberó Fase 7 a `master` como `4afa4858c8279282a8d26ab4adfa7769e249432d` el 2026-10-07. Fase 7 queda cerrada dentro de su alcance; Fase 8 y Fase 9 siguen pendientes.

Migration 0020 se aplicó al Supabase local canónico y a cloud; los ledgers verificados quedaron en 21. La operación local preservó datos previos e idempotencia; la verificación cloud fue de solo lectura posterior y no incluyó comparación de hashes pre/post de todas las filas. El inventario cloud, la discrepancia histórica de marcas de instructor y sus límites están en [`DEPLOYMENT.md`](DEPLOYMENT.md). No se añadió seed de evaluaciones; las cinco tablas nuevas quedaron vacías y el demo financiero no contiene notas.

- [x] Confirmar contrato funcional/técnico antes de implementación.
- [x] Implementar backend base de esquema, dominio, persistencia, autorización, revisión/freeze y auditoría (PR 230).
- [x] Reparar cleanup de fixtures para las nuevas tablas en el mismo `TRUNCATE ... RESTRICT` (649441b); mantener registro del accidental full integration run histórico 118/24.
- [x] Integrar UI ADMIN/INSTRUCTOR en cuatro rutas de curso/grupo (PR 232): esquema, roster/notas, drafts individuales, pendiente distinto de cero completo e historial ADMIN.
- [x] Corregir fixture E2E de curso archivado con grupos `PLANNED` mediante PR 233 sin cambiar guards o reglas de horario del producto.
- [x] Pasar quality master CI y 343 unit/139 integration; full E2E master CI 132/132 PASS sin flakes reportados (37573738321). Ver ejecuciones focales/locales separadas en [`TESTING.md`](TESTING.md); no afirmar un único full run local 132/132.
- [x] Aplicar migration 0020 local/canonical y cloud por el pipeline del release; validaciones locales/readonly cloud y límites de row-hash constan en `TESTING.md`/`DEPLOYMENT.md`.
- [x] Liberar Fase 7 mediante PR 235; Vercel deployment `dpl_A9Av16T1DZvk19W1836VEuPimAGS` quedó READY para el SHA exacto de master y alias de producción.

Fase 7 no incluye ni completa Fase 8 (cierre/planilla/reapertura) o Fase 9 (certificados), que no han iniciado y requieren su propio alcance/autorización. No adelantar weighted-grade changes posteriores ni convertir el demo financiero en un seed de notas.

### Correcciones post-release Fase 7 (validación local combinada completada; publicación pendiente)

PRs 258–264 integraron a `development` las correcciones de escritura atómica por fila, edición inline, roster/calendario, interfaz de evaluaciones y preinscripciones, perfil de instructor y retiro de las rutas UI duplicadas de participantes. El commit local `6b87d24d80df3810889139aa776604b0041b2802` (`fix/instructor-lifecycle-revision-selector`, base `274db4c`) completa los últimos ajustes de expectativas E2E del bloque. La aplicación, schema y dependencias no cambiaron respecto al source previo; ese commit modifica el test `tests/e2e/instructor-lifecycle.spec.ts`. No está publicado ni mergeado: `origin/development` permanece en `274db4c` según el reporte del owner.

La validación local del head exacto está completa por evidencia combinada. Las 132 identidades E2E distintas tienen PASS (55 casos previos/focales más los 77 restantes en una corrida de 77/77, retries 0); no se afirma un solo full run local 132/132. La cobertura unitaria también es combinada: 357 PASS/1 fallo por expectativa de ruta Auth obsoleta y 11/11 focales corregidas con 10 casos solapados, es decir 358 casos distintos cubiertos, no una suite única 358/358 verde. Integration completa 142/142 (1077 assertions) desde `82a75f3`, donde la aplicación/schema ya no cambiaron. Formatter, lint, typecheck (0 errores/0 warnings/245 hints), Drizzle checks/generate sin cambio de schema y build del head PASS. Los límites y la cronología están en [`TESTING.md`](TESTING.md).

El gate local combinado está completado; quedan bloqueadas publicación y validación remota. El push Git y las escrituras GitData REST reportaron HTTP 500; el publicador detuvo los intentos. No se afirma recuperación del servicio, CI remoto ni promoción. `master`/producción permanecen en Fase 7 `4afa485` y ledger cloud 21; no hubo nuevas migraciones, despliegues ni escrituras canónicas. La documentación acompaña el PR cohesivo de correcciones; no abrir un PR exclusivamente documental. La planificación y el alcance aún no implementado de Fase 8 permanecen abajo.

## PREPARACIÓN DE CORRECCIONES APROBADAS Y FASE 8 (2026-10-07)

El usuario aprobó un bloque acotado de correcciones administrativas y el alcance funcional inicial de Fase 8, incluida la gestión de múltiples cuentas ADMIN con permisos iguales. Los acuerdos de Fase 8 son **planificación**, no evidencia de implementación; las correcciones previas F7 sí están implementadas en fuente y su gate combinado sigue pendiente (estado arriba). Las decisiones aprobadas no autorizan ampliar el alcance a certificados de Fase 9.

### Orden de entrega y reglas de trabajo

1. Documentar los acuerdos antes de implementar; la implementación puede empezar antes de integrar esta documentación a `development`. Incluirla con el PR cohesivo final de correcciones (no crear un PR solo documental).
2. Abrir y cerrar primero una entrega independiente de correcciones post-release de Fase 7 sobre `development`; promoverla a `master` solo tras el gate verde. Mantener intactas las protecciones y los checks requeridos.
3. Empezar Fase 8 después de esa promoción, como milestone y release separados; no mezclar las correcciones F7 con cierre/planilla y gestión ADMIN.
4. Cada corrección o feature se trabaja en su propia rama y PR hacia `development`. Integrar primero infraestructura reutilizable de edición inline/feedback antes de sus consumidores. Definir y validar el contrato/backend atómico de calificaciones antes de modificar su UI.
5. Las reglas de búsqueda/conversión de interesados y cierre pertenecen a dominio/aplicación/repositorio y adaptadores de servidor; React no decide identidad, elegibilidad ni permisos. Las rutas HTTP deben reutilizar los casos de uso, no duplicar reglas.
6. No iniciar escritura canónica, migración aplicada, seed de calificaciones ni envío de correos durante esta preparación. No atribuir datos reales ni el estado de producción a fixtures.

### Correcciones administrativas y alcance Fase 8 aprobados

- **Cancelar voluntariamente una preinscripción:** cuando la política del servidor haga imposible cancelar, omitir el botón. No sustituirlo por texto explicativo ni abrir un diálogo. El deadline existente del servidor no cambia.
- **Conversión desde interesados:** al registrar una preinscripción, buscar solo filas `ACTIVE` de interesados del curso seleccionado; no ofrecer resultados del directorio global de participantes. Una fila de interés ya vinculada a cualquier registro de preinscripción está consumida aunque este se cancele, y no vuelve a aparecer al reactivar el interés. La exclusión aplica en listados operativos, métricas, búsquedas y opciones de prellenado; conservar la fila y su vínculo histórico. Registrar preinscripción y vínculo de origen en una transacción. Buscar por CI, email y nombre con normalización tolerante a acentos, mayúsculas/minúsculas y espacios. La CI normalizada sigue siendo la identidad única del participante; ni email ni nombre fusionan personas. La conversión consume solo el interés seleccionado de ese curso: preservar intereses independientes de esa persona en otros cursos y su historial. La entrada manual de persona sigue disponible; ante una CI ya existente, la validación server-side reutiliza/protege la identidad global sin duplicarla.
- **Escritura de notas por fila:** una operación sobre una fila de participante debe persistir atómicamente todas las calificaciones modificadas de esa fila. La edición visual sigue siendo por atributo/celda. Un componente vacío significa nota pendiente, nunca cero automático. Limpiar una nota existente no es una operación de borrado autorizada por este alcance.
- **Cierre del grupo:** exigir que todas las sesiones estén finalizadas, las notas requeridas de todas las personas `INSCRITO` estén completas y la asistencia esté resuelta. Sesiones canceladas son resolución válida y no deben reabrirse para cerrar. No inventar marcas faltantes ocultas. Elegibilidad/racha de asistencia se refleja en el resultado como información, pero no bloquea el cierre. Pagos/saldo tampoco se convierten en condición académica adicional.
- **Cierre, reapertura y congelamiento:** instructor solo puede cerrar grupos de cursos propios; `ADMIN` puede cerrar cualquiera. Solo `ADMIN` puede reabrir, aportando motivo obligatorio y dejando auditoría. Cerrado, cualquier escritura de nota o asistencia queda rechazada en servidor, incluidas mutaciones indirectas que alteren la evidencia oficial. Reapertura permite correcciones controladas y luego un nuevo cierre; las versiones ya emitidas permanecen inmutables. El congelamiento de esquema/pesos de Fase 7 permanece permanente según el contrato actual y no se revierte al reabrir.
- **Planilla y reporte de cierre:** ofrecer PDF y CSV del grupo con participantes, componentes/notas, resultado y elegibilidad final; PDF agrega un resumen de resultados y asistencia. Cada cierre crea una versión inmutable con instante y actor. La versión conserva UUID y nombre del actor tal como se mostraban al cerrar, sin resolver el nombre dinámicamente desde el perfil actual. Reabrir y volver a cerrar crea una versión nueva, sin sobrescribir la anterior. No se requiere formato institucional ni firma en este alcance. La emisión/gestión de certificados sigue en Fase 9.
- **Cuentas ADMIN (aprobado para esta misma Fase 8):** todos los ADMIN tienen los mismos permisos; no existe rol `ROOT` ni privilegio especial del primero. Un ADMIN crea otro usuario ADMIN desde servidor y establece la contraseña inicial usando Supabase Auth privilegiado, siguiendo el patrón seguro existente. La contraseña no se persiste ni se incluye en logs, DTOs o auditoría. Después, el usuario cambia su propia contraseña mediante el flujo existente. La UI y el servidor ofrecen una sola acción válida: eliminar solo si la cuenta nunca tuvo actividad de actor ni dependencias históricas; si tuvo actividad, solo desactivar/reactivar. Preservar siempre el UUID actor y el historial de auditoría, finanzas, asistencia, notas y cierres. Impedir operaciones concurrentes que dejen cero ADMIN activos. No quitar roles incidentalmente, convertir ADMIN en instructor ni crear/editar perfil de instructor.

### Correcciones UX aprobadas e implementadas en fuente (gate final pendiente)

- **Edición inline compartida (PR 260 + head actual):** se integraron lápiz/guardar/cancelar por atributo, posición estable, dirty/validación y feedback accesible por campo. Pending conserva SVG/control; errores y conflictos recuperables permanecen inline. Head `d057d2d` armoniza operaciones/canales de feedback y navegación.
- **Instructor y perfil (PR 264):** nombre visible como texto y correo de solo lectura sin apariencia de control editable; información personal precede al aviso/cursos asignados; se centra tarjeta global y fila de Google.
- **Esquema y notas (PR 262):** editor de pesos draft permite 0–100 con hasta dos decimales, presupuesto restante excluyendo campo actual, redistribución y guardado global solo al 100 %. Se simplificó copy y navegación. La edición del esquema sigue congelada tras primera nota. La UI de notas usa filas, wrap y búsqueda por nombre; el contrato interactivo guarda la fila atómicamente (PR 258), con fallback HTML por nota individual.
- **Grupos, participantes y roster (PRs 261/263):** grilla de dos columnas desktop/una mobile, horario/capacidad alineados y CTA full-width. Las páginas UI duplicadas de `/app/participantes` se retiraron y las mutaciones se movieron al contexto de preinscripción; la ficha global por CI y su historia financiera/multi-curso permanecen. El selector muestra registro compacto y opción de registrar otra persona; conserva alta/búsqueda manual por CI sin directorio global de candidatos. Roster ADMIN pagina en servidor y busca ampliamente; instructor busca solo nombres. No se ofrece acción exclusiva para `INSCRITO` ni se ocultan otros estados.
- **Calendario (PR 261):** filtros desktop sticky, combinaciones de fecha/estado y vistas que incluyen `IN_PROGRESS`; reset de fecha conserva estado; controles full-width y mobile compacto/accesible. Se redujeron encabezados duplicados de sesiones.
- **Navegación y feedback (head `d057d2d`):** breadcrumbs revisados para padres existentes de curso/grupo/esquema; no quedan enlaces privados a las rutas UI retiradas. Los mensajes persistentes de campo/conflicto no se duplican con Sileo; se mantienen IDs/canales de notificación y botones coherentes.

### Secuencia de implementación y validación (pendiente)

- **Antes del release de correcciones:** la QA local combinada del head `6b87d24` está completa; publicar el cambio pendiente y pasar el CI remoto full requerido antes de integrar/promover. No inferir cierre del gate remoto a partir de validaciones locales por stage.
- **Después del release, para iniciar Fase 8:** implementar lifecycle ADMIN de acuerdo con los límites técnicos confirmados abajo: outbox durable para Auth, detección de actividad actor/dependencias y serialización del último ADMIN; no hacer llamadas Auth dentro de una transacción DB larga.
- Las correcciones inline, atomic-row, participantes/preinscripción, roster/calendario, perfil y navegación ya están implementadas en fuente y con verificaciones focales por PR/stage (arriba y en [`TESTING.md`](TESTING.md)); no volver a presentarlas como pendientes de diseño. La integración documental acompaña el último PR cohesivo.
- Para cierre/planilla, implementar primero dominio/aplicación/repositorio y autorización/auditoría/transacciones; cubrir invariantes con pruebas unitarias e integración focales. Después conectar adaptadores HTTP/SSR y UI. La mutación de notas debe reutilizar la escritura atómica por fila ya disponible.
- Probar en foco: notas de fila atómicas/revisión/conflicto y vacíos; filtro/consumo de interesado y conversión preservando historial; permisos/ownership y bloqueo de todas las escrituras al cierre; requisitos de reapertura/motivo/auditoría; sesiones canceladas/resueltas y asistencia; snapshots de cierre, versiones repetidas e inmutabilidad.
- Reutilizar las suites existentes; no añadir E2E frágiles basadas en CSS/copy. QA UI manual con Playwright CLI en desktop/mobile, light/dark, tabla/lista, teclado, estados dirty/invalid/error y loading. Solo datos sintéticos aislados; ningún write de calificaciones a datasets canónicos.
- En el gate del milestone completo ejecutar formatter, lint, typecheck, unit, integration, E2E y build. Registrar flakiness y resultados por separado; no aceptar retries como pass silencioso, `force`, ni reruns que oculten fallos. Requerir checks remotos green antes de `master`; la autorización del usuario para omitir una aprobación administrativa no omite CI ni altera branch protections.

### Límites técnicos confirmados y detalle operativo pendiente de implementar

- El interesado consumido es la fila de interés de **ese curso**; no se hace archive ni deduplicación global por persona sobre intereses de otros cursos. La conversión conserva fuente/vínculo e historial y el estado de preinscripción —incluido `CANCELLED`— impide que esa fuente reaparezca en cualquier lista operativa, métrica o búsqueda. Una reactivación de la fila no revierte el consumo. La escritura de registro y link de origen es transaccional. No hay preguntas de alcance pendientes sobre esta regla.
- El backend owner confirmó la arquitectura de lifecycle para cuentas ADMIN. En el mismo patrón seguro ya usado con instructores: comenzar la baja con estado `DISABLED` y evento durable de outbox; borrar la identidad Auth fuera de la transacción larga; después retirar los roles/accesos aplicables, manteniendo `users` como tombstone y conservando outbox/auditoría. Reintentar solo cuando Auth informa que la identidad ya no existe (`user_not_found`); nunca recrear Auth al fallar una etapa posterior. Es una extensión aditiva del outbox si el actual no cubre ADMIN. No borrar físicamente la fila `users`.
- La política de acción ADMIN es más restrictiva que el lifecycle actual de instructores: eliminar cuenta únicamente si nunca fue actor ni tiene dependencia histórica; si tuvo actividad, la única opción es desactivar/reactivar. La autorización debe comprobar una sesión/actor activo y vigente. La señal de uso es actividad como **actor** o dependencia propia: `audit_events.actor_id`, historial de creación/asignación de cursos, `settings.updated_by`, campos de actor de preinscripciones/cancelaciones, actores de ledger financiero/command receipts, cancelación/revisión de roster/marcas/receipts de asistencia, campos `updated_by`/`recorded_by` y receipts de evaluaciones, actores de bajas anteriores y snapshots/cierres/reaperturas F8. Una entidad cuyo target/subject coincida con ese usuario pero cuya acción realizó otro actor no cuenta por sí sola como actividad propia. No eliminar auditoría, ledger, receipts ni dependencias para habilitar el borrado. Login aislado no cuenta como uso ni obliga por sí solo a retener/dejar sesión Auth.
- Comprobar cada cuenta en servidor y exponer solo la acción aplicable. Coordinar el chequeo de actividad con mutaciones de negocio que escriben `actor_id`/dependencias mediante lock de actor compatible con esas escrituras. Serializar lifecycle ADMIN globalmente, revalidar actor/sesión/revisión/estado y el conteo de ADMIN activos bajo el guard antes de desactivar o eliminar; mantener al menos uno activo incluso con concurrencia. No mantener una transacción DB abierta mientras se llama Auth.
- La defensa del último ADMIN sí está aprobada. No se ha aprobado una prohibición general de auto-baja; no introducirla como requisito. El login aislado no constituye actividad que fuerce conservar la cuenta. La implementación debe respetar el guard y la autorización vigente.

Fase 8 solo podrá marcarse implementada cuando exista evidencia de sus PRs, pruebas, revisión de datos y release; el acuerdo y esta planificación no equivalen al milestone completado.

### Objetivos

- Permitir esquema de evaluación configurable.
- Permitir múltiples componentes.
- Definir porcentajes.
- Validar que total sea 100 %.
- Registrar calificaciones.
- Calcular nota final.
- Manejar evaluación teórica, práctica o mixta.

### Resultado demostrable

Instructor configura evaluación y el sistema calcula resultados finales.

## FASE 8 — CIERRE DE CURSO

### Objetivos

- Determinar elegibilidad.
- Cerrar calificaciones.
- Generar planilla.
- Registrar informe de finalización.
- Impedir cambios no autorizados posteriores al cierre.
- Permitir reapertura controlada si la política lo permite.

### Resultado demostrable

Administración completa el cierre administrativo y académico.

## FASE 9 — CERTIFICADOS

### Objetivos

- Generar certificado PDF.
- Generar credential ID.
- Generar QR.
- Mantener estado de firma.
- Permitir carga del certificado firmado.
- Calcular hash.
- Publicar verificación.
- Descargar certificado.
- Revocar.
- Reemplazar.

### Resultado demostrable

Un tercero puede verificar un certificado real mediante una URL pública.

## FASE 10 — REPORTES, HARDENING Y CALIDAD

### Objetivos

- Reportes requeridos.
- Auditoría.
- Revisión de seguridad.
- Revisión de accesibilidad.
- Revisión responsive.
- Performance.
- Estados vacíos y loading.
- Validación completa de archivos.
- Limpieza de deuda técnica.
- Pruebas de regresión.

### Resultado demostrable

Release candidate listo para adopción.

## REGLA DE AVANCE

Una fase no requiere que absolutamente todo lo anterior esté cerrado, pero ninguna funcionalidad debe avanzar dejando roto el flujo principal.

Cada milestone debe incluir:

- implementación;
- tests;
- build exitoso;
- documentación actualizada;
- demostración funcional.

## FUERA DE ALCANCE INICIAL

- LMS.
- Recursos educativos.
- clases virtuales.
- videoconferencia.
- foros.
- entrega completa de tareas como plataforma educativa.
- aplicación móvil nativa.
- aplicación desktop.
- microservicios.
- firma criptográfica avanzada del PDF en MVP.
