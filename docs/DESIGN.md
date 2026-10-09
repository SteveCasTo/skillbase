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
  --secondary: oklch(0.9596 0.02 28.9029);
  --secondary-foreground: oklch(0.5587 0.1294 32.7364);
  --muted: oklch(0.9656 0.0176 39.4009);
  --muted-foreground: oklch(0.5534 0.0116 58.0708);
  --accent: oklch(0.8278 0.1131 57.9984);
  --accent-foreground: oklch(0.3353 0.0132 2.7676);
  --destructive: oklch(0.6122 0.2082 22.241);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.9296 0.037 38.6868);
  --input: oklch(0.9296 0.037 38.6868);
  --ring: oklch(0.7357 0.1641 34.7091);
  --chart-1: oklch(0.7357 0.1641 34.7091);
  --chart-2: oklch(0.8278 0.1131 57.9984);
  --chart-3: oklch(0.8773 0.0763 54.9314);
  --chart-4: oklch(0.82 0.1054 40.8859);
  --chart-5: oklch(0.6368 0.1306 32.0721);
  --sidebar: oklch(0.9656 0.0176 39.4009);
  --sidebar-foreground: oklch(0.3353 0.0132 2.7676);
  --sidebar-primary: oklch(0.7357 0.1641 34.7091);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.8278 0.1131 57.9984);
  --sidebar-accent-foreground: oklch(0.3353 0.0132 2.7676);
  --sidebar-border: oklch(0.9296 0.037 38.6868);
  --sidebar-ring: oklch(0.7357 0.1641 34.7091);
  --font-sans: "Montserrat", sans-serif;
  --font-serif: "Merriweather", serif;
  --font-mono: "Ubuntu Mono", monospace;
  --radius: 0.625rem;
  --shadow-2xs: 0 6px 12px -3px hsl(0 0% 0% / 0.04);
  --shadow-xs: 0 6px 12px -3px hsl(0 0% 0% / 0.04);
  --shadow-sm:
    0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 1px 2px -4px hsl(0 0% 0% / 0.09);
  --shadow:
    0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 1px 2px -4px hsl(0 0% 0% / 0.09);
  --shadow-md:
    0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 2px 4px -4px hsl(0 0% 0% / 0.09);
  --shadow-lg:
    0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 4px 6px -4px hsl(0 0% 0% / 0.09);
  --shadow-xl:
    0 6px 12px -3px hsl(0 0% 0% / 0.09), 0 8px 10px -4px hsl(0 0% 0% / 0.09);
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
  --destructive: oklch(0.6122 0.2082 22.241);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.3637 0.0203 342.2664);
  --input: oklch(0.3637 0.0203 342.2664);
  --ring: oklch(0.7357 0.1641 34.7091);
  --chart-1: oklch(0.7357 0.1641 34.7091);
  --chart-2: oklch(0.8278 0.1131 57.9984);
  --chart-3: oklch(0.8773 0.0763 54.9314);
  --chart-4: oklch(0.82 0.1054 40.8859);
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

### Perfiles y cursos de instructores (released en Fase 4)

- El listado ADMIN `/app/instructores` usa grilla responsive de tarjetas completas: cada tarjeta es un único enlace semántico a edición, incluye nombre completo, correo/status, y mantiene foco visible sin enlaces/controles anidados. No presenta descripción porque el perfil no la recopila.
- El formulario de alta/edición tiene nombre y apellidos requeridos, email `type=email` requerido/normalizado (solo lectura al editar), teléfono opcional `type=tel` y password inicial solo al crear. La password nunca se repuebla ante fallo; límites y reglas se vuelven a validar en servidor. La cuenta se activa con el password asignado por ADMIN, sin paso forzado de cambio.
- La sección «Perfil profesional» dentro de `/app/perfil` solo se presenta a usuarios con rol `INSTRUCTOR`; permite editar nombre, apellidos y teléfono, manteniendo email de cuenta como solo lectura. El perfil de acceso/password sigue siendo una sección distinta.
- Administración puede elegir instructor registrado activo al crear/editar el curso; draft puede permanecer sin asignación, pero publicación no. El nombre completo asignado es el único dato del instructor proyectado en el detalle público; correo/teléfono no se exponen. Cursos históricos sin asignación conservan su texto libre.
- Instructor navega a «Mis cursos» y ve únicamente listas/detalles de cursos que le pertenecen; no se exponen acciones ADMIN, interesados ni formatos. La gestión de asistencia por ownership se añadió en Fase 6, descrita abajo. `/app/mis-cursos/[id]` conserva la consulta de fechas/grupos/cupo/estado.
- Formularios conservan HTML/POST y validación de servidor sin JavaScript; con JS la mutación muestra pending/success/error con el mismo ID de notificación, bloquea doble submit y sitúa foco en el error. La contraseña se limpia al fallar.
- El skeleton de navegación conoce `/app/instructores` y `/app/mis-cursos` como listas, `/app/instructores/nuevo` y edición como formularios, y `/app/mis-cursos/[id]` como detalle; usa el ciclo real de navegación, no un retraso decorativo. El release PR 126 no incluía lifecycle de baja; su corrección fue implementada y validada después mediante PR 136, como se describe abajo.

#### Correcciones UI de Fase 4 (implementadas, full-suite validadas e integradas en development)

Los comportamientos abajo se implementaron en `8735d676fe0d96e7230b4636efa8cb51045d1eca`, pasaron la validación local completa y se integraron mediante PR 136 (`8cdb38f`). La nota original reflejaba el estado pre-release; las correcciones de administración quedaron después en producción con PR 211/Fase 6. La nueva pasada adicional se mantiene pendiente abajo.

