# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El público principal de la experiencia pública son, con igual importancia:

- estudiantes de la Universidad Mayor de San Simón;
- personas externas a la universidad interesadas en formación continua.

Los estudiantes que además participan como auxiliares de laboratorio forman un caso sujeto a una política de descuento, no una audiencia principal separada. La regla conocida del 50 % está pendiente de definir/verificar en el flujo de elegibilidad e inscripción; el producto todavía no calcula ni publica un precio de auxiliar.

También interactúan con el producto:

- administradores responsables del ciclo operativo completo;
- instructores responsables de los grupos asignados;
- terceros que necesitan verificar certificados.

## Product Purpose

Centralizar el ciclo administrativo y académico de cursos de formación continua: publicación, preinscripción, organización de grupos, inscripción administrativa, seguimiento de pagos, asistencia y evaluación, cierre, certificación y verificación pública.

El producto busca reducir tareas manuales, mantener trazabilidad y ofrecer una fuente web oficial con información vigente. No es un LMS y no gestiona clases virtuales, contenidos educativos, foros ni repositorios de material.

Durante el desarrollo, la experiencia pública debe comunicar el flujo objetivo completo como una capacidad integrada, aunque varios módulos se implementen en fases posteriores. El estado técnico de cada módulo debe seguir documentándose de forma factual dentro del proyecto.

## Positioning

La publicación administrativa de un curso alimenta directamente su presencia pública sin duplicar información. El producto reúne en un mismo flujo la operación de formación continua y la futura emisión de credenciales verificables, con trazabilidad desde la publicación hasta la certificación.

La landing y el catálogo constituyen la fuente web oficial de información vigente para los cursos publicados por la unidad responsable.

## Operating Context

- La unidad institucional responsable confirmada es el Departamento de Informática y Sistemas de la Facultad de Ciencias y Tecnología de la Universidad Mayor de San Simón. No es necesario identificar públicamente un laboratorio específico.
- La operación y la comunicación pública se realizan en español y en contexto boliviano.
- Los importes se expresan en bolivianos (`BOB`).
- Las fechas y horas públicas usan el tiempo civil de Bolivia (`America/La_Paz`).
- Los cursos también pueden difundirse por redes sociales, vitrina del departamento y WhatsApp, pero el producto no automatiza esos canales en el MVP.
- Las fechas y el horario del curso publicado son información pública provisional; los grupos posteriores definen su calendario operativo.
- Una preinscripción sirve para estimar demanda y no equivale a una inscripción definitiva.

## Capabilities and Constraints

- Objetivo editorial público aprobado: las tarjetas de landing muestran disponibilidad, título, descripción breve, inicio/fecha, nivel y duración. No muestran los dos precios detallados ni el horario detallado; el horario exacto, las condiciones y los precios diferenciados deberán vivir en el futuro detalle `/cursos/[slug]`.
- Los niveles iniciales son básico, medio y avanzado.
- Solo los cursos publicados pueden aparecer públicamente; borradores, cursos retirados y archivados permanecen ocultos.
- La disponibilidad de preinscripción puede ser no disponible, próxima, abierta o cerrada y se deriva de una ventana de fechas.
- Cada curso conserva una URL estable mediante un slug inmutable.
- Los precios de curso distinguen `STUDENT` y `EXTERNAL` y usan `BOB`.
- Los auxiliares de laboratorio elegibles pagan el 50 % del precio para estudiantes. La interfaz no debe calcular ni prometer este precio hasta que la elegibilidad y la regla estén implementadas en el sistema.
- Durante desarrollo y en despliegues de prueba se permiten cursos sintéticos completos para modelar la experiencia con oferta. Deben poder sustituirse por datos reales sin cambiar la landing.
- La experiencia pública debe contemplar explícitamente el escenario sin cursos publicados o disponibles y no depender de que existan datos sintéticos.
- La capa de presentación admite artwork local de preview para muestras sintéticas y fallback gráfico de Cota Activa; la administración también dispone de un flujo de carga de artwork autorizado a Storage. No se deben interpretar los previews locales como fotografías de cursos reales.
- El flujo objetivo incluye preinscripción, grupos, inscripciones, pagos administrativos, asistencia, evaluaciones, cierre, certificados, identificadores públicos, QR, descarga y revocación.
- La verificación pública debe permitir comprobar una credencial sin exponer datos personales innecesarios.
- La primera versión no requiere necesariamente una cuenta autenticada para participantes.
- La implementación actual incluye gestión administrativa con formatos y revisiones inmutables, contrato de lectura pública, landing/cartelera, catálogo `/cursos` y detalle SSR `/cursos/[slug]`. La landing muestra disponibilidad, fecha, nivel y duración, y reserva horario detallado/precios diferenciados para el detalle. El horario informativo sigue persistido como texto aunque el formulario ofrezca un constructor por días/horas. Los módulos posteriores del ciclo (incluida preinscripción y elegibilidad/descuento de auxiliares) aún no están implementados. La verificación actual de CI remoto y cloud no se afirma aquí.
- El nombre `SkillBase` es provisional y debe permanecer desacoplado de reglas de negocio, datos persistidos e integraciones para permitir un cambio posterior.

