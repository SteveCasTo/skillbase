# DESIGN

## OBJETIVO

Definir las reglas visuales y de experiencia de usuario para mantener una interfaz coherente, accesible, responsive y mantenible.

El diseño debe priorizar claridad operativa sobre ornamentación.

## STACK DE UI

- Astro.
- React para interacción.
- Tailwind CSS.
- shadcn/ui como base de componentes.
- Lucide para iconografía cuando corresponda.
- Sileo como sistema principal de toast, sujeto a validaciones de accesibilidad.

Los componentes añadidos mediante shadcn/ui pasan a formar parte del código del proyecto y pueden adaptarse al sistema visual.

## PRINCIPIOS

- Mobile-first cuando sea práctico.
- Diseño responsive obligatorio.
- HTML semántico.
- Accesibilidad desde implementación inicial.
- Consistencia antes que personalización aislada.
- Reutilizar componentes existentes.
- Evitar UI nativa inconsistente si existe un componente equivalente del design system.
- Minimizar carga cognitiva.
- Evitar interfaces saturadas.
- Mantener jerarquía visual clara.
- Diseñar todos los estados: loading, empty, error, success y disabled.

## RESPONSIVE

Toda interfaz nueva debe validarse al menos en:

- mobile;
- tablet;
- desktop.

No asumir que una vista administrativa será usada únicamente en escritorio.

Evitar ancho fijo salvo necesidades justificadas.

Evitar scroll horizontal como solución por defecto.

## TABLAS

No utilizar tablas como única presentación de información crítica cuando el contenido deba funcionar en mobile.

Cuando una tabla sea apropiada en desktop:

- mantener columnas esenciales;
- permitir ocultar información secundaria;
- considerar cards o listas en mobile;
- evitar tablas con demasiadas acciones por fila;
- no introducir horizontal scroll si puede evitarse mediante una representación alternativa.

Las tablas siguen siendo válidas para datos genuinamente tabulares.

## MODALES

Usar `Dialog` únicamente para:

- confirmaciones;
- formularios cortos;
- decisiones de alcance limitado;
- información contextual breve.

No usar modales extensos para flujos importantes.

Formularios complejos deben preferir páginas dedicadas.

En mobile puede utilizarse `Drawer` o `Sheet` cuando mejore la interacción.

## FEEDBACK

### Toast

Sileo es la opción propuesta para notificaciones transitorias.

Usar toast para:

- confirmación breve de una acción;
- información no bloqueante;
- fallos recuperables que no requieran explicación extensa.

No usar toast como único lugar para:

- errores de formulario;
- información crítica;
- instrucciones extensas;
- decisiones que el usuario deba revisar después.

Los errores de campo deben mostrarse junto al campo.

Los errores de página deben permanecer visibles.

### Accesibilidad de toast

Verificar:

- anuncio adecuado por tecnologías asistivas;
- foco no secuestrado;
- tiempo suficiente de lectura;
- comportamiento correcto con `prefers-reduced-motion`;
- contraste;
- que no dependa únicamente del color.

## LOADING

### Skeletons

Los skeletons son el patrón preferido cuando se conoce la estructura aproximada del contenido.

Usar skeletons para:

- cards;
- listados;
- cabeceras;
- paneles;
- bloques de información.

Evitar skeletons que simulen contenido inexistente de forma engañosa.

Usar spinner únicamente cuando:

- la estructura no sea conocida;
- la acción sea pequeña;
- el feedback sea local.

Evitar bloquear toda la página por operaciones pequeñas.

## EMPTY STATES

Todo listado puede quedar vacío.

Un empty state debe explicar:

- qué falta;
- por qué puede estar vacío;
- cuál es la siguiente acción cuando exista una.

Evitar mensajes como `No data`.

Preferir mensajes contextualizados.

## HTML SEMÁNTICO

Preferir elementos semánticos:

- `header`
- `nav`
- `main`
- `section`
- `article`
- `aside`
- `footer`
- `form`
- `fieldset`
- `legend`
- `label`
- `button`
- `table` cuando el contenido sea realmente tabular.

No usar `div` clickable como botón.

No usar `span` como control interactivo.

Mantener una jerarquía correcta de encabezados.

Cada página debe tener un `h1` coherente.

## ACCESIBILIDAD

Objetivo: WCAG 2.2 AA cuando sea razonable.

Requisitos mínimos:

- navegación por teclado;
- foco visible;
- contraste adecuado;
- labels asociados;
- nombres accesibles;
- estados `disabled` comprensibles;
- no depender únicamente de color;
- landmarks semánticos;
- mensajes de error asociados;
- tamaños de objetivo táctil adecuados;
- contenido comprensible con zoom;
- respeto a `prefers-reduced-motion`;
- iconos decorativos ignorados por lectores de pantalla;
- iconos funcionales con nombre accesible.

No usar placeholder como sustituto de label.

## COMPONENTES NATIVOS

Evitar:

- `window.alert`;
- `window.confirm`;
- `window.prompt`.

Usar los componentes del design system.

Para selects, comboboxes y date pickers, preferir componentes coherentes con shadcn/ui cuando aporten mejor UX.

No reemplazar controles nativos accesibles por versiones complejas sin beneficio real.

## PALETA

La paleta base del proyecto utiliza OKLCH y se integra con Tailwind CSS y shadcn/ui.

Archivo recomendado: `src/styles/globals.css`.

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(0.9856 0.0084 56.3169);
  --foreground: oklch(0.3353 0.0132 2.7676);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.3353 0.0132 2.7676);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.3353 0.0132 2.7676);
  --primary: oklch(0.7357 0.1641 34.7091);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.9596 0.0200 28.9029);
  --secondary-foreground: oklch(0.5587 0.1294 32.7364);
  --muted: oklch(0.9656 0.0176 39.4009);
  --muted-foreground: oklch(0.5534 0.0116 58.0708);
  --accent: oklch(0.8278 0.1131 57.9984);
  --accent-foreground: oklch(0.3353 0.0132 2.7676);
  --destructive: oklch(0.6122 0.2082 22.2410);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.9296 0.0370 38.6868);
  --input: oklch(0.9296 0.0370 38.6868);
  --ring: oklch(0.7357 0.1641 34.7091);
  --chart-1: oklch(0.7357 0.1641 34.7091);
  --chart-2: oklch(0.8278 0.1131 57.9984);
  --chart-3: oklch(0.8773 0.0763 54.9314);
  --chart-4: oklch(0.8200 0.1054 40.8859);
  --chart-5: oklch(0.6368 0.1306 32.0721);
  --sidebar: oklch(0.9656 0.0176 39.4009);
  --sidebar-foreground: oklch(0.3353 0.0132 2.7676);
  --sidebar-primary: oklch(0.7357 0.1641 34.7091);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.8278 0.1131 57.9984);
  --sidebar-accent-foreground: oklch(0.3353 0.0132 2.7676);
  --sidebar-border: oklch(0.9296 0.0370 38.6868);
  --sidebar-ring: oklch(0.7357 0.1641 34.7091);
  --font-sans: "Montserrat", sans-serif;
  --font-serif: "Merriweather", serif;
  --font-mono: "Ubuntu Mono", monospace;
  --radius: 0.625rem;
  --shadow-2xs: 0 6px 12px -3px hsl(0 0% 0% / 0.04);
  --shadow-xs: 0 6px 12px -3px hsl(0 0% 0% / 0.04);
  --shadow-sm: 0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 1px 2px -4px hsl(0 0% 0% / 0.09);
  --shadow: 0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 1px 2px -4px hsl(0 0% 0% / 0.09);
  --shadow-md: 0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 2px 4px -4px hsl(0 0% 0% / 0.09);
  --shadow-lg: 0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 4px 6px -4px hsl(0 0% 0% / 0.09);
  --shadow-xl: 0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 8px 10px -4px hsl(0 0% 0% / 0.09);
  --shadow-2xl: 0 6px 12px -3px hsl(0 0% 0% / 0.22);
}