- Alta/edición de instructor y perfil usan el ancho útil disponible y son responsive. Submit de alta, login, recovery y cambio espera inputs requeridos válidos; edición solo activa guardar con cambios efectivos válidos. Password nunca se repuebla.
- Se retiraron la frase de conservación de correo y los dos textos redundantes del login sobre acceso preaprovisionado/limitado e instrucciones Google/correo; el CTA Google muestra su icono.
- El filtrado de interesados actualiza lista y demanda parcialmente sin navegación completa, conserva foco/SSR fallback y maneja resultado más reciente, error y reintento. Skeleton aparece solo mientras carga real; la respuesta pública de duplicado es neutral de éxito y no revela el email existente.
- Draft puede seguir sin instructor. El placeholder «Sin asignar…» queda deshabilitado; la edición conserva `null` sin seleccionar placeholder. Curso publicado requiere instructor `ACTIVE` y mínimo un grupo `PLANNED`; publicación presenta causa y recuperación inline además de toast.
- El panel de instructor lista cursos no archivados que bloquean desactivación. Con historial de asignación solo permite activar/desactivar, y bloquea baja mientras tenga asignación no archivada; sin historia ofrece eliminación solo para rol exclusivo `INSTRUCTOR` sin dependencias. Cuentas desactivadas pierden acceso por servidor aunque tengan sesión abierta. La eliminación Auth fallida deja la cuenta bloqueada para reintento, no restaura acceso.
- No se puede desactivar el último grupo activo de un curso publicado; retirar curso sigue siendo posible. La «X» de edición cancela el editor del grupo y revierte los campos; botones quedan centrados/alineados según el ajuste solicitado.
- Mobile (viewport menor a 1024 px) muestra tema a la izquierda y cerrar sesión a la derecha. El sidebar desktop se mantiene sin reordenamiento. Datos personales abre el perfil mediante enlace usable en mobile y hover/foco desktop, sin duplicar un enlace «Mi perfil» en el menú móvil.
- Cambio de contraseña parte de una acción en perfil y continúa en página dedicada. Password existente requiere password actual/nueva/confirmación; Google-only puede crearla sin password actual/email de confirmación, únicamente con OAuth Google aprobado reciente y verificación server-side de sesión live, cuenta y actor. Errores inline accesibles incluyen caso same-password específico; recovery tiene página dedicada y botón sujeto a validez del email. Se preservan SSR y POST; el campo password conserva salida SSR coherente al hidratar.
- Las mutaciones y filtros mantienen un UUID por operación entre loading y resultado, foco, valores tras error, pending, feedback y reintento.
- En alta presencial, permitir alta directa o buscar interesados del curso por nombre/correo y prellenar la ficha editable; el origen es informativo/read-only y el vínculo de trazabilidad permanece interno, sin selector de asociación. Los filtros y resultados respetan foco, integridad/privacidad y errores inline; UI y permisos deben corresponder a los límites `ADMIN`/instructor readonly.
- Si el total con descuento auxiliar es cero, mostrar preinscripción gratuita/saldo cero y mantener la misma ficha/snapshot/cupo, sin pedir ni registrar un abono de cero; para precios positivos, el primer pago mínimo debe mostrarse con moneda/centavos explícitos y validarse server-side.

## Fase 5: administración de registros (release en producción)

- PR 177 integró componentes reutilizables de formularios/listados/detalles de inscripción; PR 178 conectó la página de configuración global. PR 179 añadió route policy y montó `/app/preinscripciones`, nueva/detalle, `/app/participantes`/detalle, búsqueda/prellenado, operaciones de efectivo/devolución/cambio/cancelación, export y roster instructor. `PRIVATE_ROUTE_POLICIES` limita escrituras/listados financieros a ADMIN y roster al instructor asignado.
- Los formularios muestran campos/errores pendientes según validez, feedback recuperable y valores preservados con HTML/SSR como base; con JS las mutaciones usan un adaptador `ok/value` o `ok:false/message/issues` y requestKey para idempotencia. Montos se presentan/transportan como BOB decimal y se convierten a centavos exactos server-side. Configuración responde settings o errores `code/message/fields`, incluyendo `409` revision conflict.
- El UI integrado pasó el full canonical E2E reportado (125/125) y una revisión de 24 screenshots en 375/768/1440 px, light/dark, sin overflow. Los exportes presentan los campos actuales del backend: etiquetas curso/grupo, participante/CI, categoría, estados y cantidades del snapshot financiero. Fase 5 se liberó como `2e0eecb`; las correcciones post-release siguientes se incluyeron después en PR 228/Fase 6.
- Diseño funcional aprobado: registro directo o prellenado editable; origen del interesado de solo lectura e interno; roster instructor propio desde inicio oficial y solo nombre/apellidos; ADMIN conserva finanzas y mutaciones. Filtros/paginación con recuperación de errores, permisos server-side y cash ledger mantienen estados/foco; el total gratuito por AUXILIARY 100 % se ve como gratuidad, nunca como pago cero.
- PR 179 integró esa UI; la rama reportó 34 pruebas dirigidas y 3 E2E (dos escenarios principales y uno temporal), además de quality PASS. No equivale a full canonical E2E ni a revisión visual/accesible final del módulo.

### Correcciones de administración (PRs 197–199; incluidas en el release posterior de Fase 6)

