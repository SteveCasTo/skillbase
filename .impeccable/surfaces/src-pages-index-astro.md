---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: []
---

# Landing pública

## Scope

- Target: `src/pages/index.astro`.
- Visitor mode: Persuade.
- Audience: estudiantes de la UMSS y personas externas interesadas en formación continua, con igual prioridad.
- Job: encontrar convocatorias publicadas, entender su disponibilidad y comparar fecha, nivel y duración antes de explorar el detalle de un curso.
- Primary action: `Explorar cursos`.
- Secondary actions: `Ver curso`, `Verificar certificado` y, con menor prominencia, `Acceso del equipo`.

## Content And States

- Los cursos y sus estados son la evidencia principal y deben aparecer desde el primer viewport.
- La landing admite datos sintéticos temporales, claramente sustituibles por el contrato público real. `?preview=courses&count=` permite revisar entre 1 y 20 elementos y `palette=warm` conserva la exploración cálida, sin convertir ese preview marcado `noindex,nofollow` en oferta real.
- Debe resolver oferta disponible, mezcla de estados, ausencia de cursos, carga y error.
- La preinscripción expresa interés y no equivale a una inscripción definitiva.
- No inventar estadísticas, testimonios, acreditaciones, respaldo institucional ni información comercial.

## Selected Direction

**Cota Activa.** Una visualización territorial sitúa la formación continua frente al Tunari y la conecta con infraestructura, trazados topográficos y una ruta de señal naranja. La imagen principal gobierna el sistema completo; la convocatoria vigente aparece como evidencia operativa dentro de ese territorio, no como una tarjeta superpuesta.

La oferta adopta la composición **Cartelera editorial**, seleccionada el 2026-09-18. Una convocatoria panorámica domina la sección y las restantes funcionan como afiches secundarios. La transición desde el hero vuelve a solaparse con un desplazamiento negativo y un degradado translúcido. La capa actual usa artwork local a sangre para muestras sintéticas y una placa gráfica Cota Activa cuando el curso no tiene artwork; `assets/plates/course-python-preview.jpg` es la muestra de `fundamentos-de-python` y su procedencia (Unsplash, 2026-09-22) está en `assets/plates/course-python-preview.provenance.md`. El picker y upload/storage administrativo de imágenes reales siguen pendientes.

## Direction Contract

**THESIS:** La oferta publicada es una señal activa dentro de un territorio tecnológico local. Rechaza tanto la landing universitaria solemne como el kit de tarjetas SaaS y evita representar innovación mediante clichés de stock.

**OWN-WORLD:** Papel mineral, cielo de altura, azul de plano técnico, tinta profunda y naranja de señal. Una imagen territorial de Cochabamba, líneas topográficas, reglas finas y campos de datos abiertos forman el lenguaje; no hay pills promocionales, cards elevadas ni ornamento tecnológico genérico.

**STORY:** El visitante reconoce Cochabamba y el contexto universitario, identifica inmediatamente la oferta vigente, compara sus datos y sigue una ruta clara desde la convocatoria hasta una futura credencial verificable.

**FIRST VIEWPORT:** Header técnico y compacto sobre una escena panorámica casi completa. El titular ocupa la zona mineral izquierda y la imagen concentra campus, valle, Tunari e infraestructura hacia el centro y la derecha. La oferta continúa como una cartelera editorial: convocatoria panorámica dominante con estado, título, resumen, fecha, nivel, duración y acción, sin precios ni horario detallado; los cursos restantes aparecen como afiches secundarios.

**FORM:** `Cota Activa` se materializa en `cota-activa-desktop.png` y `cota-activa-mobile.png`. La sección de oferta usa Cartelera editorial, opción aprobada en `.impeccable/mocks/decision/editorial-billboard.png`, y rechaza una retícula uniforme de cards. Las piezas son redondeadas, suaves y sin marco exterior visible; cada curso se presenta como un enlace de tarjeta completa con CTA visual de botón. Desktop organiza una pieza panorámica y afiches secundarios con tres variantes de trío que ciclan sus proporciones y desplazamientos; tablet normaliza los afiches en dos columnas y mobile los recompone en una columna de igual ancho, con artwork 4:3. Las filas usan tríos, dos pares cuando quedan cuatro y una fila completa cuando queda un único curso. La implementación y su revisión responsive están verificadas.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

**MOTION:** La línea de señal organiza una única familia de movimiento: la portada adquiere foco al cargar, la banda de convocatoria se fija al territorio y los bloques editoriales se revelan al entrar al viewport mediante recorte, enfoque y opacidad. El header nace transparente sobre el territorio y adquiere una superficie flotante al desplazarse; en mobile se oculta al bajar y reaparece al subir. Todo el contenido permanece visible sin JavaScript y `prefers-reduced-motion` elimina animaciones, transiciones y transformaciones decorativas.

**COLOR STUDY:** La paleta azul mineral permanece como versión principal. En desarrollo, `?preview=courses&palette=warm` activa una exploración separada que remapea las superficies a los tokens arena, coral y naranja del sistema sin duplicar contenido ni comportamiento.

Dark y warm-dark conservan el copy de hero y footer vinculado a las placas luminosas existentes; no introducen placas oscuras alternativas. El bloque de certificados pasa al footer con un fade superior sutil.

## Open Decisions

- Completar el modelo de Tipos de curso y revisiones inmutables antes de cerrar Fase 2B.
- Sustituir el artwork local de preview por fotografía propia autorizada con upload/storage administrativo real; el fallback Cota Activa ya existe para cursos sin artwork.
- Validar la cartelera con rangos de cursos reales cuando exista oferta institucional, manteniendo la regla 1..20 para previews locales.
- Validar si la ilustración del campus se integra al footer después de confirmar procedencia, fidelidad y derechos de uso.
- No buscar ni incorporar logotipos institucionales salvo que la composición aprobada realmente los necesite y exista autorización de uso.