.dark {
  --background: oklch(0.2569 0.0169 352.4042);
  --foreground: oklch(0.9397 0.0119 51.3156);
  --card: oklch(0.3184 0.0176 341.4465);
  --card-foreground: oklch(0.9397 0.0119 51.3156);
  --popover: oklch(0.3184 0.0176 341.4465);
  --popover-foreground: oklch(0.9397 0.0119 51.3156);
  --primary: oklch(0.7357 0.1641 34.7091);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.3637 0.0203 342.2664);
  --secondary-foreground: oklch(0.9397 0.0119 51.3156);
  --muted: oklch(0.2848 0.0159 343.6554);
  --muted-foreground: oklch(0.8378 0.0237 52.6346);
  --accent: oklch(0.8278 0.1131 57.9984);
  --accent-foreground: oklch(0.2569 0.0169 352.4042);
  --destructive: oklch(0.6122 0.2082 22.2410);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.3637 0.0203 342.2664);
  --input: oklch(0.3637 0.0203 342.2664);
  --ring: oklch(0.7357 0.1641 34.7091);
  --chart-1: oklch(0.7357 0.1641 34.7091);
  --chart-2: oklch(0.8278 0.1131 57.9984);
  --chart-3: oklch(0.8773 0.0763 54.9314);
  --chart-4: oklch(0.8200 0.1054 40.8859);
  --chart-5: oklch(0.6368 0.1306 32.0721);
  --sidebar: oklch(0.2569 0.0169 352.4042);
  --sidebar-foreground: oklch(0.9397 0.0119 51.3156);
  --sidebar-primary: oklch(0.7357 0.1641 34.7091);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.8278 0.1131 57.9984);
  --sidebar-accent-foreground: oklch(0.2569 0.0169 352.4042);
  --sidebar-border: oklch(0.3637 0.0203 342.2664);
  --sidebar-ring: oklch(0.7357 0.1641 34.7091);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --font-sans: var(--font-sans);
  --font-serif: var(--font-serif);
  --font-mono: var(--font-mono);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

La paleta debe revisarse visualmente con contraste real antes de aprobarse como definitiva.

## TIPOGRAFÍA

Tipografías propuestas:

- Sans: Montserrat.
- Serif: Merriweather.
- Mono: Ubuntu Mono.
- Display de la landing pública `Cota Activa`: Alef en peso 700.

No utilizar `next/font` porque el proyecto no usa Next.js.

Preferir fuentes self-hosted o un mecanismo compatible con Astro.

La UI general debe usar Montserrat.

Alef es la voz de titulares, nombres de curso y acentos de identidad de la landing pública `Cota Activa`. Esta excepción pertenece únicamente a esa superficie y no redefine la tipografía de las vistas operativas, de autenticación ni de otras páginas públicas.

Merriweather debe reservarse para contenido editorial o acentos muy concretos.

Ubuntu Mono debe reservarse para códigos, identificadores y contenido técnico.

No mezclar las tres tipografías sin propósito.

## DARK MODE

Debe soportarse:

- light;
- dark;
- system.

Evitar flash de tema incorrecto durante la carga.

La preferencia del usuario puede persistirse en `localStorage`.

Verificar cada componente en ambos temas.

## ICONOS

- Utilizar una única familia principal.
- Preferir Lucide.
- No mezclar estilos visuales incompatibles.
- Los iconos no deben reemplazar texto cuando la acción no sea obvia.
- Botones solo con icono requieren nombre accesible y tooltip cuando sea útil.

## FORMULARIOS