- Configuración tiene copy reducido; ajustes y campos de participante se editan inline con lápiz/guardar/cancelar.
- Filtros select de interesados aplican al cambio; texto parcial usa debounce y actualización parcial SSR/last-request-wins. Interesados consumidos se ocultan de candidatos posteriores preservando historial; email no fusiona ni identifica participantes.
- Opciones compactas muestran nombre/correo; curso/intereses se limitan al registro seleccionado. Tarjetas seleccionables completas son teclado/clic accesibles y no filtran finanzas.
- Participantes tiene grilla responsive de hasta tres columnas. La lista muestra nombre, CI, email y estado/curso; finanzas se ven en el detalle.
- Calendario shadcn compartido reemplaza pickers nativos. El descuento solo aparece para AUXILIARY; se quitaron banners de origen, ficha técnica global y copy redundante de servidor.
- El actor se presenta por nombre humano. Métricas de devolución solo aparecen cuando son pertinentes. Acciones financieras usan diálogos breves, importes al centavo acotados por saldo y motivo de pago opcional; teléfono/CI mantienen validación conservadora.
- Operaciones mantienen UUID por solicitud, estados de carga/resultado y fallback SSR sin JavaScript. Tests se acoplan a resultados observables y no a copy/CSS/orden/conteos inestables. Estas correcciones se incluyeron en producción mediante PR 228; el gate y la evidencia final están en [`docs/TESTING.md`](TESTING.md).

### Sesiones y asistencia (Fase 6, release de producción)

- `/app/configuracion/asistencia` y las vistas de grupo/sesión están montadas con SSR/POST y rutas específicas ADMIN/INSTRUCTOR. Fechas de recuperación usan calendario shadcn; cancelación y reemplazo usan diálogos breves y conservan el original en la cronología. No hay calendario global de feriados.
- El roster de asistencia presenta nombres de participantes permitidos y asistencia propia del instructor cuando corresponde; no expone CI, email ni finanzas al instructor. ADMIN dispone de revisión/corrección de evidencia histórica.
- `Pendiente` se deriva durante la fecha civil; tras el día se deriva ausencia para el roster establecido. Sesiones pasadas requieren revisión explícita ADMIN; sesiones canceladas no cuentan. El módulo presenta estado, racha y bandera de elegibilidad, sin porcentaje ni tardanza.
- El umbral N (default 3) muestra aviso al llegar a N y marca inelegibilidad al superar N; justificada cuenta como asistencia e interrumpe racha. No hay emisión/bloqueo de certificados, expulsión automática, ni acciones automáticas de cupo/devolución.
- La UI conserva foco/teclado, estados de carga/error/éxito y fallback sin JavaScript. El release Fase 6 y el gate remoto posterior pasaron; el detalle de evidencia vigente está en [`docs/ATTENDANCE_CONTRACT.md`](ATTENDANCE_CONTRACT.md).

### Correcciones administrativas posteriores a Fase 6 (release PR 228)

PRs 219, 221, 222 y 223 integraron las correcciones funcionales en `development`, y PR 228 las promovió a producción. PRs 225/226 actualizaron expectativas E2E; el release final y las limitaciones de evidencia están registrados en [`docs/PLAN.md`](PLAN.md) y [`docs/TESTING.md`](TESTING.md).

#### Integrado en development

- **Sesión C1/C2 (PR 219, backend):** cancelación/reprogramación exige `startsAt > now` y cero marcas de participantes/instructor. El backend vuelve a revisar marcas y reloj tras adquirir locks. Los DTOs incluyen `canCancel`/`canReplace`; una familia admite una sola ocurrencia activa y conserva el historial. Estas reglas se liberaron mediante PR 228.
- **Instructor/identidad (PR 222):** edición inline independiente del perfil profesional del instructor, compatible con multirol, con email readonly; acciones de lifecycle separadas y tarjetas de cursos bloqueantes. Un ADMIN puro edita únicamente su `users.name`; el email es readonly y no se inventan apellidos/teléfono/perfil profesional para ese actor. Ver el contrato de identidad en [`docs/AUTHENTICATION.md`](AUTHENTICATION.md).
- **Configuración/participant (PR 221):** grilla de ajustes con campos independientes; edición inline de participante mantiene drafts/revisión durante las operaciones relacionadas, incluida reintegración y transferencia/cancelación.
- **Feedback de formulario:** los errores de campo se muestran inline; se descarta el aviso loading si el resultado ya se comunica junto a campos, para evitar toast duplicado. Los fallos generales usan un solo toast. El host de notificaciones permite descartar el aviso de la operación.

#### UI C3 integrada y liberada (PR 223; release PR 228)

`fix/course-group-attendance-ui` aportó los commits `2f91395`, `a10bc7b`, `a3332c4` y `2881760`; PR 223 integró la página de participantes/calendario y sus cambios de UI a `development`. El conflicto con `RegistrationActionDialog` se resolvió durante esa integración preservando el resolver compartido de PR 221. PR 228 liberó esta UI; su evidencia final de E2E y los riesgos previos están en `docs/TESTING.md`.

- La página dedicada del grupo presenta breadcrumb, participantes permitidos y para INSTRUCTOR únicamente nombres y su propia asistencia por sesión; no expone CI, contacto ni finanzas.
- Mantener la tarjeta del grupo como destino semántico claro, sin enlaces repetidos; errores/reintentos reales sin reload incondicional; calendario con navegación a fechas pasadas, tokens y separadores solo entre elementos visibles.
- Sesión cancelada muestra motivo y reemplazo, sin acciones operativas de asistencia. Estados alineados a la derecha y diferenciados semánticamente; acciones de roster en cabecera; diálogos «Cancelar»/«Confirmar» 50/50 y checkbox alineado.
- No añadir edición de la asistencia de un día histórico desde ese flujo ni acción «Marcar todo» que cierre asistencia. Conservar SSR, teclado, foco, privacidad e idempotencia.

