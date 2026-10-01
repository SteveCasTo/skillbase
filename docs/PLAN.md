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
- [ ] Añadir perfiles y cuentas internas de instructores y asignar exactamente un instructor activo por curso; todos los grupos del curso heredan esa asignación.
- [ ] Restringir acceso de instructor a su perfil y cursos propios, también en rutas y consultas server-side.
- [x] Implementar login email/password junto con Google para usuarios internos, cambios/recovery de password y asociación Google explícita desde perfil.
- [x] Implementar el caso server-only de provisionamiento de cuenta INSTRUCTOR por ADMIN, con credencial solo en Supabase Auth y compensación ante fallo de persistencia interna; la UI ADMIN de altas/perfiles/asignaciones aún está pendiente.
- [ ] Gestionar cambio de instructor sujeto a calendario y conflictos de horario entre cursos.
- [ ] Resolver, antes de implementar, la regla de activar/desactivar instructores con cursos futuros asignados. No deducirla de una preferencia de UI.
- [ ] Gestionar reemplazo por feriados cuando existan sesiones y calendario operativo (Fase 6).
- [x] Permitir expresar preferencia de grupo en Fase 3; asignar inscritos a grupos en Fase 5, sin tratar la preferencia como asignación.

#### Contrato acordado para el módulo de instructores (planificado, no implementado)

- El ADMIN crea perfiles con nombre, apellido y email normalizado obligatorios; teléfono es opcional. El perfil público contiene únicamente nombre completo, sin descripción.
- La cuenta se crea por acción server-side del ADMIN con contraseña inicial elegida por el administrador. No es una invitación ni incluye onboarding/cambio forzado de contraseña. El instructor puede cambiarla desde perfil; esta edición es opcional.
- Un instructor puede vincular Google a la misma cuenta solo desde una sesión autenticada, mediante enlace explícito y correo verificado coincidente tras normalización. No se fusionan cuentas automáticamente. Un ADMIN existente conserva Google y puede configurar contraseña; no se incorpora gestión de creación de ADMIN.
- Instructor posee únicamente acceso a su perfil y a cursos asignados en esta fase. No obtiene acceso a formatos, interesados, participantes, usuarios ni ajustes. Asistencia y sesiones permanecen en Fase 6.
- Un curso tiene un único instructor asignado; la asignación es global al curso y la heredan todos sus grupos. Se elimina el nombre libre como fuente de identidad al completar el flujo.
- Se puede cambiar el instructor de un curso publicado antes del inicio oficial del curso; desde el inicio, el cambio queda bloqueado. El servidor es autoritativo y se conservan reglas existentes de retiro/archivo e historial/auditoría.
- Conflictos se comprueban para el mismo instructor entre cursos con calendario L–V que coincida en fecha y hora civil `America/La_Paz`; intervalos semiabiertos permiten turnos contiguos. Las escrituras concurrentes de asignaciones, cambios de fechas, creación/cambio de horario de grupos, estado y publicación deben compartir una estrategia transaccional de serialización para evitar carreras.
- El perfil mantiene identidad estable y referencias históricas de curso; no se borra físicamente un instructor usado. La política de activación/desactivación con asignaciones futuras está pendiente de aprobación antes de implementar ese aspecto.

#### Orden de entrega previsto

1. Definir y revisar migración aditiva, perfil de instructor e identidad Auth sin guardar contraseñas en tablas/logs; acordar política pendiente de activación.
2. Implementar dominio, repositorios y transacciones/auditoría para cuenta, perfil, asignación, ventana de cambio y conflictos concurrentes.
3. [x] Implementar autenticación combinada Google/email-password, enlace explícito Google a cuenta autenticada y cambio/recuperación de contraseña. Pendiente verificar SMTP real para recuperar por email; no bloquea aprovisionamiento/login inicial.
4. Añadir guards exactos para rutas de instructor y scoping por propiedad de curso en cada lectura/escritura server-side.
5. Implementar administración de perfiles/asignaciones y la experiencia privada de instructor; selector por instructores activos registrados, sin texto libre.
6. Actualizar seeds sintéticos/fixtures locales, ejecutar migración sin reset destructivo y completar validación antes de integrar PRs en `development`. PR 113 ya liberó Fase 3; no promocionar cambios de esta fase a `master` hasta la siguiente ventana de release.

La petición aprobada de renovación de datos es exclusivamente local y para datos de aplicación sintéticos: preparar un seed antes de aplicarlo, reemplazar formatos/cursos y datos operativos fake requeridos para fixtures, conservando cuentas/identidades Auth locales y configuración de proveedor/OAuth. Preservar la identidad ADMIN legítima salvo decisión explícita distinta; no resetear producción ni ejecutar reset ahora. El reset de producción queda como operación manual con aprobación en la siguiente release, no como paso de cada deploy. El seed debe cubrir varios instructores sintéticos con credenciales solo provistas server-side, cursos activos/cancelados, preferencias distintas y curso sin preferencias; nunca hardcodear contraseñas/secretos.

#### Pruebas y gate previstos