### Decisión de producto implementada

- La administración gestionará **Tipos de curso** o formatos de curso. Cada tipo definirá una duración y los precios `STUDENT` y `EXTERNAL` en `BOB`.
- Cada curso deberá seleccionar un tipo y no podrá sobrescribir sus horas ni precios.
- Las modificaciones de un tipo se expresarán mediante revisiones inmutables: los cursos borrador/no publicados adoptarán la revisión vigente, mientras que los publicados y archivados conservarán exactamente la revisión utilizada.
- Los tipos podrán activarse o desactivarse sin alterar las revisiones históricas ni los cursos que ya las utilizan.
- El modelo está implementado mediante `course_types` y `course_type_revisions`; la migración preserva términos históricos y el seed local ofrece formatos de ejemplo editables. Esta decisión no implica que el gate ampliado de Fase 2B o su verificación remota estén cerrados.

## Brand Commitments

- `SkillBase` es el nombre provisional del producto, no una marca definitiva.
- La unidad institucional confirmada es el Departamento de Informática y Sistemas de la Facultad de Ciencias y Tecnología de la Universidad Mayor de San Simón.
- El tono debe tratar la información publicada como oficial y vigente, sin fabricar respaldo, logros ni evidencia.
- El repositorio no contiene todavía autorización ni activos oficiales de identidad institucional.

## Evidence on Hand

- `README.md` y `docs/REQUIREMENTS.md` documentan propósito, actores, flujo completo y reglas de negocio.
- `docs/PLAN.md` documenta el alcance y estado de Fase 2A y Fase 2B.
- `docs/DECISIONS.md` confirma el nombre provisional y el contrato editorial de cursos.
- `src/application/courses/course-repository.ts` y `src/server/db/repositories/course-repository.ts` contienen el contrato público, la proyección de formatos y las lecturas SSR.
- `src/pages/index.astro`, `src/pages/cursos/index.astro` y `src/pages/cursos/[slug].astro` contienen landing, catálogo y detalle; no constituyen contenido institucional aprobado.
- Los assets gráficos y el artwork local de preview son provisionales y de desarrollo. Existe un flujo administrativo de upload/storage, pero no hay prueba de fotografías de cursos reales autorizadas ni activos oficiales de identidad institucional.
- No hay cursos reales, estadísticas, testimonios, casos de éxito, fotografías de cursos autorizadas, logotipos institucionales, acreditaciones ni certificaciones comerciales aprobadas en el repositorio. Se permiten cursos sintéticos y artwork local como datos temporales de desarrollo, pero no constituyen evidencia institucional ni oferta académica real.

## Product Principles

- Mantener una única fuente oficial y vigente para la información pública de cursos.
- Conectar publicación, operación académica y certificación sin convertir el producto en un LMS.
- Diferenciar claramente los tipos de participante solo cuando afecten información o condiciones reales, como precios y elegibilidad.
- Preservar trazabilidad, seguridad y privacidad a lo largo de todo el ciclo.
- No fabricar prueba social, respaldo institucional ni información comercial; distinguir los datos sintéticos temporales de la oferta académica real.

## Accessibility & Inclusion

- La experiencia debe ser responsive y aspirar a WCAG 2.2 AA.
- Debe funcionar con teclado, zoom, foco visible, contraste suficiente y `prefers-reduced-motion`.
- La información no puede depender únicamente del color.
- La consulta pública debe ser accesible sin autenticación.