La UI liberada conserva SSR, teclado, foco, privacidad e idempotencia conforme a las pruebas focales y al cierre PR 228. El test de guardado de grupo había mostrado intermitencia sin causa raíz; el full run de release pasó, pero no se atribuye una corrección de código a la intermitencia.

### Fase 7 — diseño de evaluaciones (implementación iniciada)

El contrato funcional/técnico aprobado está en [`docs/EVALUATIONS_CONTRACT.md`](EVALUATIONS_CONTRACT.md). PRs 230/232 integraron backend y las cuatro páginas de esquema/notas para ADMIN/INSTRUCTOR; PR 235 liberó Fase 7. La UI distingue estado pendiente/decisión 0.00 de una nota completa 0, conserva drafts individuales y expone el historial de correcciones ADMIN. El local QA cubrió 132 escenarios mediante corridas separadas, no una sola corrida full; el master CI sí pasó el full E2E 132/132. Migration 0020 está aplicada local/cloud, con verificación cloud de solo lectura y límites en [`DEPLOYMENT.md`](DEPLOYMENT.md). La liberación F7 no incorpora cierre/planilla de Fase 8 ni certificados de Fase 9.

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

- Las tarjetas de landing y del catálogo público no muestran rangos de fechas; conservan el nivel y la duración total del formato.
- Las tarjetas no muestran los dos precios detallados ni el horario detallado.
- El detalle `/cursos/[slug]` muestra inicio, fin y ventana de preinscripción como fechas civiles de Bolivia, sin horas; también muestra condiciones, precios diferenciados y contenido autorizado del curso. No presenta el horario informativo legado.
- En escritorio, el cuerpo del detalle reparte el espacio en dos columnas equivalentes para contenido y ficha informativa. La ficha agrupa los datos breves y precios en pares cuando hay anchura suficiente, dejando las fechas de preinscripción en una fila amplia; en móvil las columnas se apilan sin reducir la anchura de lectura.
- La landing y el catálogo muestran disponibilidad, título, descripción breve, nivel y duración total en horas, sin rangos de fechas, precios diferenciados ni horario detallado. Los términos comerciales y duración proceden de la revisión de formato enlazada al curso.
- La capa visual conserva artwork local de preview para muestras sintéticas y fallback gráfico de Cota Activa cuando falta imagen propia. El formulario administrativo permite seleccionar, recortar, previsualizar y subir artwork autorizado; no presentar el asset sintético de preview como fotografía de curso real.
- La landing, el catálogo y el detalle comparten el mismo fallback gráfico para cursos sin imagen; las fotos sintéticas de preview siguen limitadas a la landing de desarrollo. El catálogo encuadra las fotos guardadas con el mismo tratamiento de imagen de las tarjetas de landing y revela sus tarjetas individualmente al entrar en pantalla, respetando movimiento reducido y la lectura sin JavaScript.
- El encabezado del catálogo permite al título y a la descripción ocupar el ancho disponible en lugar de imponerles una columna estrecha. Los enlaces de regreso redundantes se omiten en catálogo y detalle; la navegación principal y del pie siguen ofreciendo acceso a Inicio y Cursos.
- El encabezado del catálogo es compacto para mostrar parte sustancial del destacado en la primera pantalla. Catálogo y detalle reutilizan el header de la landing, con destinos absolutos hacia los apartados de inicio y el mismo comportamiento flotante; el contenido público reserva espacio para ese header fijo.
- En el detalle, inicio, fin y apertura/cierre de preinscripción se muestran como fechas civiles de Bolivia, sin horas. Los horarios de los grupos se consultan únicamente en administración.
- En la landing, «Cursos» del encabezado y «Explorar cursos» del hero apuntan al mismo destacado, dejando margen para el encabezado flotante; cuando no hay cursos, el destino se sitúa en el estado vacío o de error.
- El horario de cursos nuevos se calcula de lunes a viernes; el texto histórico se conserva como dato informativo legado, pero no se muestra en el detalle público. Los horarios de grupos solo se muestran en administración.
- En administración, el sidebar desktop puede reducirse a rail y expandirse en overlay por hover/foco, mientras el contenido conserva scroll independiente. Mobile utiliza menú de navegación dedicado; la preferencia de colapso desktop se guarda en `localStorage`.
- La navegación privada tiene un control de sidebar compacto con iconos sin texto visual en el rail colapsado; al expandir, el rail y el panel animan su ancho hasta ocupar el ancho completo. La transición respeta `prefers-reduced-motion`, el contenido principal conserva su ancho durante el preview overlay y el acceso a cerrar sesión no queda visible ni enfocable en el rail cerrado. En desktop, cerrar sesión aparece como botón de icono junto al control de contraer/expandir, alineado al extremo del footer del sidebar; en mobile permanece en el footer del menú dedicado. La página Cursos ofrece una sola acción principal para crear un curso; Formatos sigue accesible desde la navegación.
- En mobile, el menú dedicado se desliza desde el borde izquierdo al abrir y vuelve al cerrarse, con un backdrop que acompaña la transición. El foco regresa al disparador al cerrarse y `prefers-reduced-motion` suprime el desplazamiento. La corrección de Fase 4 mueve el control de tema a la izquierda del footer móvil y logout a la derecha; el sidebar desktop no se reordena.
- Los estados vacíos de Cursos y Formatos comparten icono contextual, alineación centrada, anchura de lectura, espaciado y acción secundaria delineada.
- Sileo muestra los avisos transitorios en la aplicación privada con la posición inferior derecha, separada de las acciones frecuentes del encabezado, y tema sincronizado con el tema activo. En `/app`, los colores de sus estados usan tokens semánticos de la interfaz privada.
- Los formatos se presentan como tarjetas enlazadas al detalle individual. Crear formato tiene página dedicada; el botón de creación se habilita con JavaScript únicamente cuando los valores obligatorios cumplen las restricciones del formulario. Sin JavaScript, los controles HTML `required`/`pattern` y la validación del servidor conservan el flujo. En el detalle, cada atributo editable cambia en línea dentro de su misma fila: un control compacto de icono abre el campo y muestra guardar/cancelar sin desplazarse a otra página; errores de envío conservan el valor intentado y los errores de servidor siguen siendo visibles. Los campos admiten asistencia de entrada para rechazar ediciones inválidas, pero no sustituyen la validación del servidor. Activar/desactivar sigue separado, y la opción de eliminación solo se ofrece para formatos sin cursos asociados. La confirmación de eliminación se presenta explícitamente; sin JavaScript, confirmación y cancelación permanecen visibles como fallback HTML.
- Con JavaScript, guardar un campo de formato o los cambios del editor de curso conserva la página, el scroll y los controles hidratados: ambos envían la solicitud al servidor, actualizan la revisión optimista y muestran feedback o errores persistentes sin recarga. Sin JavaScript se mantiene el POST/redirect y la revalidación del servidor.
- En administración, la navegación ClientRouter mantiene el documento al crear cursos o formatos, eliminar formatos y al completar cambios de estado. Publicar, retirar y archivar un curso exige confirmación breve en diálogo con foco controlado y Escape; sin JavaScript permanece la confirmación HTML. El estado y las acciones disponibles se revalidan mediante el render SSR después de cada transición.
- El detalle de formato muestra el estado junto al título y una única acción contextual: eliminar si no tiene cursos, o desactivar/activar si ya se usa. Los datos forman una cuadrícula de dos columnas en ancho suficiente y una columna en mobile; el detalle no repite el número de revisión, el uso ni explicaciones largas. Las acciones de eliminación/desactivación confirman mediante diálogo accesible; las mutaciones con JavaScript no recargan el documento, y sin JavaScript ofrecen confirmación y POST HTML.
- Los avisos de administración utilizan la superficie `card` y texto de primer plano del tema activo, en lugar del fondo oscuro por defecto de Sileo en modo claro.
- El editor de curso separa «Datos del curso» y «Grupos» con navegación breve y semántica. La vista de grupos muestra tarjetas en una grilla que se adapta al ancho, con horario y capacidad editables **en su misma fila** como los datos del formato (lápiz, guardar y cancelar con iconos Lucide); no duplica el valor mientras se edita. Solo los grupos desactivados muestran la etiqueta «Inactivo»: los vigentes no necesitan etiqueta. «Nuevo grupo» se alinea con las acciones del encabezado del curso. Permite añadir grupos a cursos borrador o publicados con planificación válida; archivar bloquea altas. Los grupos nunca publicados se pueden eliminar mediante el icono de la esquina, mientras que los que ya tuvieron exposición pública solo se desactivan y pueden reactivarse, conservando el historial. Las mutaciones con JavaScript conservan la página; sin JavaScript mantienen POST/redirect. Al crear o cambiar un horario, se calcula la hora final y se advierte de cruces con otros grupos; la validación del servidor sigue siendo autoritativa.
- El formulario de cursos combina selectores accesibles de nivel/formato, controles de fecha civil y calendario compartidos por inicio de clases y preinscripción (tanto al crear como al editar cursos de fechas civiles), y toolbar Markdown para selección de texto. Los cursos históricos con horas guardadas conservan su editor de fecha y hora para no perder precisión. Con JavaScript, «Crear borrador» permanece deshabilitado si el borrador está intacto; una vez escrito un nombre, permite intentar guardar sin formato para mostrar el error junto al selector. Con formato elegido, se habilita solo cuando los campos obligatorios están presentes y válidos, la nota mínima está en rango, las fechas civiles están en orden y las fechas opcionales de inscripción son ambas válidas o ambas vacías. Sin JavaScript, la página proporciona selects HTML para nivel y formato como alternativa progresiva. La fecha civil se introduce como DD/MM/AAAA; el resumen de horario se persiste como cadena informativa por compatibilidad. Los filtros de entrada ayudan a rechazar caracteres/ediciones inválidas sin reemplazar la validación autoritativa del servidor.
- El formato tiene cinco datos editables: nombre, horas nominales, minutos por sesión y los dos precios. En cursos nuevos los días son siempre lunes a viernes; seleccionar formato e inicio calcula el fin diario fijo y la última fecha, que no se edita directamente. El resumen compacto distingue horas nominales y planificadas si difieren. La preinscripción nueva usa fechas civiles con día final inclusivo (cierre efectivo a medianoche del día siguiente); el calendario requiere ambas fechas o ninguna y que el último día preceda al inicio de clases. Los cursos históricos conservan sus horas de registro precisas y su horario informativo editable. Sin JavaScript siguen disponibles los campos HTML explícitos, sujetos a la misma validación de servidor.
- En el alta con JavaScript se selecciona, recorta y confirma la foto antes de crear; se crea el borrador y luego se sube y asocia la imagen. Si falla la carga, se muestra un error persistente con reintento y enlace al borrador ya creado, sin duplicarlo. Sin JavaScript se crea sin foto y se añade desde edición. En la edición con JavaScript, «Guardar cambios» solo se habilita cuando el formulario difiere de los valores persistidos; al volver a esos valores se deshabilita de nuevo.
- En el formulario de curso, la imagen comparte el bloque de información general con nombre y descripción: imagen a la izquierda y texto a la derecha en desktop, columna única en mobile. El encuadre arrastrable conserva la proporción real 8:5 del WebP exportado (1200 × 750), admite zoom y ajuste por teclado, y exige confirmar el recorte tras cada cambio antes de crear. La foto guardada y el nuevo recorte se muestran en el mismo marco; la imagen guardada se puede pulsar para reemplazarla y la acción superpuesta aparece al pasar el cursor o enfocar, manteniéndose visible en pantallas táctiles.
- Antes de confirmar el recorte, el editor permite comprobar el WebP generado en encuadres representativos de la landing (destacado de escritorio, afiches de distinto ancho y tarjeta móvil) y del detalle público en escritorio y móvil. Las vistas se actualizan con el recorte y no alteran el archivo único ni las páginas públicas.
- El formulario conserva contenido SSR funcional antes de hidratarse: la foto guardada/seleccionada tiene fallback visible y el contenido Markdown mantiene un control de texto utilizable mientras su editor React hidrata. La inicialización del sidebar privado aplica el estado guardado también en la carga inicial y evita registrar controladores duplicados en navegaciones del router.
- El listado administrativo de cursos omite el rango de fechas para mantener compactas las filas; las fechas se consultan al abrir la edición. Las acciones editoriales se presentan de forma compacta y el feedback transitorio usa Sileo con el tema activo.
- El toolbar Markdown expone niveles de encabezado de contenido H2/H3, negrita, cursiva, código en línea y bloque, listas, citas, separadores y enlaces. El detalle público renderiza ese subconjunto con jerarquía semántica debajo del título del curso y sin HTML crudo; los enlaces pasan por una lista segura de destinos.
- El contenido Markdown público restaura marcadores visibles de listas ordenadas y no ordenadas, incluidos estilos diferenciados para niveles anidados.
- Las páginas de alta, edición y configuración de formatos muestran una ruta de navegación semántica hacia Resumen y Cursos, en lugar de depender de un único enlace «Volver». Las operaciones administrativas siguen renderizadas por servidor y las confirmaciones de éxito no sustituyen errores persistentes de formulario.
- La diferencia de escala entre convocatoria principal y afiches secundarios debe expresar prioridad editorial, no convertir el conjunto en una retícula uniforme de cards.
- La referencia compositiva aprobada se conserva en `.impeccable/mocks/decision/editorial-billboard.png`; la adaptación mobile está implementada y verificada en los breakpoints de la landing.