- Unitarias: normalización/validación del perfil y email, rol y matriz de acceso, intervalo previo/al inicio, conflicto de rangos semiabiertos y límite de turnos contiguos.
- Integración: transacciones de Auth + perfil interno, redacción de respuestas/logs, auditoría sin secretos, binding Google explícito con email verificado/mismatch, unicidad, ownership de consultas, conflicto entre cursos y carrera de escrituras concurrentes para asignación/fechas/grupos/publicación.
- E2E: login y recuperación/cambio de contraseña, enlace Google a misma identidad y rechazo de enlace no verificado/no coincidente, ADMIN crea instructor/asigna curso, instructor accede solo a su perfil/cursos y URL directa ajena es denegada; responsive, teclado y fallback sin JavaScript de formularios.
- Verificar datos de cuentas de fixtures sin credenciales hardcodeadas; revisar específicamente que ninguna respuesta o log transporte contraseña ni tokens. Confirmar configuración SMTP para recuperación en cloud antes de afirmar ese flujo listo.
- Cerrar con formatter, lint, typecheck, unit/integration/E2E, build, revisión de migraciones/privilegios/RLS y CI del PR en `development`; dejar despliegue de producción para la siguiente release.

El ajuste UX de interesados (copy del formulario, submit progresivo, tarjetas/barras de demanda y skeleton) se integró en PRs 116 y 117 a `development`; la verificación del frontend completo cerró 98/98 E2E. La evidencia local comunicada incluye 133 unitarias y 65 de integración. Esta mejora no completa los módulos pendientes de instructor/asignación.

#### Estado del bloque de autenticación dual

La implementación está en los commits `5613399`, `958053a` y `5ff585c` de `feat/dual-auth-and-profile`, sobre base `cf601d8`. El cambio de código no tiene todavía PR ni se ha integrado en `development`; no implica promoción a `master`, aplicación de migraciones, ni activación de Auth en cloud. Se considera completado únicamente el bloque de autenticación dual/cuenta interna, no Fase 4 en conjunto.

- [x] Google y email/password en login, verificación del método de sesión y autorización por identidad interna activa.
- [x] Perfil `/app/perfil` con cambio opcional de contraseña, confirmación por contraseña actual o correo, recovery y asociación Google opcional.
- [x] Provisionamiento server-side de cuenta de instructor mediante `createInstructorAccount(actorAuthUserId, { email, name, password })`; crea usuario Auth confirmado y usuario interno ACTIVE con rol INSTRUCTOR, con compensación si falla la transacción interna. Aún no hay pantalla ADMIN de alta ni asignación de instructores.
- [ ] Cerrar full E2E en curso; no declarar el gate completo. La cobertura dirigida Auth/Google/sidebar/mobile comunicada pasó 43/43; full E2E continúa ejecutándose en otro worktree.
- [ ] Integrar por PR a `development` después del gate y revisión; hasta entonces no aplicar cambios a producción.
- [ ] Antes de habilitarlo en cualquier entorno: aplicar Drizzle 0012/0013, habilitar hook `private_auth.allow_invited_google_signup` en la configuración Auth efectiva y configurar `AUTH_RATE_LIMIT_SECRET` server-only de al menos 32 caracteres. Configuración cloud y SMTP no están verificadas/aplicadas.

Estado local comunicado en el worktree de feature: 146 unit PASS, 71 integration PASS, lint PASS, typecheck PASS (0 errores/0 warnings/83 hints), build, Drizzle y formatter PASS; `git diff --check` PASS. Estos resultados no certifican el full E2E todavía en curso ni CI remota, integración a `development`, migración local compartida/cloud, SMTP, ni despliegue.

### Resultado demostrable

Administración transforma demanda en grupos operativos.

## FASE 5 — PREINSCRIPCIÓN PRESENCIAL Y GESTIÓN ADMINISTRATIVA

### Objetivos

- Registrar presencialmente a una persona como preinscrita, con pago parcial o total y ocupación de cupo; permitir registro directo o prellenar desde un interesado con datos editables.
- Diseñar el vínculo de origen con el interesado como explícito y trazable, sin inferir identidad global ni pago desde el registro público.
- No denominar este registro inscripción definitiva sin una regla posterior que confirme esa transición.
- Completar en esta fase los datos administrativos pendientes, incluido CI cuando se confirme su necesidad.
- Registrar tipo de participante.
- Registrar precio aplicado.
- Aplicar descuentos.
- Registrar condición de auxiliar.
- Registrar boleta/valorado si corresponde.
- Revertir inscripciones.
- Gestionar devolución por cancelación de grupo.
- Gestionar cambios de grupo y devoluciones en esta fase; no duplicar estas operaciones en Fase 3.
- Generar listados administrativos.

El registro público de interesados de Fase 3 no cobra ni ocupa cupo. La preinscripción presencial y pagada pertenece a esta fase; reglas de dinero —precio aplicado, descuentos, pagos, documentos/boleta y devoluciones— permanecen en su alcance y sus detalles pendientes de definición no se adelantan aquí.

### Resultado demostrable

Administración puede mantener la lista de preinscripciones presenciales con pagos parciales o totales y cupos ocupados. Su eventual paso a inscripción definitiva requiere una regla posterior.

## FASE 6 — SESIONES Y ASISTENCIA

### Objetivos

- Crear calendario de sesiones.
- Registrar asistencia.
- Registrar asistencia del instructor.
- Manejar sesiones de reemplazo.
- Calcular porcentaje.
- Señalar faltas continuas.
- Mostrar alertas operativas.

### Resultado demostrable

Instructor gestiona asistencia diaria de un grupo.

## FASE 7 — EVALUACIONES Y NOTAS

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