- Labels siempre visibles.
- Descripción cuando la entrada pueda generar dudas.
- Error cerca del campo.
- Mantener valores ingresados después de errores recuperables.
- Deshabilitar submit durante una operación cuando prevenga duplicados.
- Mostrar feedback posterior.
- No depender únicamente de asteriscos para explicar obligatoriedad.

## CONSISTENCIA

Antes de crear un componente:

1. Revisar si existe en `components/ui`.
2. Revisar si existe un componente compartido equivalente.
3. Reutilizar variantes antes de duplicar.
4. Mantener spacing, radius, typography y shadows del design system.

## LANDING PÚBLICA COTA ACTIVA

- La presentación pública de cursos sigue la dirección **Cartelera editorial**, seleccionada el 2026-09-18 frente a Catálogo visual modular y Agenda de convocatorias. La convocatoria principal usa una composición panorámica dominante y las restantes se presentan como afiches secundarios dentro del lenguaje territorial de Cota Activa. Esta cartelera ya está implementada en `/` y verificada con pruebas responsive y de interacción.
- La transición del hero hacia la oferta vuelve a solaparse mediante un desplazamiento negativo y un degradado translúcido que difumina el encuentro con el curso destacado.
- La convocatoria principal y cada afiche secundario son un único enlace que cubre toda la pieza; no se fragmenta el curso en acciones internas que compitan entre sí. Las piezas son suaves, redondeadas y sin marco exterior visible, y el CTA interno tiene tratamiento visual de botón sin crear un enlace anidado.
- Las filas secundarias agrupan los cursos en tríos; cuando quedan cuatro, los dividen en dos pares para no dejar un afiche aislado; un remanente único ocupa una fila completa. En desktop los tríos ciclan tres variantes de proporción y desplazamiento vertical para conservar ritmo editorial; en tablet se normalizan a dos columnas y en mobile a una columna uniforme.
- Las acciones públicas principales (hero, curso destacado y certificados) comparten altura, espaciado, flecha, foco y radio moderado.
- Las ilustraciones territoriales usan composiciones separadas para mobile y desktop, con corte en `639px`, imágenes responsive optimizadas y formatos AVIF/WebP.
- La procedencia y el carácter conceptual de las placas territoriales se registran en `assets/plates/cota-activa.provenance.md`; no deben presentarse como evidencia documental del campus real.
- La kantuta funciona como motivo editorial decorativo de la ruta de participación: se recorta y recompone según el contexto, sin competir con el contenido ni transmitir información esencial.
- En pantallas ultrawide, la kantuta se ancla al borde izquierdo del viewport, crece fluidamente hasta un máximo de `56rem` y asciende para enmarcar el título sin cubrirlo; el contenido permanece limitado a `86rem` para no perder legibilidad.
- La landing se compone por secciones Astro y usa una hoja de estilos local bajo el scope `.landing`; Alef, tokens semánticos, animaciones y arte responsive no se comparten accidentalmente con otras superficies.
- El primer control es un skip link visible al foco que lleva a `main#main-content`. El acceso móvil del equipo permanece en el footer; la acción de cabecera se oculta hasta superar `860px`.
- El fallo de carga de oferta y la ausencia real de convocatorias son estados visuales y semánticos distintos.
- Los afiches secundarios se revelan uno a uno según su orden global, sin reiniciar la secuencia por fila. El intervalo se comprime cuando aumenta la oferta para que el último afiche comience antes de `1.8s`; la lista permanece legible si el observer no se activa.
- La capa de movimiento respeta `prefers-reduced-motion`: se eliminan las animaciones espaciales, los desplazamientos de entrada y las transiciones decorativas, incluidos los efectos hover/focus de artwork y CTA, manteniendo el contenido y la navegación disponibles.
- `?preview=courses` es un preview temporal de desarrollo para revisar la composición con cursos sintéticos; `count` permite generar de 1 a 20 elementos y `palette=warm` conserva la exploración cálida. Puede mantenerse accesible durante este avance, pero se marca `noindex,nofollow`, no representa oferta oficial y no constituye un flujo de upload de imágenes de producción.
- Los temas dark y warm-dark conservan las mismas placas luminosas de hero y footer, con el copy asociado a sus superficies claras; el filtro cálido solo ajusta la paleta warm. El bloque de certificados desemboca en el footer mediante un fade superior sutil.
- El control de tema de la landing alterna únicamente entre light y dark. El modo system se conserva como capacidad global para superficies operativas, pero no forma parte del selector público.