### Cargas y mutaciones de la aplicación privada

- Todos los productores de notificaciones administrativas usan la fachada `src/lib/notifications.ts`. Cada operación tiene ID UUID propio; una notificación promise conserva su ID entre loading, success y error para actualizar el aviso correcto.
- El host Sileo compartido muestra avisos abajo a la derecha; el host privado los posiciona para no tapar las acciones superiores. Ambos layouts coordinan un solo host/viewport activo por documento. Los avisos previos a montar el host quedan encolados y se presentan al activarlo; loading→success/error conserva el mismo ID.
- JavaScript sigue habilitado como mejora progresiva en la aplicación. Los tests sin JavaScript validan fallbacks HTML/SSR, no una política de desactivar JavaScript. Las animaciones del sidebar siguen activas salvo las reglas existentes de movimiento reducido; no se suprimen globalmente.

- La carga estructural de vistas privadas usa skeleton SSR según variante (lista, formulario, detalle o resumen), se muestra mientras el loader está pendiente y el contenido entra en viewport, y se cancela al resolver, abortar o fallar la navegación. Respeta foco/teclado y `prefers-reduced-motion`; no es una demora decorativa.
- El selector de tema vive en el sidebar expandido y en el menú móvil, pero no queda visible ni enfocable en el rail cerrado. El tema se aplica tempranamente y se sincroniza tras navegaciones; si el almacenamiento del navegador está bloqueado, la interfaz conserva el cambio en memoria.
- Las acciones de grupos mantienen una presentación local del DTO de curso y formatos, sin incluir enlaces de navegación ajenos a la vista. Los bloqueos de petición y los diálogos evitan duplicados; tras mutaciones se actualiza localmente la tarjeta/lista pertinente y se conserva el foco. Los controles de formato/cursos mantienen cambios de formulario ante errores y permiten reintento.

## Registro público de interesados (Fase 3, UI implementada)

- El formulario aparece únicamente en el detalle del curso elegible; no modifica landing, tarjetas ni catálogo. La presentación separa expresamente expresar interés de reservar cupo, pagar o inscribirse.
- La estructura SSR conserva el fallback HTML y los valores/errores ante respuesta del servidor. La mejora React usa estados pending/éxito/error, foco en el resultado o primer campo inválido y selector del design system para preferencia de grupo. Sin preferencia disponible, el flujo no fuerza selección.
- `/app/interesados` resume registros activos por curso; el detalle administrativo presenta registros en una grilla de tarjetas de ancho fluido, tanto en desktop como en mobile, con filtros de estado, confirmación de cancelación/reactivación y actualización local. No hay destino individual de registro: las tarjetas no simulan navegación y sus acciones conservan foco/teclado y fallback HTML.
- La demanda ocupa todo el ancho en filas apiladas de nombre, conteo y barra. Cada barra representa el conteo dividido por el total activo del curso (no por el máximo ni por el filtro). Todos los máximos positivos, incluido «Sin preferencia», usan el token `accent` y el texto «Mayor demanda»; un empate destaca a todos y cero no genera ganador. Los conteos y proporciones permanecen disponibles como texto.
- El encabezado del detalle administrativo no impone una anchura artificial al texto introductorio. El formulario público conserva una sola aclaración bajo el título; el submit ocupa todo el ancho del formulario. Con JavaScript solo se habilita cuando nombre y apellidos no están en blanco tras `trim` y los campos obligatorios cumplen la validez HTML. Sin JavaScript sigue habilitado con restricciones HTML y validación autoritativa del servidor; errores recuperables conservan valores y permiten reintento.
- La navegación pendiente hacia interesados reutiliza el ciclo real de skeleton privado: listado para el resumen y demanda/tarjetas para el detalle. El render inicial SSR no añade esperas ni skeletons artificiales; las mutaciones mantienen feedback local y no reemplazan datos existentes.
- La UI está implementada y la cobertura responsive, de teclado y de fallback sin JavaScript está verificada; el E2E completo del release pasó 96/96. La secuencia local anterior de 95 escenarios requirió revalidaciones dirigidas; ver el historial exacto en `docs/TESTING.md`.
- La lista de cursos permite wrapping de slugs largos y evita overflow horizontal en 320, 390, 768, 1024 y 1440 px. Las regresiones de viewport/toasts pasaron dentro del E2E de release (96/96).