### Jerarquía de información de cursos

- Las tarjetas de landing muestran disponibilidad, título, descripción breve, inicio/fecha, nivel y duración.
- Las tarjetas no muestran los dos precios detallados ni el horario detallado.
- El detalle `/cursos/[slug]` está implementado y muestra horario informativo, condiciones, precios diferenciados y contenido autorizado del curso.
- La landing muestra disponibilidad, título, descripción breve, rango de fechas, nivel y duración, sin precios diferenciados ni horario detallado. Los términos comerciales y duración proceden de la revisión de formato enlazada al curso.
- La capa visual conserva artwork local de preview para muestras sintéticas y fallback gráfico de Cota Activa cuando falta imagen propia. El formulario administrativo permite seleccionar, recortar, previsualizar y subir artwork autorizado; no presentar el asset sintético de preview como fotografía de curso real.
- El horario se puede componer por días y horas en el formulario, pero se conserva como una cadena informativa legada; no se representa como una agenda operativa.
- En administración, el sidebar desktop puede reducirse a rail y expandirse en overlay por hover/foco, mientras el contenido conserva scroll independiente. Mobile utiliza menú de navegación dedicado; la preferencia de colapso desktop se guarda en `localStorage`.
- La navegación privada tiene un control de sidebar compacto con iconos sin texto visual en el rail colapsado; al expandir, el rail y el panel animan su ancho hasta ocupar el ancho completo. La transición respeta `prefers-reduced-motion`, el contenido principal conserva su ancho durante el preview overlay y el acceso a cerrar sesión no queda visible ni enfocable en el rail cerrado.
- Los formatos se presentan como tarjetas enlazadas al detalle individual. Crear formato tiene página dedicada; en su detalle cada atributo se edita de forma independiente, con aviso transitorio Sileo tras guardar. Activar/desactivar sigue separado, y la opción de eliminación solo se ofrece para formatos sin cursos asociados.
- El formulario de cursos combina selectores accesibles de nivel/formato, controles separados de fecha civil y hora, calendario, horario por días/horas y toolbar Markdown para selección de texto. La fecha se introduce como DD/MM/AAAA y la hora civil boliviana en un control separado; el horario se persiste como cadena informativa.
- En el alta con JavaScript se selecciona, recorta y confirma la foto antes de crear; se crea el borrador y luego se sube y asocia la imagen. Si falla la carga, se muestra un error persistente con reintento y enlace al borrador ya creado, sin duplicarlo. Sin JavaScript se crea sin foto y se añade desde edición. En la edición con JavaScript, «Guardar cambios» solo se habilita cuando el formulario difiere de los valores persistidos; al volver a esos valores se deshabilita de nuevo.
- Las páginas de alta, edición y configuración de formatos muestran una ruta de navegación semántica hacia Resumen y Cursos, en lugar de depender de un único enlace «Volver». Las operaciones administrativas siguen renderizadas por servidor y las confirmaciones de éxito no sustituyen errores persistentes de formulario.
- La diferencia de escala entre convocatoria principal y afiches secundarios debe expresar prioridad editorial, no convertir el conjunto en una retícula uniforme de cards.
- La referencia compositiva aprobada se conserva en `.impeccable/mocks/decision/editorial-billboard.png`; la adaptación mobile está implementada y verificada en los breakpoints de la landing.