## Estado de los ajustes de interesados

El ajuste compacto/responsive del panel y formulario de interesados quedó integrado mediante PRs 116 y 117 a `development`; ver el comportamiento y accesibilidad implementados en la sección «Registro público de interesados» arriba. Su verificación full anterior al módulo de instructores pasó 98/98 E2E. Este hito UX no cierra la gestión de cursos/instructores de Fase 4.

## Correcciones administrativas aprobadas (release PR 278)

Los ajustes siguientes se implementaron en las ramas integradas PRs 258–264 y en el head de feedback/navegación `d057d2d`. Las verificaciones de los cambios F7 fueron focales por stage y no constituyen por sí solas el gate F8; ver [`TESTING.md`](TESTING.md). Core/UI cierre y exports se integraron por PRs 280–282; backend/UI multi-ADMIN por PRs 283/285. PR 286 liberó Fase 8 a producción.

- **Edición inline compartida:** lápiz/guardar/cancelar por atributo, posición y tamaño estables; comunicar dirty/validación y mantener controles/iconos accesibles. Loading no debe sustituir el layout ni destruir el SVG/estado del control. Mostrar errores persistentes junto al campo y conflictos accionables; Sileo solo para feedback transitorio no duplicado.
- **Instructor y perfil:** nombre como texto y correo de solo lectura sin decoración de input editable. El listado de cursos presenta datos personales primero y una explicación/bloqueo debajo junto a los cursos pertinentes. Centrar la tarjeta global del perfil y alinear Google en una fila propia.
- **Esquema y notas:** pesos draft en 0–100 con dos decimales; presupuesto restante excluye el componente editado. Agregar queda deshabilitado al alcanzar 100, pero los pesos existentes pueden redistribuirse entre 0–100. Permitir estado transitorio incompleto/decimal, persistiendo solo esquema completo al 100 %. Mostrar una ayuda breve al total válido, quitar mensajes duplicados de freeze/provisionalidad y CTA repetido, y usar breadcrumb contextual. Tras primera nota, no ofrecer edición del esquema. Calificaciones usan un contenedor redondeado, filas compactas por participante, pendiente breve, búsqueda live por nombre y wrapping para muchos componentes; mobile no debe desbordar.
- **Grupos, participantes y roster:** dos columnas en desktop y una en mobile; horario/capacidad alineados en la misma fila y CTA a todo el ancho al pie. La edición de participante ocurre en el flujo de preinscripción; la UI `/app/participantes` y sus destinos duplicados se retiraron, preservando ficha global, CI, finanzas e historial multi-curso. El picker de preinscripción ofrece interesados del curso actual, sin volver a listar un interés ya consumido; el alta manual conserva búsqueda de ficha global por CI. Roster ADMIN usa paginación server-side y búsqueda amplia; instructor solo busca nombres. Estados distintos de `INSCRITO` permanecen visibles y no se exponen con una acción exclusiva para inscritos.
- **Calendario y navegación:** filtros sticky en desktop y compactos/accesibles en mobile, sin overflow. Representar estados reales upcoming/in-progress/ended/cancelled; combinarlos con fecha por defecto, permitir vistas completas y preservar filtro de estado al reiniciar fechas. Mantener `IN_PROGRESS`. Reducir títulos duplicados de Sesiones. Breadcrumbs coherentes por curso/grupo/esquema y destinos existentes; no enlazar rutas retiradas.
- **Consistencia transversal:** acciones y botones conservan jerarquía común; los errores que persisten deben estar en contexto, y un toast no duplica una explicación visible. Los cambios se validan con teclado, foco, responsive, light/dark y estados loading/dirty/invalid/error.

La revisión manual prevista cubre desktop/mobile, tabla y lista, light/dark, teclado, errores y loading mediante Playwright CLI. No reemplaza pruebas de reglas de negocio ni justifica tests E2E acoplados a CSS o copy.

En las verificaciones focales de estos cambios se usaron páginas/DTOs y respuestas sintéticas interceptadas cuando se indica en [`TESTING.md`](TESTING.md); no equivalen a una auditoría completa de rutas privadas, persistencia/Auth ni al gate de release.

## Cierre académico de grupo (Fase 8, UI integrada)

`feat/academic-closure-interface` implementa SSR para el workspace de cierre por
grupo y el detalle de versiones históricas para ADMIN e INSTRUCTOR. El workspace
distingue resultado provisional y versión oficial; lista blockers con links a
evaluaciones/sesiones, conserva breadcrumbs de curso/grupo y presenta actor y
timestamp congelados del snapshot. Cerrar requiere confirmación accesible breve
(Escape/retorno de foco); reabrir solo ADMIN y motivo obligatorio con error
inline. En estado cerrado, notas/asistencia se presentan readonly. SSR/POST y
fallback HTML sin JS conservan requestKey/revision y drafts al resolver errores
409/422; la UI no sustituye guards server-side.

Los links por versión consumen adapters PDF/CSV integrados por PRs 281/282. El
owner verificó seis GET/download paths live en QA. UI reportó 21 unit/137
assertions y tres E2E first-pass, además de revisión manual de 12 capturas
responsive/light-dark; el release completo y su gate están en [`TESTING.md`](TESTING.md).

## Cuentas de administradores (UI Fase 8, integrada en development)

La feature `feat/admin-account-interface` agrega la sección «Administradores»
visible a cualquier cuenta ADMIN, sin jerarquía ROOT. La lista SSR usa tarjetas
responsive en grid y búsqueda por nombre/correo con estado accesible sin
resultados. La pantalla de alta separa los datos del administrador del acceso
inicial; el toggle de visibilidad de password es progresivo y nunca vuelve a
renderizar el valor. Nombre/email tienen validación contextual y la contraseña
respeta el rango 12–128 establecido por backend.

En el detalle, nombre solo es editable por control inline compartido y email se
muestra como texto readonly. La acción lifecycle singular se deriva del DTO
autorizado: eliminar, desactivar/reactivar o reintentar eliminación pendiente;
no hay selector de acción/rol. La confirmación tiene fallback HTML sin JS y,
con React, mantiene foco inicial/cancelación y retorno de foco. Los errores,
pending, drafts no secretos y recarga son contextuales; al auto-desactivar o
eliminar, el servidor termina la sesión redirigiendo a login. Tarjetas y
acciones evitan overflow por emails/nombres largos. Pruebas UI focales y límites
responsive/teclado están en [`TESTING.md`](TESTING.md). Backend/UI se integraron
por PRs 283/285 y se liberaron por PR 286. No se hizo smoke autenticado ADMIN ni
se crearon cuentas reales en producción durante el release.

## Correcciones UI posteriores a Fase 8 (PR 289, release posterior)

La pasada correctiva ajusta confirmaciones, búsqueda/perfiles ADMIN e instructores,
calendario, notas, asistencia y presentación adaptable de resultados, conservando
los guardas/roles del servidor, SSR/POST y el sistema visual existente. El detalle
de interacción aprobado e implementado, incluidos defaults y estados responsive,
está en [`UI_CORRECTIONS_CONTRACT.md`](UI_CORRECTIONS_CONTRACT.md). PR 289 está
integrado en `development` y quedó incluido en releases posteriores a `master`.
La revisión visual y release de los seguimientos descritos abajo se limitan a sus
ramas de feature; ver evidencia por ejecución en [`TESTING.md`](TESTING.md).

### Pulido posterior del filtro y scroll del calendario (fuente local)

La rama `fix/calendar-filter-scroll` (`bf938d3cacef70deb01ef32c6bd4fd80c2e72f97`) ajusta la interacción del calendario de sesiones: cada filtro de estado puede deseleccionarse para volver a mostrar el conjunto completo; seleccionar fecha, «Todas» y cambiar a un filtro específico mantienen las reglas existentes. La lista y los filtros utilizan un único scroll vertical principal, sin contenedor scrolleable anidado; el calendario es sticky solo en desktop con altura suficiente y vuelve al flujo normal en viewports bajos. Los tokens globales de scrollbar respetan light/dark, las paletas de landing/catálogo y `forced-colors`. La evidencia y sus límites están en [`TESTING.md`](TESTING.md).

### Seguimiento de búsqueda en vivo y resumen académico compacto (PR 295)

La rama `fix/live-instructor-search-and-compact-results` actualiza dos detalles
de la pasada. La lista ADMIN de instructores filtra en vivo el conjunto completo
que el loader ya autorizó SSR (nombre/correo normalizados), sin requests al
tipear, sin debounce ni cambios de foco; el GET/submit sigue siendo el fallback
sin JavaScript, con query e historial recuperables. La búsqueda ocupa el ancho
disponible y anuncia un estado vacío contextual.

Las filas de nota alinean identidad, componentes y resultado final mediante
filas de valores compartidas, con reflow/wrapping para esquemas extensos. En el
cierre, **todos** los resultados usan una tarjeta compacta equivalente, sin
umbral por número de componentes: muestra estado/resultado, nota y mínimo del
reporte autorizado, progreso cuando aplica y agregado de asistencia. Toda la
tarjeta abre el diálogo accesible del design system; SSR mantiene disclosure
`<details>/<summary>`. No hay botón «Ver detalle», resultado provisional nuevo
ni cálculo de negocio en la presentación. Se mantiene CI únicamente para ADMIN,
finanzas fuera del resumen y detalle financiero solo en la proyección ADMIN
existente. El comportamiento y sus límites están en
[`UI_CORRECTIONS_CONTRACT.md`](UI_CORRECTIONS_CONTRACT.md) y
[`TESTING.md`](TESTING.md). El PR está publicado, pero esta rama no acredita
integración ni release.
